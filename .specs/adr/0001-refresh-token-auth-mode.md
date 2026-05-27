# 0001. Refresh Token mode replaces Custom Connection and Bearer Token auth

| Field       | Value                                                                      |
|-------------|----------------------------------------------------------------------------|
| Status      | Accepted                                                                   |
| Date        | 2026-05-24                                                                 |
| Decided by  | Llewellyn Strydom (CTO)                                                    |
| Source      | `.specs/001-oauth2-web-app-auth/backend/requirements.md`, `src/clients/xero-client.ts` |
| Supersedes  | --                                                                         |

## Context

The upstream Xero MCP server authenticates using two modes: Custom Connection (client credentials grant) and Bearer Token (pre-issued access token). Custom Connections are only available to Xero organisations registered in the UK, US, or New Zealand. The maintainer of this fork operates outside those regions and cannot use Custom Connections.

Xero Web Applications (available in all regions) use the OAuth2 authorization code flow and issue refresh tokens. The refresh token can be exchanged for a new access token and a rotated refresh token via `POST /connect/token` with `grant_type=refresh_token`.

The existing two-mode auth system also has a design issue: `authenticate()` is called on every handler invocation, performing a full token exchange each time. This is unnecessary network overhead.

## Decision

We replace both `CustomConnectionsXeroClient` and `BearerTokenXeroClient` with a single `RefreshTokenXeroClient` class that:

1. Reads a refresh token from a token file (default: `~/.xero-mcp/refresh_token`) or the `XERO_REFRESH_TOKEN` env var.
2. Exchanges it at startup for an access token via `POST https://identity.xero.com/connect/token` with `grant_type=refresh_token`.
3. Persists the rotated refresh token to the token file with `0600` permissions after every exchange.
4. Schedules proactive in-process token renewal via `setTimeout` at `expires_in - 300` seconds.
5. Crashes the process if any scheduled refresh fails.

The `authenticate()` method becomes a no-op guard after startup. Handlers continue to call it (preserving the existing pattern and upstream merge compatibility), but it does no work after the initial startup authentication.

All dead code related to Custom Connections and Bearer Tokens is removed from `src/`.

## Consequences

**Positive:**
- The fork works in all Xero regions, not just UK/US/NZ.
- One auth mode to understand and maintain instead of two.
- Token exchange happens once at startup plus proactively on a timer, not on every handler call (net performance improvement).
- Rotated refresh tokens are persisted, so server restarts use the latest valid token automatically.
- Fail-fast startup: invalid credentials or expired tokens surface immediately, not on the first tool call.

**Negative:**
- This is a deliberate divergence from upstream. Upstream merges that touch `src/clients/xero-client.ts` will require manual conflict resolution.
- The user must obtain the initial refresh token externally (via the Xero API Explorer) and set it as an env var before first run. This is a one-time manual step.
- If the server crashes during a scheduled refresh, the token file may contain a token that Xero has already rotated past. The user must re-obtain a fresh token. (This is inherent to Xero's token rotation model, not a design choice.)

## Alternatives Considered

- **Keep Custom Connections and add Refresh Token as a third mode** -- rejected because it adds complexity (three code paths instead of one) and Custom Connections are unusable for the fork maintainer. YAGNI: if no one using this fork has a Custom Connection, there is no reason to maintain that code path.
- **Use `openid-client` library for the token exchange** -- rejected because the exchange is a single `POST` with Basic auth. `axios` is already available as a transitive dependency and already used in the existing code. Adding an OIDC client library for one HTTP call violates KISS.
- **Store the refresh token in an env var only (no file)** -- rejected because Xero rotates the refresh token on every exchange, so the env var value becomes stale after the first startup. A file allows the rotated token to persist across restarts without the user updating their env.

## Amendment (2026-05-27, feature 002-http-transport-and-oauth / infra)

Decision point 3 ("persists the rotated refresh token to the token file") was **extended**, not superseded. Token persistence is now backed by a **token store** selected by `XERO_TOKEN_STORE`:

- `file` (default, unchanged) — the original `0600` token-file behaviour. The stdio entry and local dev use this and need no Redis.
- `redis` — the rotated token is read from / written to a Redis key (default `xero:refresh_token`, overridable via `XERO_TOKEN_REDIS_KEY`). Used by the deployed HTTP mode so pods stay stateless (no PVC).

`xero-client.ts` is already fork-owned by this ADR, so this is a continuation of the existing divergence rather than a new one — no separate ADR was created. Rationale and the conditional design are captured in `.specs/002-http-transport-and-oauth/infra/design.md`. Redis encryption-at-rest for the stored token remains a documented follow-up.
