/*
 * Task: 2.2 & 3.3 — src/http/auth/build.ts — Auth factory (local + non-local branches)
 * Source: .specs/002-http-transport-and-oauth/backend/todo.md
 *
 * Examples covered:
 *   - (local auth wiring, tested end-to-end in Task 2.3)
 *   - Example 14: Non-local: token without required scope returns 403 (AC AC-9)
 *   - Example 15: Non-local: Redis unreachable at startup crashes (AC AC-6)
 *   - Example 16: Non-local: Entra JWKS unreachable at startup crashes (AC AC-7)
 *
 * Test plan:
 *   - test_local_buildAuth_returns_local_bearer_verifier: buildAuth(localSettings) returns { verifier: LocalBearerVerifier, requiredScopes: ["mcp"] }
 *   - test_nonlocal_buildAuth_returns_provider_and_verifier: buildAuth(nonLocalSettings, redisClient) returns provider, verifier, requiredScopes
 *   - test_nonlocal_provider_clientsStore_has_registerClient: provider.clientsStore has registerClient (Object.defineProperty override)
 *
 * Update (003-oauth-proxy-bridge, Task 4.2): buildAuth's non-local branch now instantiates
 * EntraBridgeProvider (not the superseded dumb-forward subclass — see ADR-0004), requires ENTRA_CLIENT_SECRET,
 * takes a logger third argument, and returns callbackHandler alongside provider/verifier/requiredScopes.
 * mockRedisClient gains del/getDel bindings for RedisOAuthCodeStore.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LocalSettings, NonLocalSettings } from "../../../http/settings.js";

vi.mock("../../../http/auth/local-verifier.js", () => {
  return {
    LocalBearerVerifier: class MockLocalBearerVerifier {
      token: string;
      constructor(token: string) {
        this.token = token;
      }
      verifyAccessToken = vi.fn();
    },
  };
});

// Task 3.2 module - mocked so Task 2.2 tests run before entra-verifier.ts exists
vi.mock("../../../http/auth/entra-verifier.js", () => {
  return {
    EntraVerifier: class MockEntraVerifier {
      opts: unknown;
      constructor(opts: unknown) {
        this.opts = opts;
      }
      verifyAccessToken = vi.fn();
    },
    STARTUP_PROBE_JWT:
      "eyJhbGciOiJSUzI1NiIsImtpZCI6InN0YXJ0dXAtcHJvYmUifQ.eyJpc3MiOiJzdGFydHVwLXByb2JlIn0.invalid",
  };
});

vi.mock("../../../http/auth/redis-clients-store.js", () => {
  return {
    RedisOAuthClientsStore: class MockRedisOAuthClientsStore {
      redis: unknown;
      constructor(redis: unknown) {
        this.redis = redis;
      }
      getClient = vi.fn();
      registerClient = vi.fn();
    },
  };
});

vi.mock("@modelcontextprotocol/sdk/server/auth/providers/proxyProvider.js", () => {
  return {
    ProxyOAuthServerProvider: class MockProxyOAuthServerProvider {
      opts: unknown;
      clientsStore = { getClient: vi.fn() }; // default without registerClient
      constructor(opts: unknown) {
        this.opts = opts;
      }
    },
  };
});

import { buildAuth } from "../../../http/auth/build.js";
import { LocalBearerVerifier } from "../../../http/auth/local-verifier.js";

const localSettings: LocalSettings = {
  ENVIRONMENT: "local",
  MCP_BIND_HOST: "0.0.0.0",
  MCP_BIND_PORT: 8000,
  LOG_LEVEL: "info",
  MCP_SESSION_IDLE_TIMEOUT_SECONDS: 1800,
  MCP_MAX_SESSIONS: 100,
  DEV_BEARER_TOKEN: "tok",
};

const nonLocalSettings: NonLocalSettings = {
  ENVIRONMENT: "development",
  MCP_BIND_HOST: "0.0.0.0",
  MCP_BIND_PORT: 8000,
  LOG_LEVEL: "info",
  MCP_SESSION_IDLE_TIMEOUT_SECONDS: 1800,
  MCP_MAX_SESSIONS: 100,
  ENTRA_TENANT_ID: "tenant-123",
  ENTRA_CLIENT_ID: "client-456",
  ENTRA_CLIENT_SECRET: "entra-secret-value",
  MCP_SERVER_URL: "https://example.com",
  ENTRA_REQUIRED_SCOPES: "mcp",
  REDIS_URL: "redis://localhost:6379",
};

const mockLogger = { warn: vi.fn() } as unknown as import("pino").Logger;

describe("buildAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("test_local_buildAuth_returns_local_bearer_verifier", () => {
    const result = buildAuth(localSettings);

    expect(result.requiredScopes).toEqual(["mcp"]);
    expect(result.verifier).toBeInstanceOf(LocalBearerVerifier);
    // No provider in local mode
    expect("provider" in result).toBe(false);
  });

  it("test_nonlocal_buildAuth_returns_provider_and_verifier", () => {
    const mockRedisClient = {
      get: vi.fn(),
      set: vi.fn(),
      del: vi.fn(),
      getDel: vi.fn(),
    } as unknown as import("redis").RedisClientType;

    const result = buildAuth(nonLocalSettings, mockRedisClient, mockLogger);

    expect("provider" in result).toBe(true);
    expect(result.requiredScopes).toEqual(["mcp"]);
    if ("provider" in result) {
      expect(typeof result.callbackHandler).toBe("function");
    }
  });

  it("test_nonlocal_provider_clientsStore_has_registerClient", () => {
    const mockRedisClient = {
      get: vi.fn(),
      set: vi.fn(),
      del: vi.fn(),
      getDel: vi.fn(),
    } as unknown as import("redis").RedisClientType;

    const result = buildAuth(nonLocalSettings, mockRedisClient, mockLogger);

    // Object.defineProperty should have overridden provider.clientsStore
    // so it returns the RedisOAuthClientsStore instance (which has registerClient)
    if ("provider" in result) {
      expect(typeof result.provider.clientsStore.registerClient).toBe("function");
    } else {
      throw new Error("Expected provider in result");
    }
  });
});
