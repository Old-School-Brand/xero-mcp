/*
 * Task: 2.1-2.5 — src/http/auth/bridge-provider.ts — EntraBridgeProvider (OAuth-proxy bridge)
 * Source: .specs/003-oauth-proxy-bridge/backend/todo.md
 *
 * Examples covered:
 *   - Example 1: Authorize stores transaction and redirects to Entra
 *   - Example 2: Authorize never sends the `resource` parameter to Entra
 *   - Example 5: Expired server code fails (challengeForAuthorizationCode half)
 *   - Example 6: Client PKCE is validated by the SDK (challengeForAuthorizationCode returns the stored challenge)
 *   - Example 4: Server code is single-use (exchangeAuthorizationCode half)
 *   - Example 11: exchangeRefreshToken substitutes Entra identity
 *
 * Test plan:
 *   - test_authorize_stores_txn_and_redirects_to_entra_with_server_pkce: authorize() stores the txn keyed by a random txn_id and redirects with client_id=ENTRA_CLIENT_ID, state=txn_id (not the client's), server PKCE challenge, and the fully-qualified scope
 *   - test_authorize_never_forwards_resource_param: authorize() called with params.resource set never adds a `resource` query param to the Entra redirect
 *   - test_challengeForAuthorizationCode_returns_stored_challenge: returns the stored clientCodeChallenge for a known code
 *   - test_challengeForAuthorizationCode_unknown_code_throws_invalid_grant: throws InvalidGrantError for an unknown/expired code
 *   - test_exchangeAuthorizationCode_returns_tokens_and_consumes_code: returns stored tokens on first use (single atomic getAndDelete)
 *   - test_exchangeAuthorizationCode_replay_throws_invalid_grant: throws InvalidGrantError on replay (code already consumed)
 *   - test_exchangeRefreshToken_substitutes_entra_identity: substitutes ENTRA_CLIENT_ID/SECRET/scope and never forwards the DCR client's own identity
 */

