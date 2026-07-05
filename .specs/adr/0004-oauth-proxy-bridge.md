# 0004. OAuth-proxy bridge replaces dumb-forward proxy

| Field       | Value                                                                        |
|-------------|------------------------------------------------------------------------------|
| Status      | Accepted                                                                     |
| Date        | 2026-07-05                                                                   |
| Decided by  | Llewellyn Strydom (CTO)                                                      |
| Source      | `.specs/003-oauth-proxy-bridge/backend/requirements.md`, cin7-mcp FastMCP `OAuthProxy` |
| Supersedes  | 0002 (decision 2 only — OAuth handshake model)                               |

## Context

ADR-0002 decision 2 established that the MCP TS SDK's `ProxyOAuthServerProvider` proxies `/authorize` and `/token` to Entra ID, forwarding the MCP client's `redirect_uri` and PKCE challenge to Entra verbatim. This works when every MCP client's redirect URI is registered in the Entra app and the client type (public vs confidential) aligns with what Entra expects for that redirect.

In practice, this creates an unresolvable conflict:

- **Loopback clients** (Claude Code, local Docker) present `http://localhost:<port>/callback` or `http://127.0.0.1:<port>/callback`. Entra classifies these as public clients and rejects a `client_secret` on the token exchange.
- **Web clients** (claude.ai, Claude Desktop web) present `https://claude.ai/api/mcp/auth_callback`. Entra classifies this as a confidential redirect and requires a `client_secret`.

A single global secret policy cannot satisfy both. The org owner cannot privately test the dev instance in Claude Code while prod runs on claude.ai — one client type always fails.

The sibling `cin7-mcp` (FastMCP `OAuthProxy`) solves this by **never forwarding the MCP client's redirect to Entra**. Instead, it terminates the Entra authorization-code flow at the server's own fixed `/auth/callback`, stores the MCP client's redirect and PKCE in short-lived server state, performs the entire Entra exchange server-side as a confidential client, mints its own authorization code, and redirects back to the MCP client. This is the "OAuth-proxy bridge" pattern.

## Decision

Replace the `EntraProxyOAuthServerProvider` (dumb-forward subclass of `ProxyOAuthServerProvider`) with an `EntraBridgeProvider` that implements the OAuth-proxy bridge pattern:

1. **`authorize`** stores a short-lived transaction (client redirect, state, PKCE challenge) in Redis, generates the server's own PKCE pair, and redirects the browser to Entra with `redirect_uri={MCP_SERVER_URL}/auth/callback`, `client_id=ENTRA_CLIENT_ID`, and the server's PKCE challenge. The MCP client's redirect URI never reaches Entra.

2. **`GET /auth/callback`** (new Express route) receives the Entra callback, loads the transaction, exchanges the Entra code server-side using `ENTRA_CLIENT_ID` + `ENTRA_CLIENT_SECRET` + the server's `code_verifier`, mints a single-use server authorization code bound to the client's PKCE challenge and the Entra token set, and redirects the browser to the MCP client's stored redirect URI.

3. **`challengeForAuthorizationCode`** returns the stored client PKCE challenge. The SDK validates the client's `code_verifier` locally (`skipLocalPkceValidation = false`).

4. **`exchangeAuthorizationCode`** returns the stored Entra tokens and consumes the server code with a single atomic Redis `GETDEL` (single-use, race-safe). Code-not-found (expired/replayed) throws `InvalidGrantError` → HTTP 400 `invalid_grant` (not `ServerError`, which would be HTTP 500).

5. **`exchangeRefreshToken`** substitutes the Entra client identity (same as the old subclass) and delegates to the parent.

6. **`ENTRA_CLIENT_SECRET`** becomes required in non-local mode (was optional as a public/confidential guard; the bridge always uses confidential).

7. **Two independent PKCE pairs** protect the flow:
   - Client ↔ Server: the MCP client's challenge/verifier, validated by the SDK at `/token` time.
   - Server ↔ Entra: the server's challenge/verifier, used in the server-side Entra exchange.

All other ADR-0002 decisions remain in force: Streamable HTTP transport (decision 1), local static bearer (decision 3), Express 5 (decision 4), upstream isolation under `src/http/` (decision 5).

## Consequences

**Positive:**
- All MCP client types work uniformly. Entra only ever sees the server's fixed confidential callback, regardless of whether the MCP client is loopback or web.
- Dev testing in Claude Code and prod via claude.ai work without code changes or Entra app reconfiguration per client type.
- Parity with cin7-mcp's auth model (same pattern, different language).
- The per-client-secret guard and scope/resource forwarding rewrites are eliminated, simplifying the code.
- `ENTRA_CLIENT_SECRET` is always required in non-local mode, removing the ambiguity of the optional guard.

**Negative:**
- The server now holds Entra tokens briefly in Redis (in the server-code record, 60s TTL). The dumb-forward proxy never touched tokens. Mitigation: tokens are stored with a very short TTL and auto-expire; Redis is cluster-internal.
- The Entra app registration must register the server's `/auth/callback` and remove the old client-specific redirects. This is a one-time operational change that must deploy simultaneously.
- The bridge is ~100-120 LOC of substantive logic vs the dumb-forward subclass's ~35. The additional complexity is justified by the functional requirement (uniform client-type support) and is bounded by subclassing (refresh/verify/revoke/clientsStore inherited unchanged).

**Accepted trade-off — `challengeForAuthorizationCode` peeks the server code without consuming it:**
The SDK's `/token` handler calls `challengeForAuthorizationCode` (to get the client PKCE challenge) *before* `exchangeAuthorizationCode` (which consumes the code). So the challenge lookup is a non-consuming *peek*; only the exchange is the atomic `GETDEL`. This means an attacker submitting an incorrect `code_verifier` learns a code exists without consuming it, and could retry with different verifiers within the 60s TTL. We accept this: the client PKCE challenge is a SHA-256 hash — brute-forcing a valid verifier within 60s is infeasible — and making the challenge-lookup consuming would require reimplementing the SDK's token handler (the two calls are separate methods by design), which is not worth the cost for a private-fork server. The atomic `GETDEL` on exchange still guarantees a code can be *redeemed* at most once even under concurrency (AC 4).

## Alternatives Considered

- **Register every possible client redirect URI in Entra** — rejected. MCP clients use dynamic ports (Claude Code picks a random loopback port), making it impossible to pre-register all redirects. Even with wildcard-capable IdPs, Entra does not support wildcard redirect URIs.

- **Two Entra app registrations (one public, one confidential)** — rejected. Doubles operational overhead. The server would need to route to the correct app based on client type, reintroducing the per-client branching this feature eliminates.

- **Adopt FastMCP's full token factory (JWT minting, JTI indirection, consent UI)** — rejected. Over-engineered for this use case. We pass Entra tokens through to the client and keep `EntraVerifier` unchanged. No JWT minting needed.
