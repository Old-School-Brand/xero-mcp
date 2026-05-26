# Requirements: HTTP Transport and Entra OAuth
**Layer:** backend
**Status:** Confirmed
**Last updated:** 2026-05-26

## Problem Statement

xero-mcp currently speaks MCP only over stdio. That model works for a developer running the binary under Claude Desktop, but the fork charter (PRD §4.2) calls for a deployable image and a multi-user-friendly runtime. A stdio binary cannot be operated as a long-running pod, and it has no authentication story — anyone who can pipe to its stdin can invoke every tool.

Cin7-MCP (the org's sibling MCP server) solved both problems together: an HTTP-mode Streamable transport with Entra ID OAuth implemented inside the MCP server itself. We want the same posture on xero-mcp: a deployable HTTP entry point that authenticates every inbound request against Entra ID, sharing one Xero org across all authenticated users.

Critically, this must be additive. The upstream `XeroAPI/xero-mcp-server` repository is tracked and merged regularly. Everything new lives in `src/http/` (and its subdirectories); no existing upstream file in `src/` is modified.

## Goals

- Add a second entry point at `dist/http/server.js` that serves MCP over **Streamable HTTP** (RFC-compliant, per-session transports). The existing stdio entry at `dist/index.js` continues to work unchanged.
- Authenticate every inbound `/mcp` request via the MCP TS SDK's `requireBearerAuth` middleware.
- In `ENVIRONMENT=local`, accept a static bearer matching `DEV_BEARER_TOKEN` (parity with cin7-mcp's local-dev mode).
- In any other environment, validate inbound tokens as **Entra ID**-issued JWTs (correct issuer, audience, expiry, and required scope `mcp`).
- Expose the SDK's `mcpAuthRouter` (DCR registration, authorize, token, RFC 8414/9728 metadata) backed by `ProxyOAuthServerProvider` aimed at the configured Entra tenant, with a **Redis-backed `OAuthRegisteredClientsStore`** so registrations survive pod restarts (cin7-mcp ADR-0002 pattern).
- Expose anonymous `/livez` and `/readyz` endpoints for K8s probes; `/readyz` reports unhealthy when Redis is unreachable OR `xeroClient` has not yet initialised.
- Fail loudly at startup in non-local environments if any external dependency (Entra JWKS, Redis) is unreachable.
- Emit structured JSON logs via `pino` with configurable level.
- All new code lives under `src/http/` and `src/http/auth/`. No existing upstream file in `src/` is modified.

## Non-Goals

- **Audit logging** of tool invocations (PRD §4.1, deferred to its own feature).
- **Rate limiting** inbound or outbound (deferred to its own feature; cin7-mcp's pattern available as reference).
- **Tool-surface restriction** (PRD §4.1, deferred to its own feature).
- **Encryption at rest** of the OAuth state in Redis (cin7-mcp wraps storage with a Fernet layer; explicit follow-up here).
- **Per-user Xero OAuth** / multi-tenant. One Xero org per deployment, same as today's stdio mode.
- **Removing or modifying the existing stdio entry point** (`src/index.ts`) or any other upstream file in `src/`.
- **CORS support.** No `Access-Control-Allow-*` headers issued. A future feature can add a `MCP_CORS_ALLOWED_ORIGINS` allowlist when a browser-based MCP client appears.
- **Container, compose, and Helm artefacts.** Owned by the `infra` layer (`.specs/002-http-transport-and-oauth/infra/`).

## Functional Requirements

### Entry point and lifecycle

1. **FR-1 — New HTTP entry point.** A new entry file MUST exist at `src/http/server.ts`. When compiled to `dist/http/server.js`, executing it starts an Express server bound to `MCP_BIND_HOST:MCP_BIND_PORT` (defaults `0.0.0.0:8000`). The existing upstream entry at `src/index.ts` MUST NOT be modified.

2. **FR-2 — Eager Xero authentication.** Before `app.listen` is called, the entry MUST `await xeroClient.authenticate()`. If startup auth fails, the process MUST exit non-zero with the existing upstream error surfaced (preserving the fail-loud pattern from `src/clients/xero-client.ts`).

3. **FR-3 — Settings validation at boot.** Env vars MUST be validated via a `zod` schema in `src/http/settings.ts`. Any missing or invalid value MUST throw at startup with a clear message naming the offending variable. Required fields by environment:
   - Always: `MCP_BIND_HOST` (default `0.0.0.0`), `MCP_BIND_PORT` (default `8000`), `LOG_LEVEL` (default `info`), `ENVIRONMENT` (one of `local`, `development`, `production`).
   - When `ENVIRONMENT=local`: `DEV_BEARER_TOKEN` (any non-empty string).
   - When `ENVIRONMENT!=local`: `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `MCP_SERVER_URL`, `ENTRA_REQUIRED_SCOPES`, `REDIS_URL`. (`ENTRA_CLIENT_SECRET` removed in iteration 3 — token verification uses Entra's JWKS public keys; DCR-issued client secrets are managed by `ProxyOAuthServerProvider` and persisted in Redis.)
   - Optional: `MCP_SESSION_IDLE_TIMEOUT_SECONDS` (default `1800`), `MCP_MAX_SESSIONS` (default `100`).

4. **FR-4 — Eager external-dependency probes in non-local environments.** When `ENVIRONMENT!=local`, before `app.listen`, the entry MUST:
   - Connect to Redis (`REDIS_URL`) and run `PING`. On failure, throw with `"Redis unreachable: {REDIS_URL}"`.
   - Fetch the Entra JWKS at `https://login.microsoftonline.com/{ENTRA_TENANT_ID}/discovery/v2.0/keys` once. On failure, throw with `"Entra JWKS unreachable: {url}"`.

### Authentication and authorisation

5. **FR-5 — Local-dev static bearer.** When `ENVIRONMENT=local`, a `LocalBearerVerifier` MUST implement the SDK's `OAuthTokenVerifier`. It returns an `AuthInfo` when the inbound `Authorization: Bearer {token}` matches `DEV_BEARER_TOKEN` exactly; otherwise throws `InvalidTokenError`. The `mcpAuthRouter` and all DCR/Entra wiring MUST NOT be mounted in local-dev mode.

6. **FR-6 — Entra JWT verification (non-local).** A `EntraVerifier` MUST implement `OAuthTokenVerifier` and validate inbound tokens using `jose`:
   - Signature against Entra's JWKS (via `jose.createRemoteJWKSet`, stored as a private instance field on `EntraVerifier`).
   - `issuer` MUST equal `https://login.microsoftonline.com/{ENTRA_TENANT_ID}/v2.0`.
   - `audience` MUST equal `api://{ENTRA_CLIENT_ID}` (Entra's default identifier URI).
   - Token MUST NOT be expired.
   - The token's `scp` claim (space-delimited) MUST contain every scope in `ENTRA_REQUIRED_SCOPES.split(",")`.

7. **FR-7 — OAuth provider wiring (non-local).** A `ProxyOAuthServerProvider` from `@modelcontextprotocol/sdk/server/auth/providers/proxyProvider.js` MUST be instantiated with:
   - Authorize URL: `https://login.microsoftonline.com/{ENTRA_TENANT_ID}/oauth2/v2.0/authorize`.
   - Token URL: `https://login.microsoftonline.com/{ENTRA_TENANT_ID}/oauth2/v2.0/token`.
   - `verifyAccessToken`: delegate to `EntraVerifier`.
   - `clientsStore`: the Redis-backed implementation (FR-8).

8. **FR-8 — Redis-backed DCR storage.** A `RedisOAuthClientsStore` MUST implement `OAuthRegisteredClientsStore`. Keys: `oauth:clients:{client_id}`. Values: JSON-serialised `OAuthClientInformationFull`. Reads via `GET`; writes via `SET` with no TTL (registrations persist until manually evicted). No client-side encryption — explicit follow-up.

9. **FR-9 — mcpAuthRouter mounting.** When `ENVIRONMENT!=local`, the Express app MUST mount `mcpAuthRouter({ provider, issuerUrl: MCP_SERVER_URL, baseUrl: MCP_SERVER_URL, resourceServerUrl: MCP_SERVER_URL, scopesSupported: ENTRA_REQUIRED_SCOPES.split(",") })`. This exposes `/register`, `/authorize`, `/token`, `/.well-known/oauth-authorization-server`, and `/.well-known/oauth-protected-resource`.

10. **FR-10 — Bearer enforcement on `/mcp`.** Every request to `/mcp` (POST, GET, DELETE) MUST be gated by `requireBearerAuth({ verifier, requiredScopes: ENTRA_REQUIRED_SCOPES.split(","), resourceMetadataUrl: ... })`. Missing/invalid tokens MUST return 401 with `WWW-Authenticate: Bearer ...`. Valid token but insufficient scope MUST return 403 with `error="insufficient_scope"`. (Both are the SDK's built-in responses.)

### Streamable HTTP transport and sessions

11. **FR-11 — Per-session transport.** A `Map<string, StreamableHTTPServerTransport>` MUST hold one transport per active `Mcp-Session-Id`. On `POST /mcp` with an `initialize` payload and no `Mcp-Session-Id`:
    - Generate a UUID with `randomUUID()`.
    - Construct a `StreamableHTTPServerTransport({ sessionIdGenerator: () => <uuid>, onsessionclosed })`.
    - Construct a fresh `McpServer({ name, version })` using the upstream package's name and version (read from `package.json` at process boot, once).
    - Call `ToolFactory(server)` (imported from upstream `src/tools/tool-factory.ts`).
    - `await server.connect(transport)`.
    - Insert into the map keyed by the UUID.
    - Forward to `transport.handleRequest(req, res, req.body)`, which stamps the `Mcp-Session-Id` response header.

12. **FR-12 — Session lookup.** On `POST /mcp` or `GET /mcp` or `DELETE /mcp` with an `Mcp-Session-Id` header: look up the matching transport and forward to its `handleRequest`. If no transport exists for that ID, return 404 with a JSON error body. (`GET /mcp` is the SDK's server-to-client SSE channel for notifications; `DELETE /mcp` ends the session.)

13. **FR-13 — Explicit session deletion.** When `transport` receives a `DELETE` it triggers its `onsessionclosed` callback. The callback MUST remove the entry from the session map and release the McpServer.

14. **FR-14 — Idle session eviction.** A background timer (one `setInterval` for the process) MUST scan the session map every 60 s. Any session whose last-activity timestamp is older than `MCP_SESSION_IDLE_TIMEOUT_SECONDS` MUST be closed (calling the transport's close method) and removed. "Activity" = most recent successful `handleRequest`.

15. **FR-15 — Session cap.** When the size of the session map equals `MCP_MAX_SESSIONS` and a request arrives that would create a new session (i.e. `initialize` without `Mcp-Session-Id`), the server MUST respond 503 with `{"error":"session_cap_reached"}`. Existing sessions continue to operate.

### Health endpoints

16. **FR-16 — `/livez`.** A GET endpoint at `/livez` MUST always return 200 with body `{"status":"ok"}` while the process is running. It MUST be mounted before any auth middleware.

17. **FR-17 — `/readyz`.** A GET endpoint at `/readyz` MUST:
    - Return 200 `{"status":"ok"}` when Redis is reachable (PING succeeds within 1 s) AND the HTTP server's internal `xeroReady` flag is `true`. (The flag is set to true after the eager `xeroClient.authenticate()` call resolves at startup.)
    - Return 503 `{"status":"unavailable","reason":"redis"}` if Redis ping fails or times out.
    - Return 503 `{"status":"unavailable","reason":"xero"}` if the `xeroReady` flag is `false`.
    - In `ENVIRONMENT=local`, skip the Redis check (Redis is not required); the `xeroReady` check still applies.
    - MUST be mounted before any auth middleware.

### Operational behaviour

18. **FR-18 — Structured logging.** A `pino` logger (level from `LOG_LEVEL`, default `info`) MUST be the single logger used by all new code in `src/http/**`. Each HTTP request MUST emit a single log line with: method, path, status, duration ms, session ID (if any). Auth failures and session lifecycle events (created, evicted, closed) MUST each emit a single info-level log.

19. **FR-19 — No CORS.** The server MUST NOT emit any `Access-Control-Allow-*` headers. Preflight `OPTIONS` requests against `/mcp` return 404. This is documented as a deliberate choice; future env-driven allowlist is out of scope.

20. **FR-20 — Stdio entry untouched.** `src/index.ts` and every existing file under `src/` MUST remain byte-for-byte identical to upstream after this feature lands. Verifiable via `git diff origin/upstream-main -- src/ ':!src/http'` showing zero changes.

21. **FR-21 — Server identity from package.json.** At process boot, `src/http/server.ts` MUST read `package.json` once and freeze a constant `{ name: pkg.name, version: pkg.version }`. Each per-session `McpServer` constructor MUST receive this constant. (cin7-mcp parity: avoid hardcoded version strings that drift.)

### Documentation

22. **FR-22 — `.env.example` updated additively.** The existing three Xero entries at the top of `.env.example` MUST remain byte-for-byte identical. A new clearly-marked section MUST be appended with the OSB env vars (`ENVIRONMENT`, `MCP_BIND_HOST`, `MCP_BIND_PORT`, `LOG_LEVEL`, `DEV_BEARER_TOKEN`, `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `MCP_SERVER_URL`, `ENTRA_REQUIRED_SCOPES`, `REDIS_URL`, `MCP_SESSION_IDLE_TIMEOUT_SECONDS`, `MCP_MAX_SESSIONS`), with comments in the cin7-mcp `.env.example` style. (`ENTRA_CLIENT_SECRET` was removed in build iteration 3 — see ADR-0002.)

23. **FR-23 — `package.json` additive edits only.** New dependencies (`express`, `jose`, `redis`, `pino`, `pino-http`) and dev dependencies (`@types/express`, `supertest`, `@types/supertest`) MUST be appended alphabetically. A new script `"start:http": "node dist/http/server.js"` MUST be added. A new bin entry `"xero-mcp-http": "./dist/http/server.js"` MUST be added beside the existing default bin. No existing entries removed or reordered.

24. **FR-24 — ADRs drafted.** Two ADRs MUST be drafted as part of this feature (foundry/build phase):
    - `.specs/adr/0002-mcp-http-transport-and-oauth.md` — why MCP-spec OAuth inside the server (vs. an external proxy) and why Streamable HTTP (vs. SSE). Mirrors cin7-mcp ADR-0001.
    - `.specs/adr/0003-oauth-state-in-redis.md` — why DCR state is Redis-backed (vs. in-memory, vs. filesystem). Mirrors cin7-mcp ADR-0002.

## Acceptance Criteria

- **AC-1 — Stdio entry is unaffected**
  - Given: feature is implemented
  - When: `git diff main -- src/ ':!src/http'` is run after rebase onto upstream
  - Then: zero changes are reported under any pre-existing path in `src/`

- **AC-2 — Build produces both entry points**
  - Given: `npm install && npm run build`
  - When: build completes
  - Then: both `dist/index.js` (stdio, executable) and `dist/http/server.js` (HTTP, executable) exist

- **AC-3 — Local-dev: HTTP server boots and `/livez` answers**
  - Given: `ENVIRONMENT=local`, `DEV_BEARER_TOKEN=test`, `XERO_*` set, `node dist/http/server.js`
  - When: `curl -fsS http://localhost:8000/livez`
  - Then: 200 with `{"status":"ok"}`

- **AC-4 — Local-dev: `/mcp` without bearer is 401**
  - Given: server running in local-dev mode
  - When: `curl -i http://localhost:8000/mcp -X POST -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'`
  - Then: response is 401 and contains a `WWW-Authenticate: Bearer ...` header

- **AC-5 — Local-dev: `/mcp` with correct bearer initialises a session**
  - Given: server running in local-dev mode with `DEV_BEARER_TOKEN=test`
  - When: POST `/mcp` `initialize` with `Authorization: Bearer test`
  - Then: response is 200, body is a valid JSON-RPC `initialize` result, and an `Mcp-Session-Id` header is present in the response

- **AC-6 — Non-local: Redis unreachable at startup crashes the process**
  - Given: `ENVIRONMENT=development`, valid Entra config, `REDIS_URL=redis://does-not-resolve:6379`
  - When: `node dist/http/server.js`
  - Then: process exits non-zero within 5 s with stderr containing `Redis unreachable`

- **AC-7 — Non-local: Entra JWKS unreachable at startup crashes the process**
  - Given: `ENVIRONMENT=development`, valid Redis, `ENTRA_TENANT_ID` pointing at a tenant whose JWKS endpoint returns 404
  - When: `node dist/http/server.js`
  - Then: process exits non-zero within 5 s with stderr containing `Entra JWKS unreachable`

- **AC-8 — Non-local: missing env throws with clear message**
  - Given: `ENVIRONMENT=development` and `ENTRA_TENANT_ID` unset
  - When: `node dist/http/server.js`
  - Then: process exits non-zero immediately with stderr naming `ENTRA_TENANT_ID`

- **AC-9 — Non-local: token without `mcp` scope returns 403**
  - Given: server running in non-local mode against a test Entra tenant; a valid token issued without the `mcp` scope
  - When: POST `/mcp` with that token
  - Then: response is 403 with body indicating `insufficient_scope`

- **AC-10 — Non-local: expired token returns 401**
  - Given: server running; an Entra-issued token whose `exp` claim is in the past
  - When: POST `/mcp` with that token
  - Then: response is 401 with `WWW-Authenticate: Bearer ...` containing `error="invalid_token"`

- **AC-11 — DCR client survives Redis restart**
  - Given: server running; a DCR registration completed (POST `/register` returned a `client_id`)
  - When: Redis is restarted with its data volume intact, then a subsequent token exchange uses the same `client_id`
  - Then: the exchange succeeds (the registration is loaded from Redis)

- **AC-12 — Sessions are isolated across concurrent clients**
  - Given: server running; two MCP Inspector instances initialise concurrently
  - When: each issues a `tools/call` for `list-organisation-details` in alternation
  - Then: both receive their own correct responses with no cross-talk; their `Mcp-Session-Id` headers are distinct

- **AC-13 — Idle session is evicted**
  - Given: server running with `MCP_SESSION_IDLE_TIMEOUT_SECONDS=120`; a session has been idle 121 s
  - When: the eviction sweep next runs (within 60 s after the threshold)
  - Then: the session map no longer contains that ID; a subsequent request with that ID returns 404

- **AC-14 — Session cap returns 503**
  - Given: server running with `MCP_MAX_SESSIONS=2`; two sessions already active
  - When: a third `initialize` arrives
  - Then: response is 503 with body containing `session_cap_reached`; the two existing sessions continue to function

- **AC-15 — Explicit DELETE closes a session**
  - Given: server running; one active session with ID `S`
  - When: `DELETE /mcp` with `Mcp-Session-Id: S` (and valid auth)
  - Then: 200; subsequent requests with `Mcp-Session-Id: S` return 404; session map size decreases by 1

- **AC-16 — `/readyz` returns 503 when xero is not initialised**
  - Given: server boot in progress; Express is listening but `xeroClient.authenticate()` has not yet resolved
  - When: GET `/readyz`
  - Then: 503 with `{"status":"unavailable","reason":"xero"}`

- **AC-17 — `/readyz` returns 503 when redis ping fails (non-local)**
  - Given: server running in non-local mode; Redis becomes unreachable mid-life
  - When: GET `/readyz`
  - Then: 503 with `{"status":"unavailable","reason":"redis"}`

- **AC-18 — Pino logs are valid JSON**
  - Given: server running, `LOG_LEVEL=info`
  - When: any HTTP request completes
  - Then: stdout contains a single-line JSON object including `level`, `time`, `msg`, `method`, `path`, `status`, `durationMs`

- **AC-19 — Server name and version come from package.json**
  - Given: server running; an active session
  - When: the SDK's `initialize` result is inspected
  - Then: `serverInfo.name` equals the upstream `package.json` `name` and `serverInfo.version` equals the upstream `version`

- [x] Two ADRs (`0002-mcp-http-transport-and-oauth.md`, `0003-oauth-state-in-redis.md`) drafted in `.specs/adr/` using the existing template, signed off as `Accepted`.
- [x] `.env.example` updated additively with the new OSB section; the three upstream entries remain byte-for-byte identical above it.
- [x] `.specs/REPO.md` § Upstream Sync updated with a note that "OSB-specific additions live under `src/http/`; never modify upstream-owned files in `src/`."
- [x] `.specs/PRD.md` § 7 Features updated to list this feature.

## Dependencies

- `@modelcontextprotocol/sdk` ^1.23.4 — already declared. Uses `StreamableHTTPServerTransport`, `ProxyOAuthServerProvider`, `mcpAuthRouter`, `requireBearerAuth`, `OAuthRegisteredClientsStore`, `OAuthTokenVerifier`.
- `express` — new dependency. The Express middleware shape is required by the SDK's `mcpAuthRouter` and `requireBearerAuth`.
- `jose` — new dependency. Used by `EntraVerifier` for `createRemoteJWKSet` + `jwtVerify`.
- `redis` — new dependency. node-redis v4 client for the DCR clients store.
- `pino`, `pino-http` — new dependencies. Structured logging.
- `@types/express`, `supertest`, `@types/supertest` — new dev dependencies.
- Upstream modules imported as-is, never modified: `src/clients/xero-client.ts` (the `xeroClient` singleton and its `authenticate` surface), `src/tools/tool-factory.ts` (`ToolFactory`).

## Open Questions

None — all decisions resolved during requirements interview.

## Glossary additions

- **Streamable HTTP transport** — The MCP-spec HTTP transport (`@modelcontextprotocol/sdk` v1.x `StreamableHTTPServerTransport`) providing JSON-RPC over `POST /mcp` plus a server-to-client SSE channel on `GET /mcp`. Replaces stdio when running deployed. Aliases to avoid: "MCP over HTTP" (ambiguous with the legacy SSE-only transport).
- **Mcp-Session-Id** — The HTTP header carrying the logical MCP session identifier across requests in Streamable HTTP. Generated by the server on first `initialize` and required on subsequent requests for that session. Aliases to avoid: "session header" alone.
- **DCR** — Dynamic Client Registration (RFC 7591), the OAuth flow by which an MCP client registers itself with our server at runtime to obtain its `client_id`. Aliases to avoid: "dynamic registration" (acceptable in prose; use DCR in code/specs).
- **ProxyOAuthServerProvider** — The MCP TS SDK's `OAuthServerProvider` implementation that forwards `/authorize` and `/token` to an upstream provider (here: Entra) while owning DCR and metadata endpoints locally. Aliases to avoid: none.
- **OAuthRegisteredClientsStore** — The SDK's storage interface for DCR client records. Implementations include in-memory (SDK example) and (in this fork) Redis-backed. Aliases to avoid: "DCR store" is fine in conversational prose but use the full name in specs.
- **Entra ID** — Microsoft's identity platform (formerly Azure AD), the OAuth provider used by this fork in non-local environments. Aliases to avoid: AAD, Azure AD (legacy names).
- **JWKS** — JSON Web Key Set. Entra publishes the public keys that signed its issued tokens at `https://login.microsoftonline.com/{tenant}/discovery/v2.0/keys`. Aliases to avoid: "key set" alone.
- **`mcp` scope** — The required scope on inbound Entra tokens. Defined under "Expose an API → Scopes" in the Entra app registration; appears in tokens' `scp` claim. Convention shared with cin7-mcp so a single client app can authorise against both servers. Aliases to avoid: "MCP permission".
- **DEV_BEARER_TOKEN** — The static bearer accepted in `ENVIRONMENT=local` mode. A non-secret random string set by the operator in `.env`; not a real OAuth token. Aliases to avoid: "dev token" (too vague).
