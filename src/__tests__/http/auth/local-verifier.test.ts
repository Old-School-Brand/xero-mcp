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
 */

import { describe, it, expect } from "vitest";
import { LocalBearerVerifier } from "../../../http/auth/local-verifier.js";
import { InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";

describe("LocalBearerVerifier", () => {
  it("test_correct_token_resolves_auth_info_with_mcp_scope", async () => {
    const verifier = new LocalBearerVerifier("test-token-abc");
    const authInfo = await verifier.verifyAccessToken("test-token-abc");

    expect(authInfo.token).toBe("test-token-abc");
    expect(authInfo.clientId).toBe("dev-local");
    expect(authInfo.scopes).toEqual(["mcp"]);
    expect(authInfo.expiresAt).toBeUndefined();
  });

  it("test_wrong_token_rejects_with_invalid_token_error", async () => {
    const verifier = new LocalBearerVerifier("test-token-abc");

    await expect(verifier.verifyAccessToken("wrong-token")).rejects.toBeInstanceOf(
      InvalidTokenError,
    );
  });
});
