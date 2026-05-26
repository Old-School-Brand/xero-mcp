# Todo: HTTP Transport and Entra OAuth
**Layer:** backend
**Status:** Complete
**Last updated:** 2026-05-26

## Implementation Tasks

Tasks are ordered. Do not start a task until its dependencies are complete.

Each phase ends in an independently-green state: all phase tasks done → all
tests pass, `npm run build` succeeds, type-check clean, and the server can
be exercised at that phase's capability level.

---

### Phase 1: Foundation — HTTP transport, no auth

Goal: `npm install` adds new deps; `npm run build` produces `dist/http/server.js`;
`GET /livez` returns 200; `POST /mcp initialize` initialises a session and returns
`serverInfo` from `package.json`. No bearer required yet.

---

- [x] **Task 1.1** — Install new runtime and dev dependencies
  - File(s): `package.json`, `package-lock.json`
  - What to do: Run `npm install express@^5 jose@^6 pino@^9 pino-http@^10 redis@^4` and `npm install -D @types/express supertest @types/supertest`. Verify each package lands in alphabetical order in its section. Do not reorder or remove any existing entry.
  - Acceptance: `npm install` exits 0; `node_modules/express`, `node_modules/jose`, `node_modules/pino`, `node_modules/pino-http`, `node_modules/redis`, `node_modules/supertest` all exist; `npm run build` still exits 0.
  - Depends on: none
  - Examples: Example 19
  - Completed: 2026-05-26

- [x] **Task 1.2** — Add `start:http` script and `xero-mcp-http` bin; update `build` script for `dist/http/*.js`
  - File(s): `package.json`
  - What to do: In `scripts`, add `"start:http": "node dist/http/server.js"`. Change `"build"` from `"tsc && shx chmod +x dist/*.js"` to `"tsc && shx chmod +x dist/*.js dist/http/*.js"`. In `bin`, change from the string shorthand `"./dist/index.js"` to an object `{ "xero-mcp-server": "./dist/index.js", "xero-mcp-http": "./dist/http/server.js" }`. No other `package.json` changes.
  - Acceptance: `npm run build` exits 0; `dist/http/server.js` (once created in Task 1.6) is executable; the `bin` object has both keys.
  - Depends on: Task 1.1
  - Examples: Example 19
  - Completed: 2026-05-26

