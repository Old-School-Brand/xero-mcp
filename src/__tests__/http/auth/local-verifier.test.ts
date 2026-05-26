/*
 * Task: 2.1 — src/http/auth/local-verifier.ts — Static bearer OAuthTokenVerifier
 * Source: .specs/002-http-transport-and-oauth/backend/todo.md
 *
 * Examples covered:
 *   - Example 2: Local-dev: missing bearer returns 401 (AC AC-4)
 *   - Example 3: Local-dev: wrong bearer returns 401 (AC AC-4)
 *
 * Test plan:
 *   - test_correct_token_resolves_auth_info_with_mcp_scope: verifyAccessToken(correct) resolves to AuthInfo with scopes: ["mcp"]
 *   - test_wrong_token_rejects_with_invalid_token_error: verifyAccessToken(wrong) rejects with InvalidTokenError
 *   - test_equal_length_wrong_token_rejects: equal-length wrong token is rejected (constant-time comparison safety)
 *
 * Note: the `expiresAt` assertion was updated from `toBeUndefined()` to a numeric assertion
 * because LocalBearerVerifier now returns LOCAL_DEV_EXPIRES_AT directly (a far-future timestamp).
 * This removes the inline wrapper in server.ts that previously injected the numeric sentinel.
 * Exempted from test-immutability rule: the design change (finding #6 in review.md) explicitly
 * moves the sentinel into the verifier and updates this assertion.
 */

import { describe, it, expect } from "vitest";
import { LocalBearerVerifier, LOCAL_DEV_EXPIRES_AT } from "../../../http/auth/local-verifier.js";
import { InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";

describe("LocalBearerVerifier", () => {
  it("test_correct_token_resolves_auth_info_with_mcp_scope", async () => {
    const verifier = new LocalBearerVerifier("test-token-abc");
    const authInfo = await verifier.verifyAccessToken("test-token-abc");

    expect(authInfo.token).toBe("test-token-abc");
    expect(authInfo.clientId).toBe("dev-local");
    expect(authInfo.scopes).toEqual(["mcp"]);
    // expiresAt is now a numeric far-future timestamp (LOCAL_DEV_EXPIRES_AT) so the SDK's
    // requireBearerAuth middleware accepts it without a wrapper.
    expect(authInfo.expiresAt).toBe(LOCAL_DEV_EXPIRES_AT);
    expect(typeof authInfo.expiresAt).toBe("number");
  });

  it("test_wrong_token_rejects_with_invalid_token_error", async () => {
    const verifier = new LocalBearerVerifier("test-token-abc");

    await expect(verifier.verifyAccessToken("wrong-token")).rejects.toBeInstanceOf(
      InvalidTokenError,
    );
  });

  it("test_equal_length_wrong_token_rejects", async () => {
    // Verify constant-time comparison: equal-length wrong token must still be rejected
    const verifier = new LocalBearerVerifier("correct-token-12");
    // Same byte length as "correct-token-12" (16 chars), different content
    await expect(verifier.verifyAccessToken("xxxxxxxxxxxxxxxx")).rejects.toBeInstanceOf(
      InvalidTokenError,
    );
  });
});
