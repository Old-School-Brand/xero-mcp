/*
 * EntraProxyOAuthServerProvider — rewrites the outbound OAuth `scope` and `resource`
 * so Microsoft Entra accepts them (fixes AADSTS9010010). The stock ProxyOAuthServerProvider
 * forwards the client's bare `scope=mcp` + the MCP server URL as `resource`, which Entra
 * rejects. This subclass must send `scope=api://<clientId>/mcp` and `resource=api://<clientId>`
 * on authorize, the auth-code exchange, and the refresh exchange.
 */

import { describe, it, expect, vi } from "vitest";
import type { Response } from "express";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";

import { EntraProxyOAuthServerProvider } from "../../../http/auth/build.js";

const CLIENT_ID = "11111111-2222-3333-4444-555555555555";
const ENDPOINTS = {
  authorizationUrl: "https://login.microsoftonline.com/tenant-abc/oauth2/v2.0/authorize",
  tokenUrl: "https://login.microsoftonline.com/tenant-abc/oauth2/v2.0/token",
};
const CLIENT = {
  client_id: "dcr-client-1",
  redirect_uris: ["http://localhost:9999/callback"],
} as OAuthClientInformationFull;

const tokenResponse: FetchLike = async () =>
  new Response(JSON.stringify({ access_token: "a", token_type: "Bearer" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

function makeProvider(fetchImpl?: FetchLike): EntraProxyOAuthServerProvider {
  return new EntraProxyOAuthServerProvider(
    {
      endpoints: ENDPOINTS,
      verifyAccessToken: async () => ({ token: "t", clientId: "c", scopes: [] }),
      getClient: async () => CLIENT,
      fetch: fetchImpl,
    },
    CLIENT_ID,
    "mcp",
  );
}

describe("EntraProxyOAuthServerProvider — Entra scope/resource rewrite", () => {
  it("authorize sends a fully-qualified scope and App-ID-URI resource", async () => {
    let redirectedUrl = "";
    const res = { redirect: (url: string) => (redirectedUrl = url) } as unknown as Response;

    await makeProvider().authorize(
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
    expect(params.get("scope")).toBe(`api://${CLIENT_ID}/mcp`);
    expect(params.get("resource")).toBe(`api://${CLIENT_ID}`);
  });

  it("exchangeAuthorizationCode sends the App-ID-URI resource, not the client's", async () => {
    let body = "";
    const fetchImpl = vi.fn<FetchLike>(async (_url, init) => {
      body = String(init?.body ?? "");
      return tokenResponse(_url, init);
    });

    await makeProvider(fetchImpl).exchangeAuthorizationCode(
      CLIENT,
      "code-123",
      "verifier",
      "http://localhost:9999/callback",
    );

    expect(new URLSearchParams(body).get("resource")).toBe(`api://${CLIENT_ID}`);
  });

  it("exchangeRefreshToken sends the fully-qualified scope and App-ID-URI resource", async () => {
    let body = "";
    const fetchImpl = vi.fn<FetchLike>(async (_url, init) => {
      body = String(init?.body ?? "");
      return tokenResponse(_url, init);
    });

    await makeProvider(fetchImpl).exchangeRefreshToken(CLIENT, "refresh-token");

    const params = new URLSearchParams(body);
    expect(params.get("scope")).toBe(`api://${CLIENT_ID}/mcp`);
    expect(params.get("resource")).toBe(`api://${CLIENT_ID}`);
  });
});
