/*
 * EntraProxyOAuthServerProvider — rewrites the outbound OAuth request so Microsoft Entra
 * accepts it. The stock ProxyOAuthServerProvider forwards the DCR client's identity
 * (random client_id), bare `scope=mcp`, and the MCP server URL as `resource` verbatim,
 * all of which Entra rejects. This subclass must send, on authorize + both token exchanges:
 *   - client_id = ENTRA_CLIENT_ID (the real App Registration, not the DCR id)
 *   - client_secret = ENTRA_CLIENT_SECRET, but ONLY when configured (guard)
 *   - scope = api://<clientId>/mcp
 *   - resource = api://<clientId>
 */

import { describe, it, expect, vi } from "vitest";
import type { Response } from "express";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";

import { EntraProxyOAuthServerProvider } from "../../../http/auth/build.js";

const CLIENT_ID = "11111111-2222-3333-4444-555555555555";
const CLIENT_SECRET = "entra-secret-value";
const ENDPOINTS = {
  authorizationUrl: "https://login.microsoftonline.com/tenant-abc/oauth2/v2.0/authorize",
  tokenUrl: "https://login.microsoftonline.com/tenant-abc/oauth2/v2.0/token",
};
// The DCR client the MCP client registered with us — random id, no secret (public).
const CLIENT = {
  client_id: "dcr-client-1",
  redirect_uris: ["http://localhost:9999/callback"],
} as OAuthClientInformationFull;

const tokenResponse: FetchLike = async () =>
  new Response(JSON.stringify({ access_token: "a", token_type: "Bearer" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

function makeProvider(fetchImpl?: FetchLike, clientSecret?: string): EntraProxyOAuthServerProvider {
  return new EntraProxyOAuthServerProvider(
    {
      endpoints: ENDPOINTS,
      verifyAccessToken: async () => ({ token: "t", clientId: "c", scopes: [] }),
      getClient: async () => CLIENT,
      fetch: fetchImpl,
    },
    CLIENT_ID,
    "mcp",
    clientSecret,
  );
}

describe("EntraProxyOAuthServerProvider — Entra identity/scope/resource rewrite", () => {
  it("authorize sends ENTRA_CLIENT_ID, a fully-qualified scope, and App-ID-URI resource", async () => {
    let redirectedUrl = "";
    const res = { redirect: (url: string) => (redirectedUrl = url) } as unknown as Response;

    await makeProvider(undefined, CLIENT_SECRET).authorize(
      CLIENT,
      {
        redirectUri: "http://localhost:9999/callback",
        codeChallenge: "challenge",
        scopes: ["mcp"], // bare scope from the client — must be rewritten
        resource: new URL("https://xero-mcp-dev.example.ts.net/"), // server URL — must be rewritten
        state: "xyz",
      },
      res,
    );

    const params = new URL(redirectedUrl).searchParams;
    expect(params.get("client_id")).toBe(CLIENT_ID); // NOT the DCR "dcr-client-1"
    expect(params.get("scope")).toBe(`api://${CLIENT_ID}/mcp`);
    expect(params.get("resource")).toBe(`api://${CLIENT_ID}`);
  });

  it("exchangeAuthorizationCode sends ENTRA_CLIENT_ID + secret + App-ID-URI resource", async () => {
    let body = "";
    const fetchImpl = vi.fn<FetchLike>(async (_url, init) => {
      body = String(init?.body ?? "");
      return tokenResponse(_url, init);
    });

    await makeProvider(fetchImpl, CLIENT_SECRET).exchangeAuthorizationCode(
      CLIENT,
      "code-123",
      "verifier",
      "http://localhost:9999/callback",
    );

    const params = new URLSearchParams(body);
    expect(params.get("client_id")).toBe(CLIENT_ID);
    expect(params.get("client_secret")).toBe(CLIENT_SECRET);
    expect(params.get("resource")).toBe(`api://${CLIENT_ID}`);
  });

  it("exchangeRefreshToken sends ENTRA_CLIENT_ID + secret + fully-qualified scope + resource", async () => {
    let body = "";
    const fetchImpl = vi.fn<FetchLike>(async (_url, init) => {
      body = String(init?.body ?? "");
      return tokenResponse(_url, init);
    });

    await makeProvider(fetchImpl, CLIENT_SECRET).exchangeRefreshToken(CLIENT, "refresh-token");

    const params = new URLSearchParams(body);
    expect(params.get("client_id")).toBe(CLIENT_ID);
    expect(params.get("client_secret")).toBe(CLIENT_SECRET);
    expect(params.get("scope")).toBe(`api://${CLIENT_ID}/mcp`);
    expect(params.get("resource")).toBe(`api://${CLIENT_ID}`);
  });

  it("guard: with no client secret configured, no client_secret is sent (public/PKCE)", async () => {
    let body = "";
    const fetchImpl = vi.fn<FetchLike>(async (_url, init) => {
      body = String(init?.body ?? "");
      return tokenResponse(_url, init);
    });

    // No secret passed to makeProvider → guard off.
    await makeProvider(fetchImpl).exchangeAuthorizationCode(CLIENT, "code-123", "verifier", "http://localhost:9999/callback");

    const params = new URLSearchParams(body);
    expect(params.get("client_id")).toBe(CLIENT_ID); // still substitutes the app id
    expect(params.get("client_secret")).toBeNull(); // but sends no secret
  });
});
