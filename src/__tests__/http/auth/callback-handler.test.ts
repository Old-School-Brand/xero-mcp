/*
 * Task: 3.1-3.6 — src/http/auth/callback-handler.ts — GET /auth/callback Express handler
 * Source: .specs/003-oauth-proxy-bridge/backend/todo.md
 *
 * Examples covered:
 *   - Example 3: Callback exchanges upstream code and redirects to client
 *   - Example 3b: Callback redirect preserves an existing query string and encodes state
 *   - Example 7: Callback with Entra error returns 502
 *   - Example 8: Callback with missing state returns 400
 *   - Example 9: Callback with unknown/expired txn returns 400
 *   - Example 10: Callback with upstream exchange failure returns 502
 *   - AC 8: no sensitive data in callback logs or error bodies
 *
 * Test plan:
 *   - test_happy_path_exchanges_code_and_redirects_to_client: full success path, asserts the token POST body, txn deletion, code storage, and the final redirect URL/query
 *   - test_redirect_preserves_existing_query_and_encodes_state: existing `?foo=bar` on clientRedirectUri is preserved and `&`/`=` in clientState are percent-encoded
 *   - test_entra_error_returns_502_no_redirect: `error` query param short-circuits to 502, no redirect
 *   - test_missing_state_returns_400: no `state` param returns 400
 *   - test_unknown_txn_returns_400: codeStore.get("txn", ...) resolving undefined returns 400
 *   - test_upstream_exchange_failure_returns_502_txn_preserved: non-ok fetch response returns 502 and does not delete the txn
 *   - test_error_paths_never_leak_sensitive_values: none of the JSON bodies or logger.warn call args contain a token, secret, or PKCE verifier
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";
import type pino from "pino";
import { createCallbackHandler } from "../../../http/auth/callback-handler.js";
import type { RedisOAuthCodeStore } from "../../../http/auth/redis-code-store.js";
import type { CallbackEntraConfig } from "../../../http/auth/callback-handler.js";

const ENTRA_CONFIG: CallbackEntraConfig = {
  clientId: "entra-client-id",
  clientSecret: "entra-client-secret",
  callbackUrl: "https://example.com/auth/callback",
  scope: "api://entra-client-id/mcp",
  tokenUrl: "https://login.microsoftonline.com/tenant-abc/oauth2/v2.0/token",
};

const TXN_RECORD = {
  clientRedirectUri: "http://localhost:9999/callback",
  clientState: "client-state-xyz",
  clientCodeChallenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  serverCodeVerifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
};

function makeCodeStoreMock() {
  return {
    set: vi.fn(),
    get: vi.fn(),
    del: vi.fn(),
    getAndDelete: vi.fn(),
  } as unknown as RedisOAuthCodeStore;
}

function makeLoggerMock() {
  return { warn: vi.fn() } as unknown as pino.Logger;
}

function makeRes() {
  return {
    redirect: vi.fn(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  } as unknown as Response & { redirect: ReturnType<typeof vi.fn>; status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
}

function makeReq(query: Record<string, string | undefined>) {
  return { query } as unknown as Request;
}

function mockFetchSuccess(tokens: Record<string, unknown>) {
  let capturedBody = "";
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    capturedBody = String(init?.body ?? "");
    return new Response(JSON.stringify(tokens), { status: 200, headers: { "content-type": "application/json" } });
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return { fetchMock, getBody: () => capturedBody };
}

describe("createCallbackHandler", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("test_happy_path_exchanges_code_and_redirects_to_client", async () => {
    const codeStore = makeCodeStoreMock();
    (codeStore.get as ReturnType<typeof vi.fn>).mockResolvedValue(TXN_RECORD);
    const logger = makeLoggerMock();
    const { getBody } = mockFetchSuccess({
      access_token: "entra-at-789",
      token_type: "Bearer",
      refresh_token: "entra-rt-012",
      expires_in: 3600,
    });

    const handler = createCallbackHandler(codeStore, ENTRA_CONFIG, logger);
    const res = makeRes();
    await handler(makeReq({ code: "entra-auth-code-456", state: "txn-123" }), res, vi.fn());

    const params = new URLSearchParams(getBody());
    expect(params.get("grant_type")).toBe("authorization_code");
    expect(params.get("code")).toBe("entra-auth-code-456");
    expect(params.get("client_id")).toBe("entra-client-id");
    expect(params.get("client_secret")).toBe("entra-client-secret");
    expect(params.get("code_verifier")).toBe(TXN_RECORD.serverCodeVerifier);
    expect(params.get("redirect_uri")).toBe("https://example.com/auth/callback");

    expect(codeStore.del).toHaveBeenCalledWith("txn", "txn-123");
    expect(codeStore.set).toHaveBeenCalledOnce();
    const [namespace, serverCode, record, ttl] = (codeStore.set as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
      number,
    ];
    expect(namespace).toBe("code");
    expect(record["clientCodeChallenge"]).toBe(TXN_RECORD.clientCodeChallenge);
    expect(record["clientRedirectUri"]).toBe(TXN_RECORD.clientRedirectUri);
    // The Entra token set is the payload the bridge exists to carry — assert it is stored
    // intact under the server code (Example 3), so exchangeAuthorizationCode returns it later.
    expect(record["tokens"]).toEqual({
      access_token: "entra-at-789",
      token_type: "Bearer",
      refresh_token: "entra-rt-012",
      expires_in: 3600,
    });
    expect(ttl).toBe(60);

    expect(res.redirect).toHaveBeenCalledOnce();
    const [status, redirectUrl] = res.redirect.mock.calls[0] as [number, string];
    expect(status).toBe(302);
    const url = new URL(redirectUrl);
    expect(url.origin + url.pathname).toBe("http://localhost:9999/callback");
    expect(url.searchParams.get("code")).toBe(serverCode);
    expect(url.searchParams.get("state")).toBe("client-state-xyz");
  });

  it("test_redirect_preserves_existing_query_and_encodes_state", async () => {
    const codeStore = makeCodeStoreMock();
    (codeStore.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...TXN_RECORD,
      clientRedirectUri: "http://localhost:9999/cb?foo=bar",
      clientState: "a&b=c",
    });
    const logger = makeLoggerMock();
    mockFetchSuccess({ access_token: "a", token_type: "Bearer" });

    const handler = createCallbackHandler(codeStore, ENTRA_CONFIG, logger);
    const res = makeRes();
    await handler(makeReq({ code: "entra-code", state: "txn-777" }), res, vi.fn());

    const [, redirectUrl] = res.redirect.mock.calls[0] as [number, string];
    const url = new URL(redirectUrl);
    expect(url.searchParams.get("foo")).toBe("bar");
    expect(url.searchParams.get("state")).toBe("a&b=c"); // URLSearchParams decodes on read
    expect(redirectUrl).toContain("state=a%26b%3Dc");
    expect(redirectUrl.indexOf("?")).toBe(redirectUrl.lastIndexOf("?")); // single '?'
  });

  it("test_entra_error_returns_502_no_redirect", async () => {
    const codeStore = makeCodeStoreMock();
    const logger = makeLoggerMock();
    const handler = createCallbackHandler(codeStore, ENTRA_CONFIG, logger);
    const res = makeRes();

    await handler(
      makeReq({ error: "access_denied", error_description: "User cancelled", state: "txn-999" }),
      res,
      vi.fn(),
    );

    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json).toHaveBeenCalledWith({ error: "upstream_error", error_description: "User cancelled" });
    expect(res.redirect).not.toHaveBeenCalled();
  });

  it("test_missing_state_returns_400", async () => {
    const codeStore = makeCodeStoreMock();
    const logger = makeLoggerMock();
    const handler = createCallbackHandler(codeStore, ENTRA_CONFIG, logger);
    const res = makeRes();

    await handler(makeReq({ code: "some-code" }), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "invalid_request", error_description: "Missing state parameter" });
    expect(res.redirect).not.toHaveBeenCalled();
  });

  it("test_unknown_txn_returns_400", async () => {
    const codeStore = makeCodeStoreMock();
    (codeStore.get as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const logger = makeLoggerMock();
    const handler = createCallbackHandler(codeStore, ENTRA_CONFIG, logger);
    const res = makeRes();

    await handler(makeReq({ code: "some-code", state: "expired-txn" }), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: "invalid_request",
      error_description: "Authorization transaction expired or not found",
    });
    expect(res.redirect).not.toHaveBeenCalled();
  });

  it("test_upstream_exchange_failure_returns_502_txn_preserved", async () => {
    const codeStore = makeCodeStoreMock();
    (codeStore.get as ReturnType<typeof vi.fn>).mockResolvedValue(TXN_RECORD);
    const logger = makeLoggerMock();
    global.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "invalid_grant" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
    ) as unknown as typeof fetch;

    const handler = createCallbackHandler(codeStore, ENTRA_CONFIG, logger);
    const res = makeRes();
    await handler(makeReq({ code: "bad-code", state: "txn-fail" }), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json).toHaveBeenCalledWith({
      error: "upstream_error",
      error_description: "Upstream token exchange failed",
    });
    expect(codeStore.del).not.toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
  });

  it("test_error_paths_never_leak_sensitive_values", async () => {
    const sensitiveValues = [
      TXN_RECORD.serverCodeVerifier,
      ENTRA_CONFIG.clientSecret,
      "entra-at-789",
      "entra-rt-012",
      "entra-auth-code-456",
    ];

    // Entra error path
    const codeStoreA = makeCodeStoreMock();
    const loggerA = makeLoggerMock();
    const resA = makeRes();
    await createCallbackHandler(codeStoreA, ENTRA_CONFIG, loggerA)(
      makeReq({ error: "access_denied", error_description: "User cancelled", state: "txn-999" }),
      resA,
      vi.fn(),
    );

    // Missing state path
    const codeStoreB = makeCodeStoreMock();
    const loggerB = makeLoggerMock();
    const resB = makeRes();
    await createCallbackHandler(codeStoreB, ENTRA_CONFIG, loggerB)(makeReq({ code: "entra-auth-code-456" }), resB, vi.fn());

    // Unknown txn path
    const codeStoreC = makeCodeStoreMock();
    (codeStoreC.get as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const loggerC = makeLoggerMock();
    const resC = makeRes();
    await createCallbackHandler(codeStoreC, ENTRA_CONFIG, loggerC)(
      makeReq({ code: "entra-auth-code-456", state: "expired-txn" }),
      resC,
      vi.fn(),
    );

    // Upstream exchange failure path
    const codeStoreD = makeCodeStoreMock();
    (codeStoreD.get as ReturnType<typeof vi.fn>).mockResolvedValue(TXN_RECORD);
    const loggerD = makeLoggerMock();
    global.fetch = vi.fn(async () => new Response("{}", { status: 400 })) as unknown as typeof fetch;
    const resD = makeRes();
    await createCallbackHandler(codeStoreD, ENTRA_CONFIG, loggerD)(
      makeReq({ code: "entra-auth-code-456", state: "txn-fail" }),
      resD,
      vi.fn(),
    );

    for (const res of [resA, resB, resC, resD]) {
      const bodies = res.json.mock.calls.map((call) => JSON.stringify(call[0]));
      for (const body of bodies) {
        for (const sensitive of sensitiveValues) {
          expect(body).not.toContain(sensitive);
        }
      }
    }
    for (const logger of [loggerA, loggerB, loggerC, loggerD]) {
      const warnCalls = (logger.warn as ReturnType<typeof vi.fn>).mock.calls.map((call) => JSON.stringify(call));
      for (const call of warnCalls) {
        for (const sensitive of sensitiveValues) {
          expect(call).not.toContain(sensitive);
        }
      }
    }
  });
});
