/*
 * Task: 3.2 — src/http/auth/entra-verifier.ts — Entra JWT verifier via jose
 * Source: .specs/002-http-transport-and-oauth/backend/todo.md
 *
 * Examples covered:
 *   - Example 13: Non-local: expired Entra token returns 401 (AC AC-10)
 *   - Example 14: Non-local: token without required scope returns 403 (AC AC-9)
 *   - Example 16: Non-local: Entra JWKS unreachable at startup crashes (AC AC-7)
 *
 * Test plan:
 *   - test_valid_token_resolves_auth_info: verifyAccessToken resolves to AuthInfo when jwtVerify succeeds with valid scp
 *   - test_expired_token_rejects_with_invalid_token_error: verifyAccessToken rejects with InvalidTokenError when JWTExpired (JOSEError subclass)
 *   - test_missing_scope_rejects_with_insufficient_scope_error: verifyAccessToken rejects with InsufficientScopeError when scp missing required scope
 *   - test_network_error_propagates_as_type_error: verifyAccessToken propagates TypeError("fetch failed") (non-JOSEError) unchanged
 *   - test_startup_probe_jwt_is_structurally_valid: STARTUP_PROBE_JWT has three dot-separated segments
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { InvalidTokenError, InsufficientScopeError } from "@modelcontextprotocol/sdk/server/auth/errors.js";

// Use vi.hoisted so mock factories can reference these before module init
const { mockJwtVerify, mockCreateRemoteJWKSet, MockJOSEError, MockJWTExpired } = vi.hoisted(() => {
  const mockJwtVerify = vi.fn();
  const mockCreateRemoteJWKSet = vi.fn().mockReturnValue("mock-jwks");

  class MockJOSEError extends Error {
    constructor(message?: string) {
      super(message);
      this.name = "JOSEError";
    }
  }
  class MockJWTExpired extends MockJOSEError {
    constructor(message?: string) {
      super(message);
      this.name = "JWTExpired";
    }
  }

  return { mockJwtVerify, mockCreateRemoteJWKSet, MockJOSEError, MockJWTExpired };
});

vi.mock("jose", () => ({
  createRemoteJWKSet: mockCreateRemoteJWKSet,
  jwtVerify: mockJwtVerify,
  errors: {
    JOSEError: MockJOSEError,
    JWTExpired: MockJWTExpired,
  },
}));

import { EntraVerifier, STARTUP_PROBE_JWT } from "../../../http/auth/entra-verifier.js";

const verifierOptions = {
  tenantId: "tenant-123",
  clientId: "client-456",
  requiredScopes: ["mcp"],
};

describe("EntraVerifier", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateRemoteJWKSet.mockReturnValue("mock-jwks");
  });

  it("test_valid_token_resolves_auth_info", async () => {
    mockJwtVerify.mockResolvedValue({
      payload: {
        sub: "user-sub-123",
        scp: "mcp email",
        exp: 9999999999,
      },
    });

    const verifier = new EntraVerifier(verifierOptions);
    const authInfo = await verifier.verifyAccessToken("valid-jwt");

    expect(authInfo.token).toBe("valid-jwt");
    expect(authInfo.clientId).toBe("user-sub-123");
    expect(authInfo.scopes).toContain("mcp");
    expect(authInfo.expiresAt).toBe(9999999999);
  });

  it("test_audience_accepts_client_id_guid_and_app_id_uri", async () => {
    // Entra v2.0 issues aud as the client-id GUID, not the api:// URI — verifier must accept both.
    mockJwtVerify.mockResolvedValue({ payload: { sub: "u", scp: "mcp", exp: 9999999999 } });

    const verifier = new EntraVerifier(verifierOptions);
    await verifier.verifyAccessToken("valid-jwt");

    const opts = mockJwtVerify.mock.calls[0]![2] as { issuer: string; audience: string[] };
    expect(opts.audience).toContain("client-456"); // bare GUID — what Entra actually issues
    expect(opts.audience).toContain("api://client-456"); // App ID URI — accepted too
    expect(opts.issuer).toBe("https://login.microsoftonline.com/tenant-123/v2.0");
  });

  it("test_expired_token_rejects_with_invalid_token_error", async () => {
    // MockJWTExpired extends MockJOSEError (which is the mocked JOSEError)
    // so instanceof MockJOSEError is true → caught → InvalidTokenError
    mockJwtVerify.mockRejectedValue(new MockJWTExpired("Token expired"));

    const verifier = new EntraVerifier(verifierOptions);
    await expect(verifier.verifyAccessToken("expired-jwt")).rejects.toBeInstanceOf(
      InvalidTokenError,
    );
  });

  it("test_missing_scope_rejects_with_insufficient_scope_error", async () => {
    mockJwtVerify.mockResolvedValue({
      payload: {
        sub: "user-sub-123",
        scp: "email profile", // missing "mcp"
        exp: 9999999999,
      },
    });

    const verifier = new EntraVerifier(verifierOptions);
    await expect(verifier.verifyAccessToken("no-scope-jwt")).rejects.toBeInstanceOf(
      InsufficientScopeError,
    );
  });

  it("test_network_error_propagates_as_type_error", async () => {
    // TypeError is NOT a JOSEError (MockJOSEError) — must propagate unchanged
    const networkError = new TypeError("fetch failed");
    mockJwtVerify.mockRejectedValue(networkError);

    const verifier = new EntraVerifier(verifierOptions);
    await expect(verifier.verifyAccessToken("any-jwt")).rejects.toBe(networkError);
    // Specifically must NOT become InvalidTokenError
    await expect(verifier.verifyAccessToken("any-jwt")).rejects.not.toBeInstanceOf(
      InvalidTokenError,
    );
  });

  it("test_startup_probe_jwt_is_structurally_valid", () => {
    const segments = STARTUP_PROBE_JWT.split(".");
    // A JWT has exactly three dot-separated segments: header.payload.signature
    expect(segments).toHaveLength(3);
    // All three must be non-empty
    expect(segments[0]).toBeTruthy();
    expect(segments[1]).toBeTruthy();
    expect(segments[2]).toBeTruthy();
  });
});
