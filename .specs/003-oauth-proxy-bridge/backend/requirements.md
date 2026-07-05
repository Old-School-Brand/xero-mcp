# Requirements: OAuth-Proxy Bridge for Entra (MCP HTTP auth)

**Layer:** backend
**Status:** Confirmed
**Last updated:** 2026-07-05

> Discovery for this feature was completed through an extended planning session (root-cause
> analysis against the working `cin7-mcp` reference, two research passes on FastMCP's `OAuthProxy`
> and the MCP TS SDK, a security-review of the interim approach, and a staff-review of "are we
> building the right thing"). The approved plan is the authoritative brief. This document encodes
> that outcome; it is not the product of a fresh interrogation.

## Problem Statement
The deployed xero-mcp HTTP server authenticates MCP clients to Microsoft Entra using the MCP SDK's
`ProxyOAuthServerProvider`, which **forwards the MCP client's own `redirect_uri` to Entra**. Because
Entra classifies the flow by the redirect it receives, the client type leaks into the upstream leg:
loopback redirects (Claude Code / local Docker) are treated as *public* (PKCE, secret forbidden) and
`https://claude.ai/...` as *confidential* (secret required). A single global secret policy cannot
satisfy both, so the org owner **cannot privately test the dev instance in Claude Code** (loopback)
the way they always have with `cin7-mcp` — signing in fails at the Entra token exchange (401).

The sibling `cin7-mcp` (FastMCP `OAuthProxy`) does not have this problem: it **terminates the Entra
login at its own fixed `/auth/callback` and bridges the code back to the MCP client**, so Entra only
ever sees one fixed confidential callback and every client type works uniformly. We must replicate
that bridge in this TypeScript server so the established workflow holds — **dev in Claude Code
(remote + local Docker), prod in claude.ai/Desktop**.

## Goals
- The server terminates the upstream (Entra) authorization-code flow at its **own** fixed
  `{MCP_SERVER_URL}/auth/callback` and bridges a freshly minted code back to the MCP client.
- Entra only ever receives the server's fixed callback + confidential `client_id`+`client_secret` —
  never the MCP client's redirect. Consequently **all client types work uniformly**: Claude Code
  (loopback), local Docker (loopback on `http://localhost:8000`), claude.ai/Desktop (web).
- The per-client-secret branching and the client_id/scope/resource *forwarding* rewrites are
  **removed** — the server↔Entra leg is a single, uniform confidential flow.
- **Core implementation is small and maintainable: ≤ ~100 LOC (target 50–100), excluding tests and
  docs.** Simplicity is a first-class acceptance criterion.

## Non-Goals
- **No JWT-minting / JTI-indirection layer** (FastMCP mints its own tokens; we pass the Entra tokens
  through to the client and keep `verifyAccessToken`/`EntraVerifier` unchanged).
- **No consent-screen interstitial** (Entra performs consent).
- **No bespoke refresh-token machinery** — inherit the SDK's refresh handling.
- **No change to the local (`ENVIRONMENT=local`) static-bearer path** — the bridge exists only in the
  non-local (Entra) branch of `buildAuth`.
- **The Entra app-registration redirect change is out of scope for this (backend) layer** — it is a
  cloud-infra dependency (see Dependencies) that must ship together with this change.
- No change to the Xero refresh-token data plane, tools, or read-only posture.

## Functional Requirements

1. **FR-1 — Authorize starts a bridged transaction.**
   Given a registered DCR client calls `GET /authorize` with its `redirect_uri`, `state`,
   `code_challenge` (+method), and `scope`,
   When the non-local (Entra) provider handles it,
   Then the server stores `{client_redirect_uri, client_state, client_code_challenge(+method)}`
   under a random `txn_id` in Redis with a short TTL, generates its **own** PKCE pair, and
   `302`-redirects the browser to Entra's authorize endpoint with `redirect_uri={MCP_SERVER_URL}/auth/callback`,
   `state=txn_id`, the server's `code_challenge`(S256), and `scope=api://<ENTRA_CLIENT_ID>/mcp`
   (the RFC 8707 `resource` parameter is not sent).

2. **FR-2 — Callback exchanges upstream and bridges back.**
   Given Entra redirects the browser to `GET /auth/callback?code=<entra_code>&state=<txn_id>`,
   When the callback route handles it,
   Then the server loads the transaction by `txn_id`, exchanges `<entra_code>` at Entra's token
   endpoint using `ENTRA_CLIENT_ID`+`ENTRA_CLIENT_SECRET`+the server's `code_verifier`+
   `redirect_uri={MCP_SERVER_URL}/auth/callback`, mints a **single-use server authorization code**
   bound to `{client_code_challenge, client_redirect_uri, the Entra token set}` (stored in Redis with
   a short TTL), deletes the transaction, and `302`-redirects the browser to the stored
   `client_redirect_uri` with `code=<server_code>` and the client's original `state`.

3. **FR-3 — Token exchange returns the Entra tokens.**
   Given the MCP client redeems `<server_code>` at `POST /token` with its `code_verifier`,
   When the SDK token handler runs (with `skipLocalPkceValidation = false`),
   Then the server validates the client's `code_verifier` against the stored `client_code_challenge`
   (via `challengeForAuthorizationCode`), returns the stored Entra token set from
   `exchangeAuthorizationCode`, and the server code is consumed (single-use).

4. **FR-4 — Uniform confidential upstream leg.**
   Given any MCP client type (loopback or web),
   When the server talks to Entra,
   Then it always uses `client_id=ENTRA_CLIENT_ID` + `client_secret=ENTRA_CLIENT_SECRET` +
   `redirect_uri={MCP_SERVER_URL}/auth/callback`. No per-client public/confidential branching exists.

5. **FR-5 — Discovery metadata unchanged for clients.**
   Given a client reads `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource`,
   Then `/authorize`, `/token`, `/register` and `scopes_supported: ["mcp"]` are advertised as today;
   `/auth/callback` is a server-internal route (not advertised as a client endpoint).

6. **FR-6 — `verifyAccessToken` unchanged.**
   Given a client calls `/mcp` with the issued access token,
   Then `EntraVerifier` validates it exactly as today (issuer, `aud=api://<ENTRA_CLIENT_ID>`,
   `scp` contains `mcp`). No verifier change.

7. **FR-7 — Failure handling (fail loud).**
   Given a `/auth/callback` request with a missing/expired/unknown `txn_id`, an Entra `error`
   parameter, or a failed upstream token exchange,
   Then the server responds with a clear `4xx`/`5xx` (no redirect to an attacker-influenced URI, no
   silent success). Given `/token` with an unknown/expired/reused server code, Then it fails per the
   SDK's standard invalid-grant handling.

## Acceptance Criteria

- **AC 1 — Loopback (Claude Code / local Docker) sign-in completes**
  - Given the deployed dev server (non-local/Entra) and the Entra app registering
    `{server}/auth/callback`, when Claude Code (`http://localhost:<port>/callback`) runs the OAuth
    flow, then authorize→callback→token completes and the client receives a valid Entra access token
    (no `AADSTS9010010`, no token-exchange 401).
- **AC 2 — Web (claude.ai) sign-in completes**
  - Given the same server, when a claude.ai connector (`https://claude.ai/api/mcp/auth_callback`) runs
    the flow, then it completes and receives a valid token — with no code changes between the two client
    types.
- **AC 3 — Entra only ever sees the fixed callback**
  - Given a DCR + `/authorize` probe with any client `redirect_uri`, when the server redirects to
    Entra, then the upstream `redirect_uri` is always `{MCP_SERVER_URL}/auth/callback` and `client_id`
    is always `ENTRA_CLIENT_ID` — never the client's redirect or DCR id.
- **AC 4 — Server code is single-use and time-bound**
  - Given a minted server code, when it is redeemed once then replayed, then the second `/token`
    fails; and a code unused past its TTL fails.
- **AC 5 — State + PKCE are correctly bridged**
  - Given the client's original `state`, when the bridge redirects back to the client, then the
    client's `state` (not the `txn_id`) is returned; and the client's `code_verifier` is validated
    against the client's `code_challenge` at `/token`.
- **AC 6 — Legacy forwarding logic removed**
  - Given the new provider, when the code is reviewed, then the per-client `client_secret` guard and
    the redirect/scope/resource *forwarding* rewrites of the old `EntraProxyOAuthServerProvider` are
    gone (superseded by the bridge's uniform confidential upstream construction).
- **AC 7 — Minimal, maintainable implementation**
  - Given the finished feature, when non-test/non-doc implementation lines are counted, then the core
    is ≤ ~100 LOC (target 50–100), achieved by subclassing `ProxyOAuthServerProvider` (inheriting
    `exchangeRefreshToken`/`verifyAccessToken`/`revokeToken`/`clientsStore`), overriding only
    `authorize` + `challengeForAuthorizationCode` + `exchangeAuthorizationCode`, one tight
    `/auth/callback` handler, and one small Redis txn/code helper.
- **AC 8 — Security properties hold** (for the security-reviewer)
  - Two independent PKCE pairs (client↔server, server↔Entra); server codes single-use with TTL; txn
    short TTL; client `state` preserved and `txn_id` used only as upstream state; no access/refresh
    token, `client_secret`, or PKCE verifier written to logs or error responses.
- [ ] `.env.example` and `README`/`.specs/REPO.md` auth notes updated to describe the bridge + the
  `{MCP_SERVER_URL}/auth/callback` requirement.
- [ ] An ADR is added/updated (supersedes the relevant part of ADR-0002) recording the move from
  dumb-forward proxy to the OAuth-proxy bridge.

## Dependencies
- **Entra app registration (cloud-infra, `modules/xero-mcp`) — gated, ships WITH this deploy.**
  Register the **server** callbacks under the Web platform:
  `https://xero-mcp.tailbda87a.ts.net/auth/callback`,
  `https://xero-mcp-dev.tailbda87a.ts.net/auth/callback`, `http://localhost:8000/auth/callback`;
  **remove** the client redirects (`https://claude.ai/api/mcp/auth_callback`,
  `http://localhost/callback`, `http://127.0.0.1/callback`); keep the client secret. Mirrors
  `modules/cin7-mcp`. If the app and this Entra change do not land together, dev auth breaks.
- **Redis/Valkey** (already required in non-local mode) for the txn + code stores.
- Reference implementation to mirror: FastMCP `OAuthProxy`
  (`cin7-mcp/.venv/.../fastmcp/server/auth/oauth_proxy/{proxy.py,consent.py}`, `providers/azure.py`).
- MCP SDK `OAuthServerProvider` interface (`@modelcontextprotocol/sdk/.../server/auth/provider.d.ts`);
  Express app + `mcpAuthRouter` in `src/http/server.ts`.

## Open Questions
Resolved with sensible defaults (foundry may refine): txn TTL ≈ 10 min; server-code TTL ≈ 60 s,
single-use; Redis key namespaces `oauth:txn:<id>` and `oauth:code:<code>` (mirroring
`oauth:clients:` in `redis-clients-store.ts`); `txn_id` and server code are cryptographically random.
No blocking open questions for foundry.

## Glossary additions
- **OAuth-proxy bridge** — server-side pattern where the MCP server terminates the upstream IdP
  (Entra) authorization-code flow at its own fixed `/auth/callback`, holding the MCP client's
  redirect+PKCE in short-lived server state and issuing its own code back to the client. Aliases to
  avoid: "OAuth passthrough", "dumb proxy" (that is the superseded behaviour).
- **Transaction (OAuth `txn`)** — the short-lived server-side record (keyed by `txn_id`, used as the
  upstream `state`) holding a client's redirect_uri, state, PKCE challenge, and the server's own PKCE
  verifier during a single in-flight authorization. (The client's requested scopes are not stored —
  the upstream Entra scope is fixed.) Aliases to avoid: "session" (means the MCP session elsewhere).
