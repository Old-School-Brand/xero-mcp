/*
 * Task: 1.5 — src/http/sessions.ts — SessionManager with create, lookup, delete, idle eviction, and cap
 * Source: .specs/002-http-transport-and-oauth/backend/todo.md
 *
 * Examples covered:
 *   - Example 9: Session cap returns 503 (AC AC-14)
 *   - Example 10: Session lookup for unknown ID returns 404 (AC AC-12 implied)
 *   - Example 11: Explicit DELETE closes a session (AC AC-15)
 *   - Example 12: Idle session is evicted after timeout (AC AC-13)
 *
 * Test plan:
 *   - test_session_cap_throws_session_cap_error: createSession() throws SessionCapError when at capacity
 *   - test_get_session_unknown_id_returns_undefined: getSession() returns undefined for unknown ID
 *   - test_delete_session_removes_entry_and_closes_transport: deleteSession() removes map entry then calls transport.close()
 *   - test_delete_session_is_reentrant_safe: deleteSession() does not loop when onsessionclosed fires inside transport.close()
 *   - test_evict_idle_sessions_removes_stale_entries: evictIdleSessions() removes entries older than idleTimeoutMs
 *   - test_create_session_returns_session_id_and_transport: createSession() returns sessionId and transport
 *   - test_get_session_updates_last_activity: getSession() updates lastActivity timestamp
 *
 * Note: the StreamableHTTPServerTransport mock was refactored (finding #7 in review.md) to close
 * over the sessionId variable already captured at construction rather than using `const self = this`.
 * This allowed reverting the blanket `@typescript-eslint/no-this-alias` override in eslint.config.js.
 * Exempted from test-immutability rule: this is a lint-cleanliness refactor; all assertions are unchanged.
 *
 * New test (iteration 3 finding #5): test_mcp_server_constructed_with_package_identity — AC-19
 */

import { readFileSync } from "node:fs";
import { describe, it, expect, vi, beforeEach } from "vitest";
import pino from "pino";

// We capture onsessionclosed callbacks so tests can simulate transport.close() triggering it
const capturedCallbacks: Map<string, (id: string) => void> = new Map();

// Track mock transport instances so we can inspect their close() calls
const mockTransports: Map<string, { close: ReturnType<typeof vi.fn>; handleRequest: ReturnType<typeof vi.fn>; sessionId: string | undefined }> = new Map();

// Track McpServer constructor arguments for AC-19 assertion
const mcpServerConstructorArgs: Array<{ name: string; version: string }> = [];

vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => {
  return {
    McpServer: class MockMcpServer {
      connect = vi.fn().mockResolvedValue(undefined);
      close = vi.fn().mockResolvedValue(undefined);
      constructor(opts: { name: string; version: string }) {
        mcpServerConstructorArgs.push(opts);
      }
    },
  };
});

vi.mock("@modelcontextprotocol/sdk/server/streamableHttp.js", () => {
  return {
    StreamableHTTPServerTransport: class MockStreamableHTTPServerTransport {
      close: ReturnType<typeof vi.fn>;
      handleRequest: ReturnType<typeof vi.fn>;
      sessionId: string | undefined;

      constructor(options?: { sessionIdGenerator?: () => string; onsessionclosed?: (id: string) => void }) {
        const sessionId = options?.sessionIdGenerator?.();
        this.sessionId = sessionId;

        if (sessionId && options?.onsessionclosed) {
          capturedCallbacks.set(sessionId, options.onsessionclosed);
        }

        this.handleRequest = vi.fn().mockResolvedValue(undefined);
        // Close over sessionId (captured above) instead of using `const self = this`
        // to avoid the @typescript-eslint/no-this-alias lint rule.
        this.close = vi.fn().mockImplementation(() => {
          // Simulate the SDK firing onsessionclosed when close() is called
          if (sessionId && capturedCallbacks.has(sessionId)) {
            capturedCallbacks.get(sessionId)!(sessionId);
          }
        });

        if (sessionId) {
          mockTransports.set(sessionId, this as unknown as { close: ReturnType<typeof vi.fn>; handleRequest: ReturnType<typeof vi.fn>; sessionId: string | undefined });
        }
      }
    },
  };
});

vi.mock("../../tools/tool-factory.js", () => ({
  ToolFactory: vi.fn(),
}));

function makeLogger(): pino.Logger {
  return pino({ level: "silent" });
}

// Import after mocks are established
import { SessionManager, SessionCapError } from "../../http/sessions.js";

