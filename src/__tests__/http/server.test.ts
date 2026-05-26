/*
 * Task: 3.5 — src/__tests__/http/server.test.ts — Integration test for server.ts
 * Source: .specs/002-http-transport-and-oauth/backend/todo.md
 *
 * Examples covered:
 *   - Example 1: POST /mcp with correct bearer initialises a session (AC AC-5/AC-19)
 *   - Example 2: POST /mcp without Authorization header returns 401 (AC AC-4)
 *   - Example 3: POST /mcp with wrong bearer returns 401 (AC AC-4)
 *   - Example 9: Session cap reached returns 503 (AC AC-14)
 *   - Example 10: Unknown session ID returns 404 (AC AC-13)
 *
 * Test plan:
 *   - test_livez_returns_200_in_local_mode: GET /livez returns 200 {"status":"ok"}
 *   - test_post_mcp_without_auth_returns_401: POST /mcp without Authorization returns 401 with WWW-Authenticate header
 *   - test_post_mcp_with_correct_bearer_returns_200: POST /mcp with correct bearer + initialize body calls transport.handleRequest
 *   - test_post_mcp_with_unknown_session_id_returns_404: POST /mcp with Mcp-Session-Id header for unknown session returns 404
 *   - test_session_cap_returns_503: POST /mcp when createSession throws SessionCapError returns 503 {"error":"session_cap_reached"}
 *
 * Additional tests (fix iteration — review findings #18 and #21):
 *   - test_delete_mcp_with_valid_session_returns_200: DELETE /mcp with valid bearer + existing session ID returns 200
 *   - test_post_mcp_non_initialize_without_session_id_returns_400: POST /mcp valid bearer, no Mcp-Session-Id, method tools/list returns 400 without calling createSession
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// Use vi.hoisted so env stubs and mock factories are set before module evaluation.
// server.ts guards its IIFE with process.env.VITEST, but the mocks still need
// to be hoisted so they're ready when createApp() is first called in beforeEach.
const { mockCreateSession, mockGetSession, mockStartEvictionTimer, mockHandleRequest } =
  vi.hoisted(() => {
    const mockHandleRequest = vi.fn();
    const mockCreateSession = vi.fn();
    const mockGetSession = vi.fn();
    const mockStartEvictionTimer = vi.fn();
    return { mockCreateSession, mockGetSession, mockStartEvictionTimer, mockHandleRequest };
  });

// xero-client has env guards at module load time — must mock before import
vi.mock("../../clients/xero-client.js", () => ({
  xeroClient: {
    authenticate: vi.fn().mockResolvedValue(undefined),
  },
}));

// tool-factory is called per session — mock to no-op
vi.mock("../../tools/tool-factory.js", () => ({
  ToolFactory: vi.fn(),
}));

vi.mock("../../http/sessions.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../http/sessions.js")>();
  return {
    ...actual,
    SessionManager: class MockSessionManager {
      createSession = mockCreateSession;
      getSession = mockGetSession;
      startEvictionTimer = mockStartEvictionTimer;
    },
  };
});

// Stub env for local mode — must happen before createApp() is called
vi.stubEnv("ENVIRONMENT", "local");
vi.stubEnv("DEV_BEARER_TOKEN", "test-secret-token");

import { createApp } from "../../http/server.js";
import { SessionCapError } from "../../http/sessions.js";

describe("server integration", () => {
  let app: Awaited<ReturnType<typeof createApp>>["app"];

  beforeEach(async () => {
    vi.clearAllMocks();

    // Default: createSession returns a fake transport
    mockCreateSession.mockResolvedValue({
      sessionId: "test-session-id",
      transport: { handleRequest: mockHandleRequest },
    });
    // Default: getSession returns undefined (unknown session)
    mockGetSession.mockReturnValue(undefined);
    mockStartEvictionTimer.mockReturnValue(undefined);
    // Default: handleRequest just ends with 200
    mockHandleRequest.mockImplementation(
      (_req: unknown, res: { status: (s: number) => { json: (b: unknown) => void } }) => {
        res.status(200).json({ result: {} });
      },
    );

    const result = await createApp();
    app = result.app;
  });

  it("test_livez_returns_200_in_local_mode", async () => {
    const res = await request(app).get("/livez");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("test_post_mcp_without_auth_returns_401", async () => {
    const res = await request(app)
      .post("/mcp")
      .send({ jsonrpc: "2.0", method: "initialize", id: 1 });

    expect(res.status).toBe(401);
    expect(res.headers["www-authenticate"]).toBeDefined();
  });

  it("test_post_mcp_with_correct_bearer_returns_200", async () => {
    // No session ID — new session path
    mockGetSession.mockReturnValue(undefined);

    const res = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer test-secret-token")
      .send({ jsonrpc: "2.0", method: "initialize", id: 1 });

    expect(res.status).toBe(200);
  });

  it("test_post_mcp_with_unknown_session_id_returns_404", async () => {
    // getSession returns undefined for unknown ID
    mockGetSession.mockReturnValue(undefined);

    const res = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer test-secret-token")
      .set("Mcp-Session-Id", "unknown-session-id")
      .send({ jsonrpc: "2.0", method: "tools/list", id: 1 });

    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.message).toBe("Session not found");
  });

  it("test_session_cap_returns_503", async () => {
    mockCreateSession.mockRejectedValue(new SessionCapError());

    const res = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer test-secret-token")
      .send({ jsonrpc: "2.0", method: "initialize", id: 1 });

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: "session_cap_reached" });
  });

  // Finding #18: DELETE /mcp integration test (Example 11, AC-15)
  it("test_delete_mcp_with_valid_session_returns_200", async () => {
    // Arrange: getSession returns a valid transport for the known session ID
    mockGetSession.mockReturnValue({
      transport: { handleRequest: mockHandleRequest },
      lastActivity: Date.now(),
    });

    const res = await request(app)
      .delete("/mcp")
      .set("Authorization", "Bearer test-secret-token")
      .set("Mcp-Session-Id", "test-session-id");

    expect(res.status).toBe(200);
    expect(mockHandleRequest).toHaveBeenCalledOnce();
  });

  // Finding #21: Orphaned-session guard (Example 21, AC from orphaned-session finding)
  it("test_post_mcp_non_initialize_without_session_id_returns_400", async () => {
    // POST with valid bearer, no Mcp-Session-Id, method is tools/list (not initialize)
    // Should return 400 JSON-RPC error without allocating a session
    const res = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer test-secret-token")
      .send({ jsonrpc: "2.0", method: "tools/list", id: 1 });

    expect(res.status).toBe(400);
    expect(res.body.jsonrpc).toBe("2.0");
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe(-32600);
    expect(res.body.id).toBeNull();
    // Critically: createSession must NOT have been called
    expect(mockCreateSession).not.toHaveBeenCalled();
  });
});