- [x] **Task 1.3** — `src/http/settings.ts` — Zod env schema with discriminated union
  - File(s): `src/http/settings.ts`, `src/__tests__/http/settings.test.ts`
  - What to do: Export `loadSettings()` that first calls `dotenv.config()` (idempotent — calling it after upstream's `xero-client.ts` already loaded `.env` is a no-op, and calling it from standalone tests of `settings.ts` works without depending on import order), then calls `z.object({ ENVIRONMENT: z.enum(["local", "development", "production"]), MCP_BIND_HOST: z.string().default("0.0.0.0"), MCP_BIND_PORT: z.coerce.number().default(8000), LOG_LEVEL: z.string().default("info"), MCP_SESSION_IDLE_TIMEOUT_SECONDS: z.coerce.number().default(1800), MCP_MAX_SESSIONS: z.coerce.number().default(100), DEV_BEARER_TOKEN: z.string().optional(), ENTRA_TENANT_ID: z.string().optional(), ENTRA_CLIENT_ID: z.string().optional(), ENTRA_CLIENT_SECRET: z.string().optional(), MCP_SERVER_URL: z.string().optional(), ENTRA_REQUIRED_SCOPES: z.string().optional(), REDIS_URL: z.string().optional() }).superRefine(...)` where the `superRefine` adds an issue for each missing field: `DEV_BEARER_TOKEN` when `ENVIRONMENT=local`; the six Entra/Redis fields when `ENVIRONMENT!="local"`. Export discriminated types `LocalSettings` (guarantees `DEV_BEARER_TOKEN: string`) and `NonLocalSettings` (guarantees all six Entra/Redis fields as `string`), and `Settings = LocalSettings | NonLocalSettings`. `loadSettings()` reads from `process.env` and parses. On parse failure, throw the `ZodError` directly.
  - Acceptance: Test `loadSettings()` with `vi.stubEnv`. Given `ENVIRONMENT=local` and no `DEV_BEARER_TOKEN`, `loadSettings()` throws a `ZodError` whose message contains `"DEV_BEARER_TOKEN"`. Given `ENVIRONMENT=development` and `ENTRA_TENANT_ID` absent, throws naming `"ENTRA_TENANT_ID"`. Given all valid local vars, returns a `LocalSettings` object with `ENVIRONMENT === "local"` narrowed. (Note: `ENTRA_CLIENT_SECRET` was removed from the schema in build iteration 3 — see ADR-0002.)
  - Depends on: Task 1.1
  - Examples: Example 17, Example 18
  - Completed: 2026-05-26
  - Tests: src/__tests__/http/settings.test.ts

- [x] **Task 1.4** — `src/http/logging.ts` — Pino logger and pino-http middleware factory
  - File(s): `src/http/logging.ts`, `src/__tests__/http/logging.test.ts`
  - What to do: Export `createLogger(level: string): pino.Logger` that returns `pino({ level, timestamp: pino.stdTimeFunctions.isoTime })`. Export `createHttpLogger(logger: pino.Logger)` that returns a `pino-http` middleware configured with: `logger`, a custom `serializers` object that maps `req` to `{ method: req.method, url: req.url }` and maps `res` to `{ statusCode: res.statusCode }`, a `customProps` function that appends `sessionId: req.headers["mcp-session-id"] ?? undefined`, and `autoLogging: { ignore: (req) => ["/livez", "/readyz"].includes(req.url ?? "") }` to silence probe-spam at info level.
  - Acceptance: `createLogger("debug")` returns an object with a `debug` method. `createHttpLogger(logger)` returns a function (Express middleware). `npm run build` type-checks clean.
  - Depends on: Task 1.1
  - Examples: Example 21
  - Completed: 2026-05-26
  - Tests: src/__tests__/http/logging.test.ts

- [x] **Task 1.5** — `src/http/sessions.ts` — SessionManager with create, lookup, delete, idle eviction, and cap
  - File(s): `src/http/sessions.ts`, `src/__tests__/http/sessions.test.ts`
  - Depends on: Task 1.3, Task 1.4
  - Examples: Example 9, Example 10, Example 11, Example 12
  - Completed: 2026-05-26
  - Tests: src/__tests__/http/sessions.test.ts

- [x] **Task 1.6** — `src/http/health.ts` — `/livez` and `/readyz` Express router
  - File(s): `src/http/health.ts`, `src/__tests__/http/health.test.ts`
  - Depends on: Task 1.4
  - Examples: Example 4, Example 5, Example 6, Example 7, Example 8
  - Completed: 2026-05-26
  - Tests: src/__tests__/http/health.test.ts

- [x] **Task 1.7** — `src/http/server.ts` — Phase 1 skeleton: no-auth HTTP entry with `/livez` and open `/mcp`
  - File(s): `src/http/server.ts`
  - Depends on: Task 1.2, Task 1.3, Task 1.4, Task 1.5, Task 1.6
  - Examples: Example 4, Example 19
  - Completed: 2026-05-26

---

### Phase 2: Local-dev static bearer auth

Goal: `POST /mcp` without bearer → 401 with `WWW-Authenticate: Bearer`; with correct
bearer → session initialised. All Phase 1 tests still green.

---

- [x] **Task 2.1** — `src/http/auth/local-verifier.ts` — Static bearer OAuthTokenVerifier
  - File(s): `src/http/auth/local-verifier.ts`, `src/__tests__/http/auth/local-verifier.test.ts`
  - What to do: Export `class LocalBearerVerifier implements OAuthTokenVerifier`. Constructor takes `devBearerToken: string`. `async verifyAccessToken(token: string): Promise<AuthInfo>`: if `token === this.devBearerToken` return `{ token, clientId: "dev-local", scopes: ["mcp"], expiresAt: undefined }`; otherwise `throw new InvalidTokenError("Invalid dev bearer token")`. Import `InvalidTokenError` from `@modelcontextprotocol/sdk/server/auth/errors.js`. Import `OAuthTokenVerifier` from `@modelcontextprotocol/sdk/server/auth/provider.js` and `AuthInfo` from `@modelcontextprotocol/sdk/server/auth/types.js`.
  - Acceptance: `verifyAccessToken("correct")` resolves to `AuthInfo` with `scopes: ["mcp"]`. `verifyAccessToken("wrong")` rejects with `InvalidTokenError`. Pure logic — no mocks needed.
  - Depends on: none (pure module, no upstream deps beyond the SDK)
  - Examples: Example 2, Example 3
  - Completed: 2026-05-26
  - Tests: src/__tests__/http/auth/local-verifier.test.ts

- [x] **Task 2.2** — `src/http/auth/build.ts` — Auth factory, local branch only
  - File(s): `src/http/auth/build.ts`, `src/__tests__/http/auth/build.test.ts`
  - What to do: Export `buildAuth` with TypeScript function overloads. Local-branch overload: `function buildAuth(settings: LocalSettings): { verifier: OAuthTokenVerifier, requiredScopes: string[] }`. When `settings.ENVIRONMENT === "local"`, return `{ verifier: new LocalBearerVerifier(settings.DEV_BEARER_TOKEN), requiredScopes: ["mcp"] }`. No `provider` property in the local return type. The non-local branch overload is added in Task 3.3. The implementation signature is `function buildAuth(settings: Settings, redisClient?: RedisClientType) { ... }`. Plan the types so that adding the non-local branch in Task 3.3 is an additive change.
  - Acceptance: `buildAuth({ ENVIRONMENT: "local", DEV_BEARER_TOKEN: "tok", ... } as LocalSettings)` returns `{ requiredScopes: ["mcp"] }` and `verifier` is a `LocalBearerVerifier` instance. Use `vi.mock` for `LocalBearerVerifier`.
  - Depends on: Task 1.3, Task 2.1
  - Examples: (local auth wiring, tested end-to-end in Task 2.3)
  - Completed: 2026-05-26
  - Tests: src/__tests__/http/auth/build.test.ts

- [x] **Task 2.3** — Wire `requireBearerAuth` onto `/mcp` in `src/http/server.ts`
  - File(s): `src/http/server.ts`
  - What to do: After building the auth config via `buildAuth(settings)`, insert `requireBearerAuth({ verifier, requiredScopes, resourceMetadataUrl: settings.ENVIRONMENT !== "local" ? getOAuthProtectedResourceMetadataUrl(new URL(settings.MCP_SERVER_URL!)) : undefined })` as middleware on the `/mcp` route, before the session handler. Import `requireBearerAuth` from `@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js` and `getOAuthProtectedResourceMetadataUrl` from `@modelcontextprotocol/sdk/server/auth/router.js`. No `mcpAuthRouter` yet — that is Task 3.4. No change to `/livez` or `/readyz` routes.
  - Acceptance: With server running in local mode, `POST /mcp` without `Authorization` header returns 401 with `WWW-Authenticate: Bearer` header. `POST /mcp` with `Authorization: Bearer <DEV_BEARER_TOKEN>` and `initialize` body returns 200 with `Mcp-Session-Id` response header.
  - Depends on: Task 1.7, Task 2.2
  - Examples: Example 1, Example 2, Example 3
  - Completed: 2026-05-26

---

### Phase 3: Entra auth, Redis DCR store, and `mcpAuthRouter`

Goal: Non-local mode boots cleanly; Entra JWTs verified; DCR registrations
persist in Redis; `mcpAuthRouter` mounted. All Phase 1 and Phase 2 tests still
green.

---

- [x] **Task 3.1** — `src/http/auth/redis-clients-store.ts` — Redis-backed OAuthRegisteredClientsStore
  - File(s): `src/http/auth/redis-clients-store.ts`, `src/__tests__/http/auth/redis-clients-store.test.ts`
  - What to do: Export `class RedisOAuthClientsStore implements OAuthRegisteredClientsStore`. Constructor takes `redis: { get: (key: string) => Promise<string | null>, set: (key: string, value: string) => Promise<unknown> }` (narrowed to the two operations actually used — avoids importing the full Redis type in the interface). Key pattern: `` `oauth:clients:${clientId}` ``. `async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined>`: `const raw = await this.redis.get(key)` — if `null` return `undefined`; else `return JSON.parse(raw) as OAuthClientInformationFull`. `async registerClient(client: Omit<OAuthClientInformationFull, "client_id" | "client_id_issued_at">): Promise<OAuthClientInformationFull>`: generate `client_id = randomUUID()`, set `client_id_issued_at = Math.floor(Date.now() / 1000)`, compose full object, `await this.redis.set(key, JSON.stringify(full))`, return `full`. No TTL. No encryption. The store is the single source of truth for `client_id` generation — the SDK's `clientRegistrationHandler` will be configured with `clientIdGeneration: false` so it does NOT generate a `client_id` before calling `registerClient`.
  - Acceptance: Use an in-memory fake `{ get: vi.fn(), set: vi.fn() }`. `getClient("nonexistent")` returns `undefined` when `get` returns `null`. `registerClient(...)` returns an object with a UUID `client_id` and calls `set` with the key `oauth:clients:<uuid>` and a JSON string. Subsequent `getClient(client_id)` (with `get` stubbed to return the JSON) returns the registered object.
  - Depends on: none (pure module)
  - Examples: Example 23, Example 24
  - Completed: 2026-05-26
  - Tests: src/__tests__/http/auth/redis-clients-store.test.ts

- [x] **Task 3.2** — `src/http/auth/entra-verifier.ts` — Entra JWT verifier via jose
  - File(s): `src/http/auth/entra-verifier.ts`, `src/__tests__/http/auth/entra-verifier.test.ts`
  - What to do: Export `class EntraVerifier implements OAuthTokenVerifier`. Constructor takes `{ tenantId: string, clientId: string, requiredScopes: string[] }`. Construct the `RemoteJWKSet` in the constructor as a private field via `createRemoteJWKSet(new URL(\`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys\`))`. This ensures the same JWKS fetch path is used at both startup (probe) and runtime (token verification) — no separate fetch URL constant, no duplicate cache. `async verifyAccessToken(token: string): Promise<AuthInfo>`: wrap the body in `try { ... } catch (err) { if (err instanceof jose.errors.JOSEError) throw new InvalidTokenError(err.message); throw err; }`. Inside the try block: call `jose.jwtVerify(token, this.jwks, { issuer: \`https://login.microsoftonline.com/${tenantId}/v2.0\`, audience: \`api://${clientId}\` })`; extract `scp` claim (space-delimited string) from payload; assert every scope in `requiredScopes` is present — if not, `throw new InsufficientScopeError(\`Missing required scopes: ...\`)`; return `{ token, clientId: payload.sub ?? payload.oid ?? "unknown", scopes: scpArray, expiresAt: payload.exp as number | undefined }`. **The catch MUST NOT swallow non-jose errors.** Network failures from `RemoteJWKSet`'s underlying fetch (`TypeError("fetch failed")`, DNS errors, HTTP errors from the JWKS endpoint) are NOT `JOSEError` instances — they must propagate so the startup probe in Task 3.4 can discriminate "JWKS unreachable" from "token rejected". **Also export** `export const STARTUP_PROBE_JWT = "eyJhbGciOiJSUzI1NiIsImtpZCI6InN0YXJ0dXAtcHJvYmUifQ.eyJpc3MiOiJzdGFydHVwLXByb2JlIn0.invalid"` — a structurally-valid JWT (header `{alg:"RS256",kid:"startup-probe"}`, payload `{iss:"startup-probe"}`, junk signature) used by `server.ts` for the JWKS startup probe. The sentinel MUST be structurally valid; an arbitrary string would fail `jose.jwtVerify`'s structural parse before any JWKS fetch is attempted, defeating the probe.
  - Acceptance: `vi.mock("jose")`. `verifyAccessToken("valid-jwt")` resolves to `AuthInfo` when `jwtVerify` resolves with valid payload including `scp: "mcp email"`. `verifyAccessToken("expired-jwt")` rejects with `InvalidTokenError` when `jwtVerify` throws a `JWTExpired`-shaped error (must extend `jose.errors.JOSEError`). `verifyAccessToken("no-scope-jwt")` rejects with `InsufficientScopeError` when `scp` is missing the required scope. **Network-error propagation test:** when `jwtVerify` throws a plain `new TypeError("fetch failed")`, `verifyAccessToken` must reject with that exact `TypeError` (NOT `InvalidTokenError`). `STARTUP_PROBE_JWT` is exported as a non-empty string with three dot-separated segments.
  - Depends on: Task 1.3
  - Examples: Example 13, Example 14, Example 16
  - Completed: 2026-05-26
  - Tests: src/__tests__/http/auth/entra-verifier.test.ts

- [x] **Task 3.3** — Extend `src/http/auth/build.ts` with non-local Entra branch
  - File(s): `src/http/auth/build.ts`, `src/__tests__/http/auth/build.test.ts` (extend existing test file)
  - What to do: Add the non-local overload: `function buildAuth(settings: NonLocalSettings, redisClient: RedisClientType): { provider: ProxyOAuthServerProvider, verifier: OAuthTokenVerifier, requiredScopes: string[] }`. The overload ensures TypeScript requires `redisClient` when settings are non-local — no `redisClient!` non-null assertion needed. Implementation for the non-local branch: instantiate `EntraVerifier`, instantiate `store = new RedisOAuthClientsStore({ get: redisClient.get.bind(redisClient), set: redisClient.set.bind(redisClient) })`, instantiate `provider = new ProxyOAuthServerProvider({ endpoints: { authorizationUrl: \`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize\`, tokenUrl: \`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token\` }, verifyAccessToken: (token) => verifier.verifyAccessToken(token), getClient: (id) => store.getClient(id) })`, then override the provider's `clientsStore` getter: `Object.defineProperty(provider, 'clientsStore', { value: store })`. This override is necessary because the SDK's `ProxyOAuthServerProvider` only includes `registerClient` in its `clientsStore` getter when `endpoints.registrationUrl` is provided (we don't pass one since DCR is local). The `mcpAuthRouter` reads `provider.clientsStore.registerClient` to decide whether to mount `/register`. Without the override, DCR is silently disabled. Return `{ provider, verifier, requiredScopes: settings.ENTRA_REQUIRED_SCOPES.split(",") }`. No `clientsStore` in the return type — the provider now exposes the full store via its overridden `clientsStore` getter.
  - Acceptance: `vi.mock` for `EntraVerifier`, `RedisOAuthClientsStore`, `ProxyOAuthServerProvider`. Given `ENVIRONMENT=development` settings and a mock Redis client, `buildAuth(settings, redisClient)` returns `{ provider: ProxyOAuthServerProvider instance, verifier: EntraVerifier instance, requiredScopes: ["mcp"] }`. Verify that `Object.defineProperty` was called on the provider with key `'clientsStore'` and that `provider.clientsStore` returns the `RedisOAuthClientsStore` instance (i.e., has a `registerClient` method).
  - Depends on: Task 3.1, Task 3.2
  - Examples: Example 14, Example 15, Example 16
  - Completed: 2026-05-26
  - Tests: src/__tests__/http/auth/build.test.ts

- [x] **Task 3.4** — Wire Redis startup probe, Entra JWKS probe, and `mcpAuthRouter` into `src/http/server.ts`
  - File(s): `src/http/server.ts`
  - What to do: In the non-local startup path (after `xeroReady = true`): (1) Create Redis client `createClient({ url: settings.REDIS_URL })` → `await redisClient.connect()` → `await redisClient.ping()` — on failure throw `new Error(\`Redis unreachable: ${settings.REDIS_URL}\`)`. (2) Call `buildAuth(settings, redisClient)` — returns `{ provider, verifier, requiredScopes }`. (3) Warm the Entra JWKS: import `STARTUP_PROBE_JWT` from `./auth/entra-verifier.js` and call `verifier.verifyAccessToken(STARTUP_PROBE_JWT)` inside a try/catch. If it throws `InvalidTokenError` (from `@modelcontextprotocol/sdk/server/auth/errors.js`), the probe succeeded — the JWKS endpoint was reached and the keyset was parsed; the structurally-valid sentinel was correctly rejected. If it throws **any other error** (a non-`JOSEError` propagated by the selective catch in `EntraVerifier.verifyAccessToken` — typically `TypeError("fetch failed")` for network failures, DNS resolution errors, or HTTP error responses from the JWKS endpoint), rethrow as `new Error(\`Entra JWKS unreachable: https://login.microsoftonline.com/${settings.ENTRA_TENANT_ID}/discovery/v2.0/keys\`)`. The discriminator is the `InvalidTokenError` class — see Task 3.2 for why the sentinel must be a structurally-valid JWT (an arbitrary string like `"mcp-startup-probe"` would short-circuit at `jose`'s structural parse and silently pass even when Entra is unreachable). (4) When `provider` is present, mount `app.use(mcpAuthRouter({ provider, issuerUrl: new URL(settings.MCP_SERVER_URL), baseUrl: new URL(settings.MCP_SERVER_URL), resourceServerUrl: new URL(settings.MCP_SERVER_URL), scopesSupported: requiredScopes, clientRegistrationOptions: { clientSecretExpirySeconds: 60 * 60 * 24 * 365, clientIdGeneration: false } }))` before the `/mcp` route (but after health router). Note: `clientIdGeneration: false` because `RedisOAuthClientsStore` is the sole owner of `client_id` generation. No `clientsStore` in `clientRegistrationOptions` — the router reads it from `provider.clientsStore` (overridden in `buildAuth` via `Object.defineProperty`). Import `createClient` from `"redis"`, `mcpAuthRouter` from `@modelcontextprotocol/sdk/server/auth/router.js`, `InvalidTokenError` from `@modelcontextprotocol/sdk/server/auth/errors.js`, `STARTUP_PROBE_JWT` from `./auth/entra-verifier.js`.
  - Acceptance: Given `ENVIRONMENT=development` and `REDIS_URL=redis://does-not-resolve:6379`, process exits non-zero and log contains `"Redis unreachable"`. Given unreachable Entra tenant, process exits non-zero and log contains `"Entra JWKS unreachable"`. Given `ENVIRONMENT=development` and missing `ENTRA_TENANT_ID`, `loadSettings()` throws naming `"ENTRA_TENANT_ID"` before any network call.
  - Depends on: Task 2.3, Task 3.3
  - Examples: Example 15, Example 16, Example 17
  - Completed: 2026-05-26

- [x] **Task 3.5** — Integration test: `src/__tests__/http/server.test.ts`
  - File(s): `src/__tests__/http/server.test.ts`
  - What to do: Write integration tests for `server.ts` using `supertest`. Mock at module boundaries: `vi.mock("../../clients/xero-client.js")` (stub `authenticate: vi.fn().mockResolvedValue(undefined)`), `vi.mock("../../tools/tool-factory.js")` (no-op), `vi.mock("../http/sessions.js")` (stub `SessionManager` so `createSession` resolves with a fake `{ sessionId: "test-session-id", transport: { handleRequest: vi.fn() } }` and `getSession` returns the same). Test cases: (1) `GET /livez` returns 200 `{"status":"ok"}` in local mode. (2) `POST /mcp` without `Authorization` header returns 401 with `WWW-Authenticate` header. (3) `POST /mcp` with `Authorization: Bearer <correct>` and `initialize` body returns 200 with `Mcp-Session-Id: test-session-id`. (4) `POST /mcp` with `Authorization: Bearer <correct>` and `Mcp-Session-Id: unknown-id` returns 404. (5) When `sessionManager.createSession()` throws `SessionCapError`, returns 503 `{"error":"session_cap_reached"}`.
  - Acceptance: All five test cases pass. `npm run test` shows green for `src/__tests__/http/server.test.ts`. No regression in `src/__tests__/clients/xero-client.test.ts`.
  - Depends on: Task 3.4
  - Examples: Example 1, Example 2, Example 3, Example 9, Example 10
  - Completed: 2026-05-26
  - Tests: src/__tests__/http/server.test.ts

---

### Phase 4: ADR confirmation and documentation

Goal: ADRs flipped to `Accepted`; `.env.example` updated; all existing tests
still green. No new source files.

---

- [x] **Task 4.1** — Flip ADR-0002 and ADR-0003 from Draft to Accepted
  - File(s): `.specs/adr/0002-mcp-http-transport-and-oauth.md`, `.specs/adr/0003-oauth-state-in-redis.md`
  - What to do: Change `Status: Draft` to `Status: Accepted` in both files. In ADR-0002, add a note under Consequences confirming that Express 5 (not 4) was used since the SDK's peer dependency is `express@^5.2.1`. In ADR-0003, confirm that `RedisOAuthClientsStore` uses a narrow Redis interface (`get`/`set`) rather than the full `RedisClientType` to keep the class independently testable. No other content changes unless the build surfaced discrepancies with the written decisions.
  - Acceptance: Both files have `Status: Accepted`. No other spec files are touched.
  - Depends on: Task 3.5
  - Completed: 2026-05-26

- [x] **Task 4.2** — `.env.example` — Append OSB HTTP-mode section
  - File(s): `.env.example`
  - What to do: Append the OSB HTTP-mode block below the existing three Xero entries (which must remain byte-for-byte identical). The appended block is exactly as specified in design.md § 11, including all comments and blank-line separators. Verify by running `head -14 .env.example` and confirming the upstream block is unchanged.
  - Acceptance: `git diff .env.example` shows zero changes to lines 1-14 (the upstream block); the appended OSB section contains all 13 variables listed in FR-22; `npm run build` still exits 0.
  - Depends on: Task 4.1
  - Examples: (documentation — no test coverage)
  - Completed: 2026-05-26

- [x] **Task 4.3** — `src/__tests__/http/` — Final cross-suite regression pass
  - File(s): (no new files — run existing suite)
  - What to do: Run `npx vitest run src/__tests__/` and confirm all suites pass: `clients/xero-client.test.ts`, `http/settings.test.ts`, `http/logging.test.ts`, `http/sessions.test.ts`, `http/health.test.ts`, `http/auth/local-verifier.test.ts`, `http/auth/entra-verifier.test.ts`, `http/auth/redis-clients-store.test.ts`, `http/auth/build.test.ts`, `http/server.test.ts`. Fix any test isolation issues (e.g., `vi.resetModules()` missing in a `beforeEach`).
  - Acceptance: `npx vitest run src/__tests__/` exits 0 with all suites green. No test in the clients suite is broken by the new HTTP tests.
  - Depends on: Task 4.2
  - Completed: 2026-05-26

---

### Phase 5: Build verification

Goal: Both entry points compile cleanly; type-check passes; lint passes.

---

- [x] **Task 5.1** — Confirm both compiled entry points exist and are executable
  - File(s): (verification only)
  - What to do: Run `npm run build`. Verify: `ls -la dist/index.js dist/http/server.js` — both exist and have `x` permission bit set. Run `node dist/index.js --help 2>&1 || true` (should not crash immediately on missing env, since xeroClient throws before the listen call — acceptable). Run `node -e "require('./dist/http/server.js')"` — should not syntax-error (will likely throw on missing env vars, which is correct behaviour).
  - Acceptance: `npm run build` exits 0; both `dist/index.js` and `dist/http/server.js` have executable permission; `git diff -- src/ ':!src/http'` shows zero changes.
  - Depends on: Task 4.3
  - Examples: Example 19, Example 20
  - Completed: 2026-05-26

- [x] **Task 5.2** — Lint and type-check pass
  - File(s): (verification only); `eslint.config.js` (additive test-file override)
  - What to do: Run `npm run lint` and `npx tsc --noEmit`. Fix any ESLint or TypeScript errors that surface (expected: none if the individual tasks were type-clean, but verify explicitly).
  - Acceptance: `npm run lint` exits 0 with no errors. `npx tsc --noEmit` exits 0.
  - Depends on: Task 5.1
  - Completed: 2026-05-26

---

## Out of Scope

- **CORS support** — deliberate omission per FR-19 and requirements Non-Goals. No `cors()` middleware, no `Access-Control-Allow-*` headers.
- **Encryption at rest for Redis DCR records** — deferred per requirements Non-Goals. ADR-0003 documents the follow-up.
- **Audit logging of tool invocations** — separate future feature per PRD §4.1.
- **Rate limiting** — deferred per requirements Non-Goals.
- **Tool-surface restriction** — deferred per requirements Non-Goals.
- **Container, compose, and Helm artefacts** — owned by the `infra` layer (`/.specs/002-http-transport-and-oauth/infra/`).
- **`src/http/server.ts` full integration test against a real Redis or Entra endpoint** — out of scope for this unit-test suite; the startup probe behaviour (AC-6, AC-7) is covered at the module level in Task 3.4's acceptance criteria and verified manually via the Verification section of the plan.
- **`supertest` for full-server tests that exercise actual `StreamableHTTPServerTransport` protocol** — deferred; session handling via mocked transport is sufficient for the TDD cycle at this granularity.