describe("SessionManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedCallbacks.clear();
    mockTransports.clear();
    mcpServerConstructorArgs.length = 0;
  });

  it("test_session_cap_throws_session_cap_error", async () => {
    const manager = new SessionManager({
      maxSessions: 2,
      idleTimeoutMs: 60_000,
      serverIdentity: { name: "test", version: "1.0" },
      logger: makeLogger(),
    });

    await manager.createSession();
    await manager.createSession();

    await expect(manager.createSession()).rejects.toBeInstanceOf(SessionCapError);
    expect(manager.size).toBe(2);
  });

  it("test_get_session_unknown_id_returns_undefined", () => {
    const manager = new SessionManager({
      maxSessions: 10,
      idleTimeoutMs: 60_000,
      serverIdentity: { name: "test", version: "1.0" },
      logger: makeLogger(),
    });

    const result = manager.getSession("00000000-0000-0000-0000-000000000099");
    expect(result).toBeUndefined();
  });

  it("test_delete_session_removes_entry_and_closes_transport", async () => {
    const manager = new SessionManager({
      maxSessions: 10,
      idleTimeoutMs: 60_000,
      serverIdentity: { name: "test", version: "1.0" },
      logger: makeLogger(),
    });

    const { sessionId, transport } = await manager.createSession();
    expect(manager.size).toBe(1);

    manager.deleteSession(sessionId);

    expect(manager.size).toBe(0);
    expect(transport.close).toHaveBeenCalledOnce();
  });

  it("test_delete_session_is_reentrant_safe", async () => {
    const manager = new SessionManager({
      maxSessions: 10,
      idleTimeoutMs: 60_000,
      serverIdentity: { name: "test", version: "1.0" },
      logger: makeLogger(),
    });

    const { sessionId, transport } = await manager.createSession();

    // deleteSession removes map entry, then calls transport.close()
    // transport.close() fires onsessionclosed(sessionId) which calls deleteSession again
    // The re-entrant call must find no entry and return immediately (no infinite loop, no error)
    expect(() => manager.deleteSession(sessionId)).not.toThrow();
    expect(manager.size).toBe(0);
    // close() is called once by deleteSession; the re-entrant deleteSession call returns immediately
    expect(transport.close).toHaveBeenCalledOnce();
  });

  it("test_evict_idle_sessions_removes_stale_entries", async () => {
    const manager = new SessionManager({
      maxSessions: 10,
      idleTimeoutMs: 100, // 100ms timeout for fast test
      serverIdentity: { name: "test", version: "1.0" },
      logger: makeLogger(),
    });

    const { sessionId, transport } = await manager.createSession();
    expect(manager.size).toBe(1);

    // Manually backdate lastActivity to simulate idle session
    const entry = manager.getSession(sessionId)!;
    entry.lastActivity = Date.now() - 200; // 200ms ago, exceeds 100ms timeout

    manager.evictIdleSessions();

    expect(manager.size).toBe(0);
    expect(transport.close).toHaveBeenCalled();
  });

  it("test_create_session_returns_session_id_and_transport", async () => {
    const manager = new SessionManager({
      maxSessions: 10,
      idleTimeoutMs: 60_000,
      serverIdentity: { name: "test-server", version: "1.2.3" },
      logger: makeLogger(),
    });

    const { sessionId, transport } = await manager.createSession();

    expect(typeof sessionId).toBe("string");
    expect(sessionId.length).toBeGreaterThan(0);
    expect(transport).toBeDefined();
    expect(manager.size).toBe(1);
  });

  it("test_get_session_updates_last_activity", async () => {
    const manager = new SessionManager({
      maxSessions: 10,
      idleTimeoutMs: 60_000,
      serverIdentity: { name: "test", version: "1.0" },
      logger: makeLogger(),
    });

    const { sessionId } = await manager.createSession();

    const entryBefore = manager.getSession(sessionId)!;
    const activityBefore = entryBefore.lastActivity;

    // Wait a small amount to ensure time advances
    await new Promise((resolve) => setTimeout(resolve, 5));

    manager.getSession(sessionId);
    const entryAfter = manager.getSession(sessionId)!;

    expect(entryAfter.lastActivity).toBeGreaterThanOrEqual(activityBefore);
  });

  it("test_two_sessions_have_distinct_ids_and_isolated_entries", async () => {
    // Example 22: session isolation — two sessions must have distinct IDs and
    // getSession(id1) must return a different entry than getSession(id2).
    const manager = new SessionManager({
      maxSessions: 10,
      idleTimeoutMs: 60_000,
      serverIdentity: { name: "test", version: "1.0" },
      logger: makeLogger(),
    });

    const session1 = await manager.createSession();
    const session2 = await manager.createSession();

    expect(session1.sessionId).not.toBe(session2.sessionId);

    const entry1 = manager.getSession(session1.sessionId);
    const entry2 = manager.getSession(session2.sessionId);

    expect(entry1).toBeDefined();
    expect(entry2).toBeDefined();
    expect(entry1).not.toBe(entry2);
  });

  it("test_mcp_server_constructed_with_package_identity", async () => {
    // AC-19: each session's McpServer must be constructed with the upstream package.json
    // name and version — not a hardcoded string.
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { name: string; version: string };

    const manager = new SessionManager({
      maxSessions: 10,
      idleTimeoutMs: 60_000,
      serverIdentity: { name: pkg.name, version: pkg.version },
      logger: makeLogger(),
    });

    await manager.createSession();

    expect(mcpServerConstructorArgs.length).toBe(1);
    expect(mcpServerConstructorArgs[0]).toEqual({ name: pkg.name, version: pkg.version });
  });
});
