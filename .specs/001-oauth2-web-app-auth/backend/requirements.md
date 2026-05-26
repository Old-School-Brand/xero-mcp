# Requirements: OAuth2 Web App Auth Flow
**Layer:** backend
**Status:** Confirmed
**Last updated:** 2026-05-24

## Problem Statement

The current `xero-client.ts` authenticates using the **Custom Connection** grant type (`client_credentials`), which Xero only supports for organisations registered in the UK, US, or New Zealand. Users outside those regions cannot obtain a Custom Connection app — they must use a **Web Application** in the Xero Developer Portal, which uses the OAuth2 `authorization_code` flow.

The current auth code is entirely unusable for the maintainer of this fork. This feature replaces the existing authentication implementation with a single, clean **Refresh Token** mode that works with any Xero Web Application.

## Goals

- Replace the existing multi-mode auth system with a single Refresh Token mode.
- On startup: exchange a stored refresh token for a live access token and persist the rotated refresh token.
- In-process: schedule proactive token renewal so sessions longer than 30 minutes never hit expired-token errors.
- Fail loudly and clearly at startup if credentials are missing or the refresh token is invalid.
- Crash loudly mid-session if a scheduled refresh fails.
- Remove all dead code: `XERO_CLIENT_BEARER_TOKEN`, `XERO_SCOPES`, scope V1/V2 constants, `BearerTokenXeroClient`, `CustomConnectionsXeroClient`.

## Non-Goals

- In-band OAuth2 browser redirect flow (no localhost HTTP listener — the user obtains the initial refresh token externally via the Xero API Explorer).
- Multi-tenant support (this server targets a single Xero organisation, same as the current implementation).
- Access token caching to disk (access tokens are obtained fresh on every server start).
- Any change to Tool definitions, Handler logic, or the public MCP tool contract.

## Functional Requirements

1. **FR-1 — Env var startup validation.** When the server starts, it MUST read `XERO_CLIENT_ID` and `XERO_CLIENT_SECRET` from the environment. If either is absent, the server MUST throw immediately with a message identifying which variable is missing.

2. **FR-2 — Refresh token source resolution.** When the server starts, it MUST resolve the refresh token using the following **priority order** (first match wins):
   1. **Token file** — read `XERO_TOKEN_FILE` (default: `~/.xero-mcp/refresh_token`). If the file exists and is non-empty, use its contents. The file always contains the *latest rotated* token and takes priority because it is more current than the env var.
   2. **Env var** — if `XERO_REFRESH_TOKEN` is set, use that value. This is the *initial seed* — used only on first run before any file exists.
   3. **Fail** — if neither source is available, throw with a message directing the user to obtain a token via the Xero API Explorer and set `XERO_REFRESH_TOKEN`.

3. **FR-3 — Token exchange on startup.** Using the resolved refresh token, `XERO_CLIENT_ID`, and `XERO_CLIENT_SECRET`, the server MUST POST to `https://identity.xero.com/connect/token` with `grant_type=refresh_token`. If Xero returns an error, the server MUST throw with a message indicating the token is invalid/expired and directing the user to obtain a new one at `https://api-explorer.xero.com`.

4. **FR-4 — Rotated refresh token persistence.** After a successful token exchange, the server MUST write the new refresh token returned by Xero to the token file path (resolved as per FR-2). The file MUST be written with `0600` permissions. If the parent directory of the token file path does not exist, the server MUST throw with a message naming the missing directory and instructing the user to create it.

5. **FR-5 — Token set applied to xero-node client.** After a successful exchange, the server MUST call `this.setTokenSet()` with the access token and expiry, then call `this.updateTenants()` to resolve the tenant ID.

6. **FR-6 — Proactive scheduled refresh (in-process).** After startup authentication, the server MUST schedule an in-process background timer (`setTimeout`) to fire at `expires_in - 300` seconds (i.e. 5 minutes before the access token expires). This runs in the same Node.js process — no sidecar or external process is needed. When the timer fires:
   - Exchange the current in-memory refresh token via the same endpoint (FR-3).
   - Write the new rotated refresh token to the token file (FR-4).
   - Update the in-memory token set (FR-5, minus `updateTenants` — tenant ID is stable).
   - Schedule the next timer.

7. **FR-7 — Crash on scheduled refresh failure.** If the scheduled token refresh fails for any reason (network error, Xero error, file write error), the server MUST log the error to stderr and call `process.exit(1)` with a clear message.

8. **FR-8 — Removal of previous auth code.** The following MUST be removed from `src/clients/xero-client.ts` and any file that references them:
   - `CustomConnectionsXeroClient` class
   - `BearerTokenXeroClient` class
   - `XERO_DEFAULT_AUTH_SCOPES_V1` and `XERO_DEFAULT_AUTH_SCOPES_V2` constants
   - `grant_type` constant and any `client_credentials` logic
   - All references to `XERO_CLIENT_BEARER_TOKEN` env var
   - All references to `XERO_SCOPES` env var

