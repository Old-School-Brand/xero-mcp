/*
 * Fix iteration — review findings #3, #4, #16
 * Source: .specs/002-http-transport-and-oauth/backend/review.md
 *
 * Examples covered:
 *   - Example 15: Redis unreachable at startup (AC-6) — createApp() rejects with "Redis unreachable"
 *   - Example 16: Entra JWKS unreachable at startup (AC-7) — createApp() rejects with "Entra JWKS unreachable"
 *   - AC-17 integration: /readyz returns 503 when Redis ping() fails mid-life (non-local)
 *
 * Test plan:
 *   - test_redis_unreachable_at_startup_rejects_with_message: createApp() rejects with "Redis unreachable" when redis connect() fails
 *   - test_entra_jwks_unreachable_at_startup_rejects_with_message: createApp() rejects with "Entra JWKS unreachable" when verifyAccessToken throws TypeError
 *   - test_readyz_returns_503_when_redis_ping_fails_mid_life: GET /readyz returns 503 {"status":"unavailable","reason":"redis"} when ping() rejects after startup
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";

// ---------------------------------------------------------------------------
// Hoisted mock factories — must be set before any module import
// ---------------------------------------------------------------------------
const {
  mockRedisConnect,
  mockRedisPing,
  mockStartEvictionTimer,
  mockHandleRequest,
  mockCreateSession,
  mockGetSession,
  mockVerifyAccessToken,
} = vi.hoisted(() => {
  const mockRedisConnect = vi.fn();
  const mockRedisPing = vi.fn();
  const mockStartEvictionTimer = vi.fn();
  const mockHandleRequest = vi.fn();
  const mockCreateSession = vi.fn();
  const mockGetSession = vi.fn();
  const mockVerifyAccessToken = vi.fn();
  return {
    mockRedisConnect,
    mockRedisPing,
    mockStartEvictionTimer,
    mockHandleRequest,
    mockCreateSession,
    mockGetSession,
    mockVerifyAccessToken,
  };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

// xero-client: authenticate succeeds immediately
vi.mock("../../clients/xero-client.js", () => ({
  xeroClient: {
    authenticate: vi.fn().mockResolvedValue(undefined),
  },
}));

// tool-factory: no-op
vi.mock("../../tools/tool-factory.js", () => ({
  ToolFactory: vi.fn(),
}));

// sessions: mock SessionManager so we don't need real transport
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

// redis: mock createClient to return a controllable client
vi.mock("redis", () => ({
  createClient: vi.fn().mockReturnValue({
    connect: mockRedisConnect,
    ping: mockRedisPing,
    get: vi.fn(),
    set: vi.fn(),
  }),
}));

// auth/build: mock buildAuth so we control the verifier's verifyAccessToken
// The non-local overload returns { provider, verifier, requiredScopes }
vi.mock("../../http/auth/build.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../http/auth/build.js")>();
  return {
    ...actual,
    buildAuth: vi.fn().mockReturnValue({
      provider: {
        // Minimal ProxyOAuthServerProvider shape needed by mcpAuthRouter
        clientsStore: {
          registerClient: vi.fn().mockResolvedValue({ client_id: "test" }),
          getClient: vi.fn().mockResolvedValue(undefined),
        },
        metadata: vi.fn().mockReturnValue({}),
      },
      verifier: { verifyAccessToken: mockVerifyAccessToken, jwksUrl: "https://login.microsoftonline.com/test-tenant/discovery/v2.0/keys" },
      requiredScopes: ["mcp"],
    }),
  };
});

// ---------------------------------------------------------------------------
// Non-local env stubs — applied before any import of server.ts
// ---------------------------------------------------------------------------
vi.stubEnv("ENVIRONMENT", "development");
vi.stubEnv("ENTRA_TENANT_ID", "test-tenant-id");
vi.stubEnv("ENTRA_CLIENT_ID", "test-client-id");
vi.stubEnv("MCP_SERVER_URL", "https://xero-mcp.example.com");
vi.stubEnv("ENTRA_REQUIRED_SCOPES", "mcp");
vi.stubEnv("REDIS_URL", "redis://localhost:6379");

import { createApp } from "../../http/server.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("server non-local startup and runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Session manager defaults
    mockCreateSession.mockResolvedValue({
      sessionId: "test-session-id",
      transport: { handleRequest: mockHandleRequest },
    });
    mockGetSession.mockReturnValue(undefined);
    mockStartEvictionTimer.mockReturnValue(undefined);
    mockHandleRequest.mockImplementation(
      (_req: unknown, res: { status: (s: number) => { json: (b: unknown) => void } }) => {
        res.status(200).json({ result: {} });
      },
    );

    // Default Redis: connect and ping succeed
    mockRedisConnect.mockResolvedValue(undefined);
    mockRedisPing.mockResolvedValue("PONG");

    // Default verifier: probe succeeds by throwing InvalidTokenError
    // (sentinel JWT correctly rejected = JWKS endpoint reachable)
    mockVerifyAccessToken.mockRejectedValue(new InvalidTokenError("no matching key"));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // Finding #3 — Example 15 / AC-6: Redis unreachable at startup
  it("test_redis_unreachable_at_startup_rejects_with_message", async () => {
    // Redis connect fails (unreachable host)
    mockRedisConnect.mockRejectedValue(new Error("connect ECONNREFUSED"));

    await expect(createApp()).rejects.toThrow(/Redis unreachable/);
  });

  // Finding #4 — Example 16 / AC-7: Entra JWKS unreachable at startup
  it("test_entra_jwks_unreachable_at_startup_rejects_with_message", async () => {
    // Redis succeeds; JWKS probe throws a network error (not InvalidTokenError)
    mockRedisConnect.mockResolvedValue(undefined);
    mockRedisPing.mockResolvedValue("PONG");
    mockVerifyAccessToken.mockRejectedValue(new TypeError("fetch failed"));

    await expect(createApp()).rejects.toThrow(/Entra JWKS unreachable/);
  });

  // Finding #16 — AC-17 integration: /readyz returns 503 when Redis ping fails mid-life
  it("test_readyz_returns_503_when_redis_ping_fails_mid_life", async () => {
    // Startup: connect and ping succeed
    mockRedisConnect.mockResolvedValue(undefined);
    // Startup ping succeeds, but subsequent /readyz ping fails
    mockRedisPing
      .mockResolvedValueOnce("PONG") // startup probe
      .mockRejectedValue(new Error("Redis connection lost")); // subsequent /readyz calls

    const { app } = await createApp();

    const res = await request(app).get("/readyz");
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: "unavailable", reason: "redis" });
  });
});