import { createHash } from "node:crypto";
import { describe, it, expect, vi, afterEach } from "vitest";
import type { Response } from "express";
import { InvalidGrantError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import { EntraBridgeProvider } from "../../../http/auth/bridge-provider.js";
import type { RedisOAuthCodeStore } from "../../../http/auth/redis-code-store.js";

const ENTRA_CONFIG = {
  clientId: "entra-client-id",
  clientSecret: "entra-client-secret",
  callbackUrl: "https://example.com/auth/callback",
  scope: "api://entra-client-id/mcp",
};

const ENDPOINTS = {
  authorizationUrl: "https://login.microsoftonline.com/tenant-abc/oauth2/v2.0/authorize",
  tokenUrl: "https://login.microsoftonline.com/tenant-abc/oauth2/v2.0/token",
};

const DCR_CLIENT = {
  client_id: "dcr-abc",
  redirect_uris: ["http://localhost:9999/callback"],
} as OAuthClientInformationFull;

function makeCodeStoreMock() {
  return {
    set: vi.fn(),
    get: vi.fn(),
    del: vi.fn(),
    getAndDelete: vi.fn(),
  } as unknown as RedisOAuthCodeStore;
}

function makeProvider(codeStore: RedisOAuthCodeStore) {
  return new EntraBridgeProvider(
    {
      endpoints: ENDPOINTS,
      verifyAccessToken: async () => ({ token: "t", clientId: "c", scopes: [] }),
      getClient: async () => DCR_CLIENT,
    },
    codeStore,
    ENTRA_CONFIG,
  );
}

describe("EntraBridgeProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks(); // restore the global fetch spy between tests
  });

  it("test_authorize_stores_txn_and_redirects_to_entra_with_server_pkce", async () => {
    const codeStore = makeCodeStoreMock();
    const provider = makeProvider(codeStore);
    let redirectedUrl = "";
    const res = { redirect: (url: string) => (redirectedUrl = url) } as unknown as Response;

    await provider.authorize(
      DCR_CLIENT,
      {
        redirectUri: "http://localhost:9999/callback",
        codeChallenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
        state: "client-state-xyz",
        scopes: ["mcp"],
      },
      res,
    );

    expect(codeStore.set).toHaveBeenCalledOnce();
    const [namespace, txnId, record, ttl] = (codeStore.set as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      string,
      Record<string, string>,
      number,
    ];
    expect(namespace).toBe("txn");
    expect(record.clientRedirectUri).toBe("http://localhost:9999/callback");
    expect(record.clientState).toBe("client-state-xyz");
    expect(record.clientCodeChallenge).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    expect(record.serverCodeVerifier).toHaveLength(43);
    expect(ttl).toBe(600);

    const params = new URL(redirectedUrl).searchParams;
    expect(params.get("client_id")).toBe("entra-client-id"); // NOT the DCR id
    expect(params.get("redirect_uri")).toBe("https://example.com/auth/callback");
    expect(params.get("state")).toBe(txnId); // NOT "client-state-xyz"
    // The challenge sent to Entra must be the S256 hash of the stored server verifier —
    // proves the second (server↔Entra) PKCE pair is mathematically correct and distinct
    // from the client's challenge (AC 8), not merely present.
    const expectedServerChallenge = createHash("sha256").update(record.serverCodeVerifier).digest("base64url");
    expect(params.get("code_challenge")).toBe(expectedServerChallenge);
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(params.get("scope")).toBe("api://entra-client-id/mcp");
    expect(params.get("response_type")).toBe("code");
  });

  it("test_authorize_never_forwards_resource_param", async () => {
    const codeStore = makeCodeStoreMock();
    const provider = makeProvider(codeStore);
    let redirectedUrl = "";
    const res = { redirect: (url: string) => (redirectedUrl = url) } as unknown as Response;

    await provider.authorize(
      DCR_CLIENT,
      {
        redirectUri: "http://localhost:9999/callback",
        codeChallenge: "challenge",
        state: "xyz",
        resource: new URL("https://example.com/"),
      },
      res,
    );

    expect(new URL(redirectedUrl).searchParams.has("resource")).toBe(false);
  });

  it("test_challengeForAuthorizationCode_returns_stored_challenge", async () => {
    const codeStore = makeCodeStoreMock();
    (codeStore.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      clientCodeChallenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
      clientRedirectUri: "http://localhost:9999/callback",
      tokens: { access_token: "a", token_type: "Bearer" },
    });
    const provider = makeProvider(codeStore);

    const challenge = await provider.challengeForAuthorizationCode(DCR_CLIENT, "code-def");

    expect(challenge).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    expect(codeStore.get).toHaveBeenCalledWith("code", "code-def");
  });

  it("test_challengeForAuthorizationCode_unknown_code_throws_invalid_grant", async () => {
    const codeStore = makeCodeStoreMock();
    (codeStore.get as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const provider = makeProvider(codeStore);

    await expect(provider.challengeForAuthorizationCode(DCR_CLIENT, "expired-code")).rejects.toBeInstanceOf(
      InvalidGrantError,
    );
  });

  it("test_exchangeAuthorizationCode_returns_tokens_and_consumes_code", async () => {
    const codeStore = makeCodeStoreMock();
    const tokens = { access_token: "entra-at-789", token_type: "Bearer" };
    (codeStore.getAndDelete as ReturnType<typeof vi.fn>).mockResolvedValue({
      clientCodeChallenge: "challenge",
      clientRedirectUri: "http://localhost:9999/callback",
      tokens,
    });
    const provider = makeProvider(codeStore);

    const result = await provider.exchangeAuthorizationCode(DCR_CLIENT, "code-abc");

    expect(result).toEqual(tokens);
    expect(codeStore.getAndDelete).toHaveBeenCalledWith("code", "code-abc");
  });

  it("test_exchangeAuthorizationCode_replay_throws_invalid_grant", async () => {
    const codeStore = makeCodeStoreMock();
    (codeStore.getAndDelete as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const provider = makeProvider(codeStore);

    await expect(provider.exchangeAuthorizationCode(DCR_CLIENT, "code-abc")).rejects.toBeInstanceOf(
      InvalidGrantError,
    );
  });

  it("test_exchangeRefreshToken_substitutes_entra_identity", async () => {
    const codeStore = makeCodeStoreMock();
    const provider = makeProvider(codeStore);

    let body = "";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      body = String((init as RequestInit)?.body ?? "");
      return new Response(JSON.stringify({ access_token: "a", token_type: "Bearer" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const dcrClientWithSecret = { ...DCR_CLIENT, client_secret: "dcr-secret" };
    await provider.exchangeRefreshToken(dcrClientWithSecret, "refresh-token-xyz");

    const params = new URLSearchParams(body);
    expect(params.get("client_id")).toBe("entra-client-id");
    expect(params.get("client_secret")).toBe("entra-client-secret");
    expect(params.get("scope")).toBe("api://entra-client-id/mcp");
    expect(params.get("resource")).toBeNull();
    expect(body).not.toContain("dcr-abc");
    expect(body).not.toContain("dcr-secret");
  });
});