9. **FR-9 — Updated env var documentation.** `.env.example` and `README.md` MUST be updated to reflect the new required and optional env vars, and MUST include step-by-step instructions for obtaining an initial refresh token via the Xero API Explorer.

## Acceptance Criteria

- **AC-1 — Startup with token file (happy path)**
  - Given: `XERO_TOKEN_FILE=~/.xero-mcp/refresh_token` contains a valid refresh token, and `XERO_CLIENT_ID` + `XERO_CLIENT_SECRET` are set
  - When: MCP server starts
  - Then: server reads token from file, exchanges it, writes rotated refresh token to file, and is ready to serve tool calls

- **AC-2 — Startup falls back to env var**
  - Given: token file does not exist, `XERO_REFRESH_TOKEN=<valid-token>`, and `XERO_CLIENT_ID` + `XERO_CLIENT_SECRET` are set
  - When: MCP server starts
  - Then: server uses env var value, exchanges it, and writes the rotated token to the default file path

- **AC-3 — Token file takes priority over env var**
  - Given: token file exists AND `XERO_REFRESH_TOKEN` is also set
  - When: MCP server starts
  - Then: token from file is used; env var is ignored

- **AC-4 — Fail fast: no token source**
  - Given: token file absent and `XERO_REFRESH_TOKEN` not set
  - When: MCP server starts
  - Then: server throws with a message directing the user to set `XERO_REFRESH_TOKEN` and points to the Xero API Explorer URL

- **AC-5 — Fail fast: missing client credentials**
  - Given: `XERO_CLIENT_ID` is not set
  - When: MCP server starts
  - Then: server throws with "XERO_CLIENT_ID is required"
  - (Same for `XERO_CLIENT_SECRET`)

- **AC-6 — Fail fast: invalid/expired refresh token**
  - Given: `XERO_REFRESH_TOKEN` is set but the token is expired or invalid
  - When: server exchanges token at startup
  - Then: server throws with a message stating the token is invalid and directing to `https://api-explorer.xero.com`

- **AC-7 — Fail fast: token file directory missing**
  - Given: `XERO_TOKEN_FILE=/nonexistent/dir/refresh_token`
  - When: server attempts to write the rotated token after a successful exchange
  - Then: server throws naming the missing directory and instructing the user to create it

- **AC-8 — Proactive refresh keeps session alive**
  - Given: server is running with valid tokens whose `expires_in` is 1800 seconds
  - When: 1500 seconds (25 minutes) have elapsed
  - Then: server has exchanged the refresh token, written the new refresh token to file, and updated its in-memory token set without any tool call failing

- **AC-9 — Crash on mid-session refresh failure**
  - Given: server is running and the scheduled refresh timer fires
  - When: Xero returns a 400 error on the refresh request
  - Then: server logs the error to stderr and exits with a non-zero code

- **AC-10 — Old auth code is gone**
  - Given: the implementation is complete
  - Then: `grep -r "client_credentials\|XERO_SCOPES\|XERO_CLIENT_BEARER_TOKEN\|BearerTokenXeroClient\|CustomConnectionsXeroClient\|XERO_DEFAULT_AUTH_SCOPES" src/` returns no results

- [x] `.env.example` updated to show `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`, `XERO_REFRESH_TOKEN`, `XERO_TOKEN_FILE`
- [x] `README.md` updated with step-by-step instructions to obtain a refresh token via the Xero API Explorer

## Dependencies

- `xero-node` ^13.3.0 — `XeroClient.setTokenSet()` and `updateTenants()` already used by the existing client
- `axios` — already used for token exchange HTTP calls; used for the refresh token endpoint call
- `XERO_CLIENT_ID` and `XERO_CLIENT_SECRET` env vars — unchanged, already required
- Node.js `fs` (built-in) — for token file read/write
- Node.js `path` (built-in) — for token file path resolution and directory existence check

## Open Questions

None — all decisions resolved during requirements interview.

## Glossary additions

- **Web Application** — A Xero OAuth 2.0 app type (available to all regions) that uses the `authorization_code` grant. Produces a `refresh_token` that can be exchanged for access tokens. The only app type available to operators outside UK/US/NZ. Aliases to avoid: "web app" (acceptable in prose, but use full term in code and spec).
- **Refresh Token mode** — The new single auth mode in `xero-client.ts`. Authenticates by exchanging a stored `refresh_token` for an access token via `POST /connect/token` with `grant_type=refresh_token`. Replaces Custom Connection mode and Bearer Token mode. Aliases to avoid: "OAuth2 mode" (too vague).
- **Token file** — The local file storing the current (most-recently-rotated) refresh token. Defaults to `~/.xero-mcp/refresh_token`; overridable via `XERO_TOKEN_FILE`. Written with `0600` permissions. Aliases to avoid: "token cache" (implies access token caching, which is out of scope).
- **Token rotation** — Xero's behaviour of issuing a new `refresh_token` and immediately invalidating the old one on every token exchange. The server must persist the new token after every exchange to avoid startup failures on subsequent restarts. Aliases to avoid: "token refresh" (too generic; use "token exchange" for the HTTP call and "token rotation" for Xero's invalidate-and-reissue behaviour).
