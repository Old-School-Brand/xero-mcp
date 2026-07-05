/*
 * EntraProxyOAuthServerProvider — rewrites the outbound OAuth request so Microsoft Entra
 * accepts it, and sends the client_secret only for the confidential (claude.ai) flow.
 * On authorize + both token exchanges it must send:
 *   - client_id = ENTRA_CLIENT_ID (the real App Registration, not the random DCR id)
 *   - scope = api://<clientId>/mcp
 *   - resource = api://<clientId>
 * And on the token exchanges, client_secret = ENTRA_CLIENT_SECRET ONLY when:
 *   - a secret is configured, AND
 *   - the flow is confidential (a NON-loopback redirect, e.g. claude.ai's web callback).
 * Loopback redirects (Claude Code / desktop, http://localhost:<port>/…) are public/PKCE —
 * Entra forbids a secret there, so none is sent. A DCR client's own secret is never forwarded.
 */

import { describe, it, expect, vi } from "vitest";
import type { Response } from "express";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";

import { EntraProxyOAuthServerProvider } from "../../../http/auth/build.js";

const CLIENT_ID = "11111111-2222-3333-4444-555555555555";
const CLIENT_SECRET = "entra-secret-value";
const LOOPBACK = "http://localhost:9999/callback"; // Claude Code — public
const CLAUDE_AI = "https://claude.ai/api/mcp/auth_callback"; // claude.ai connector — confidential
const ENDPOINTS = {
  authorizationUrl: "https://login.microsoftonline.com/tenant-abc/oauth2/v2.0/authorize",
  tokenUrl: "https://login.microsoftonline.com/tenant-abc/oauth2/v2.0/token",
};
const PUBLIC_CLIENT = { client_id: "dcr-public", redirect_uris: [LOOPBACK] } as OAuthClientInformationFull;
const CONFIDENTIAL_CLIENT = { client_id: "dcr-conf", redirect_uris: [CLAUDE_AI] } as OAuthClientInformationFull;

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
      getClient: async () => PUBLIC_CLIENT,
      fetch: fetchImpl,
    },
    CLIENT_ID,
    "mcp",
    clientSecret,
  );
}

function captureBody(): { fetchImpl: FetchLike; body: () => string } {
  let body = "";
  const fetchImpl = vi.fn<FetchLike>(async (_url, init) => {
    body = String(init?.body ?? "");
    return tokenResponse(_url, init);
  });
  return { fetchImpl, body: () => body };
}

describe("EntraProxyOAuthServerProvider — Entra identity/scope/resource rewrite", () => {
  it("authorize sends ENTRA_CLIENT_ID, a fully-qualified scope, and App-ID-URI resource", async () => {
    let redirectedUrl = "";
    const res = { redirect: (url: string) => (redirectedUrl = url) } as unknown as Response;

    await makeProvider(undefined, CLIENT_SECRET).authorize(
      PUBLIC_CLIENT,
      { redirectUri: LOOPBACK, codeChallenge: "challenge", scopes: ["mcp"], resource: new URL("https://xero-mcp-dev.example.ts.net/"), state: "xyz" },
      res,
    );

    const params = new URL(redirectedUrl).searchParams;
    expect(params.get("client_id")).toBe(CLIENT_ID); // NOT the DCR "dcr-public"
    expect(params.get("scope")).toBe(`api://${CLIENT_ID}/mcp`);
    expect(params.get("resource")).toBe(`api://${CLIENT_ID}`);
  });
});

describe("EntraProxyOAuthServerProvider — per-client secret", () => {
  it("public (loopback) auth-code exchange: substitutes client_id, resource, and sends NO secret", async () => {
    const { fetchImpl, body } = captureBody();
    await makeProvider(fetchImpl, CLIENT_SECRET).exchangeAuthorizationCode(PUBLIC_CLIENT, "code-123", "verifier", LOOPBACK);

    const p = new URLSearchParams(body());
    expect(p.get("client_id")).toBe(CLIENT_ID);
    expect(p.get("resource")).toBe(`api://${CLIENT_ID}`);
    expect(p.get("client_secret")).toBeNull(); // loopback ⇒ public ⇒ no secret
  });

  it("confidential (claude.ai) auth-code exchange: sends the secret", async () => {
    const { fetchImpl, body } = captureBody();
    await makeProvider(fetchImpl, CLIENT_SECRET).exchangeAuthorizationCode(CONFIDENTIAL_CLIENT, "code-123", "verifier", CLAUDE_AI);

    const p = new URLSearchParams(body());
    expect(p.get("client_id")).toBe(CLIENT_ID);
    expect(p.get("client_secret")).toBe(CLIENT_SECRET); // web redirect ⇒ confidential ⇒ secret
    expect(p.get("resource")).toBe(`api://${CLIENT_ID}`);
  });

  it("refresh: public client (loopback redirects) sends no secret; confidential client sends it", async () => {
    const pub = captureBody();
    await makeProvider(pub.fetchImpl, CLIENT_SECRET).exchangeRefreshToken(PUBLIC_CLIENT, "rt");
    expect(new URLSearchParams(pub.body()).get("client_secret")).toBeNull();

    const conf = captureBody();
    await makeProvider(conf.fetchImpl, CLIENT_SECRET).exchangeRefreshToken(CONFIDENTIAL_CLIENT, "rt");
    const cp = new URLSearchParams(conf.body());
    expect(cp.get("client_id")).toBe(CLIENT_ID);
    expect(cp.get("client_secret")).toBe(CLIENT_SECRET);
    expect(cp.get("scope")).toBe(`api://${CLIENT_ID}/mcp`);
  });

  it("guard: with no secret configured, none is sent even on a confidential redirect", async () => {
    const { fetchImpl, body } = captureBody();
    await makeProvider(fetchImpl).exchangeAuthorizationCode(CONFIDENTIAL_CLIENT, "code-123", "verifier", CLAUDE_AI);

    const p = new URLSearchParams(body());
    expect(p.get("client_id")).toBe(CLIENT_ID);
    expect(p.get("client_secret")).toBeNull();
  });

  it("guard: a DCR client's own client_secret is never forwarded upstream", async () => {
    // Open DCR lets a client register with a confidential auth method; the SDK mints a
    // server-side secret on the client record. It must never leak to Entra.
    const confidentialDcrClient = {
      client_id: "dcr-public",
      client_secret: "dcr-internal-secret-should-never-reach-entra",
      redirect_uris: [LOOPBACK],
    } as OAuthClientInformationFull;

    const { fetchImpl, body } = captureBody();
    // Even with an Entra secret configured, a loopback flow must send no secret at all.
    await makeProvider(fetchImpl, CLIENT_SECRET).exchangeAuthorizationCode(confidentialDcrClient, "code-123", "verifier", LOOPBACK);

    const p = new URLSearchParams(body());
    expect(p.get("client_secret")).toBeNull();
  });
});
