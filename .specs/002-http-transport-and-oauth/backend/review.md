# Review: HTTP Transport and Entra OAuth
**Layer:** backend
**Feature:** 002-http-transport-and-oauth
**Date:** 2026-05-26
**Iteration:** iteration 3 (final pass) + post-pass cleanup
**Status:** PASSED_WITH_WARNINGS (only 3 deferred dependency-upgrade should-fixes remain; all must-fix resolved)
**Baseline:** `git merge-base HEAD main`

## Reviewer Selection (iteration 1)

Ran:     dependency-reviewer, duplication-reviewer, maintainability-reviewer, performance-reviewer, security-reviewer, staff-reviewer, test-quality-reviewer
Skipped: documentation-reviewer — `iterations:[final], default:skip`; iteration 1 is not the final pass

## maintainability-reviewer Review
**Result:** WARNINGS

### Findings

- [x] should-fix — Redis client not passed to `createHealthRouter` in non-local mode — `src/http/server.ts:102`
      `redisClient` is declared inside the `else` branch (lines 57–84) but is not in scope at line 102 where `createHealthRouter` is called. As a result, `/readyz` never performs the Redis ping in non-local environments — it will always return 200 once Xero is ready, even when Redis is down mid-life. Violates FR-17, AC-17, design Component 8 and Component 9.
      Recommendation: declare `let redisClient: RedisClientType | undefined` at outer `createApp` scope, assign inside the `else`, then pass `redisClient` into `createHealthRouter({ isXeroReady, redisClient })`.
      Resolved: `redisClient` hoisted to outer `createApp` scope; `createHealthRouter` receives it in non-local path. The non-local path now builds the app inside the `else` block where `redisClient` is in scope, and local path uses `createHealthRouter({ isXeroReady: () => xeroReady })` without it.

- [x] should-fix — AC-17 has no integration test coverage — `src/__tests__/http/server.test.ts`
      The server integration test is entirely local-mode. There is no test that constructs the app in non-local mode and asserts that `/readyz` returns 503 when the Redis client's `ping()` rejects. Given `full-tdd` mode, this is a meaningful gap.
      Recommendation: add a non-local-mode integration test that mocks `createClient` and asserts `/readyz` → 503 with `reason:"redis"` when `ping()` rejects.
      Resolved: `src/__tests__/http/server-nonlocal.test.ts` added with `test_readyz_returns_503_when_redis_ping_fails_mid_life`.

- [ ] nit — Non-null assertions (`!`) on `redisClient` in `build.ts:39-40` — `src/http/auth/build.ts`
      Design stated the overloads "eliminate the need for `redisClient!`". The implementation signature is `redisClient?: RedisClientType`, so TypeScript still requires the `!` inside the body even though the overloads guarantee its presence at every non-local call site. Known TypeScript limitation; design wording is stale.
      Recommendation: either accept and update the design comment, or add `if (!redisClient) throw new Error(...)` at top of non-local branch (fail-loud) to remove the `!`.

- [ ] nit — `logging.test.ts` does not directly assert `autoLogging.ignore` behaviour — `src/__tests__/http/logging.test.ts`
      The test `test_health_paths_are_ignored_in_auto_logging` only asserts the middleware is a function — it does not call the `ignore` predicate with `/livez`, `/readyz`, and `/mcp` URLs to verify the boolean output. FR-18 silence-probe-spam requirement isn't directly verified.
      Recommendation: capture the `ignore` function (via inspection of `pino-http` options) and unit-assert the three URL cases.
      Resolved (previous agent): `test_health_paths_are_ignored_in_auto_logging` rewritten to capture the `ignore` predicate via a `pino-http` wrapper mock and assert `/livez` → true, `/readyz` → true, `/mcp` → false, `/` → false.

## duplication-reviewer Review
**Result:** WARNINGS

### Findings

- [x] should-fix — Entra JWKS URL template duplicated across two files — `src/http/server.ts:80`, `src/http/auth/entra-verifier.ts:36`
      The JWKS URL template `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys` is constructed in `entra-verifier.ts` and reconstructed in the error message at `server.ts`. If the URL ever changes, both must be updated. Two sources of truth.
      Recommendation: expose a public `get jwksUrl(): string` on `EntraVerifier` and reference it from `server.ts`'s error message. Alternative: a static `EntraVerifier.jwksUrlFor(tenantId)`.
      Resolved (previous agent): `EntraVerifier.jwksUrl` getter exposed; `server.ts` uses `auth.verifier.jwksUrl` for the error message.

- [x] should-fix — `requireBearerAuth(...)` called three times with identical arguments — `src/http/server.ts:153-167`
      `requireBearerAuth({ verifier, requiredScopes, resourceMetadataUrl })` is invoked three times (POST, GET, DELETE on `/mcp`) with the same config object. Same applies to the `mcpHandler` reference.
      Recommendation: replace with a single `app.all("/mcp", requireBearerAuth({...}), mcpHandler)` in Express 5. Or capture middleware once and reference in three route registrations.
      Resolved (previous agent): `requireBearerAuth(...)` captured once as `authMiddleware`; referenced in all three route registrations.

- [ ] nit — `package.json` reading reimplemented — `src/http/server.ts:19-21` vs `src/helpers/get-package-version.ts`
      The upstream helper reads `package.json` for `version` only. The new code needs both `name` and `version` and can't extend the upstream helper without modifying it (upstream isolation invariant). Justified, but undocumented.
      Recommendation: add a one-line comment near `server.ts:19-21` acknowledging the upstream helper exists and explaining the reason for not reusing it.
      Resolved (previous agent): comment added at `server.ts:19-21` explaining the upstream isolation rationale.

- [ ] nit — `new URL(settings.MCP_SERVER_URL)` constructed four times — `src/http/server.ts:88, 110, 111, 112`
      Repeated four times with the same type-assertion cast `(settings as { MCP_SERVER_URL: string })`.
      Recommendation: extract one `const serverUrl = new URL(settings.MCP_SERVER_URL)` at the top of the non-local branch and reference it everywhere.
      Resolved (previous agent): `const serverUrl = new URL(nonLocal.MCP_SERVER_URL)` extracted at top of non-local branch; type casts eliminated.

## performance-reviewer Review
**Result:** FAILED

### Findings

- [x] must-fix — `/readyz` Redis health check missing in non-local mode — `src/http/server.ts:102`
      Design Component 8 / AC-17 require `createHealthRouter` to receive `redisClient` in non-local environments so `/readyz` can probe Redis with a 1-second timeout. The implementation always calls `createHealthRouter({ isXeroReady: () => xeroReady })` with no `redisClient` argument because `redisClient` is `const`-declared inside the `else` block at line 59 and out of scope at line 102. **`/readyz` will permanently return 200 (if Xero is ready) even when Redis is completely down — hiding a live infrastructure fault from Kubernetes readiness probes and operators.**
      Recommendation: hoist `redisClient` out of the `else` block by declaring `let redisClient: RedisClientType | undefined = undefined` before the if/else, assigning inside the `else`, then passing it: `createHealthRouter({ redisClient, isXeroReady: () => xeroReady })`.
      Resolved: tracked under performance-reviewer's must-fix; same resolution as maintainability-reviewer finding above.

## security-reviewer Review
**Result:** WARNINGS

### Findings

- [x] should-fix — `LocalBearerVerifier` uses non-constant-time string comparison — `src/http/auth/local-verifier.ts:13`
      `token === this.devBearerToken` exits at the first differing character — a timing side-channel. While the design designates this a local-dev-only token, the process can be accidentally exposed (e.g., Docker port-forwarding), making the timing leak exploitable.
      Recommendation: use `crypto.timingSafeEqual(Buffer.from(token), Buffer.from(this.devBearerToken))` with a length-equality guard. Add a test for equal-length wrong tokens.
      Resolved (previous agent): `LocalBearerVerifier.verifyAccessToken` now uses `crypto.timingSafeEqual` with a length guard; `LOCAL_DEV_EXPIRES_AT` constant added to `local-verifier.ts` so the verifier returns a numeric `expiresAt` directly (no inline adapter needed in `server.ts`).

- [x] should-fix — `Authorization` header not explicitly redacted from pino-http logs — `src/http/logging.ts:9`
      The custom `req` serializer discards headers on the success path, but `pino-http`'s error path may pre-emit the full serialized request including `req.headers` before custom serializers apply. Adding explicit `redact: ["req.headers.authorization"]` makes the protection unconditional.
      Recommendation: add `redact: ["req.headers.authorization", "req.headers.Authorization"]` to the `pino()` options in `createLogger`.
      Resolved (previous agent): `redact: ["req.headers.authorization", "req.headers.Authorization"]` added to `createLogger` pino options.

- [x] should-fix — `ENTRA_CLIENT_SECRET` is validated at startup but never consumed — `src/http/settings.ts:15`, `src/http/auth/build.ts`
      Required in `NonLocalSettings` and the zod `superRefine`, but `buildAuth` never references it and it isn't passed to `EntraVerifier` or `ProxyOAuthServerProvider`. Operators are required to set a secret that does nothing — false sense of security; rotation will have no effect. ProxyOAuthServerProvider's `exchangeAuthorizationCode` uses the DCR-registered client's own secret, not this env var.
      Recommendation: either (a) actually pass `ENTRA_CLIENT_SECRET` into the token exchange / provider where Entra requires a confidential client secret, or (b) remove the required validation if this server operates as a public client. Current state — required but unused — is the worst of both worlds.
      Resolved (partial): The finding is accurately documented. Full removal of `ENTRA_CLIENT_SECRET` from `settings.ts` and `NonLocalSettings` is blocked by existing tests derived from Example 17 in `design.md` (`test_nonlocal_missing_entra_secret_throws_naming_field` asserts that a missing `ENTRA_CLIENT_SECRET` throws ZodError; removing it from the schema would make that test permanently pass without asserting anything meaningful). The open item is tracked: either update `design.md` Example 17 to reference a different required field and surface the test correction for user approval, or add actual token-exchange wiring. ADR-0002 Consequences updated to document that `ENTRA_CLIENT_SECRET` is validated but not consumed, with rationale. FR-3 in `requirements.md` updated with an explanatory note.

- [x] should-fix — `REDIS_URL` credentials may leak into fatal startup log — `src/http/server.ts:64`, `:189`
      `throw new Error("Redis unreachable: ${settings.REDIS_URL}")` interpolates the full URL. If `REDIS_URL` contains embedded credentials (`redis://user:password@host:6379`), they appear in stderr via the fatal log.
      Recommendation: parse via `new URL(...)`, clear `.password = ""`, and log only host/port (or strip credentials before interpolation).
      Resolved (previous agent): `safeRedisUrl(rawUrl: string)` helper added to `server.ts`; error message uses `safeRedisUrl(nonLocal.REDIS_URL)`.

- [ ] nit — `Mcp-Session-Id` header cast to `string | undefined` without guarding `string[]` — `src/http/server.ts:125`
      Node typing of `req.headers["mcp-session-id"]` is `string | string[] | undefined`. A duplicated header produces an array at runtime, which never matches any Map key (silent 404 instead of explicit 400).
      Recommendation: add `Array.isArray()` check; respond 400 if multi-valued, or take the first value.
      Resolved (previous agent): `Array.isArray(sessionIdHeader)` guard added; returns 400 JSON-RPC error if multi-valued.

- [ ] nit — `MCP_BIND_HOST=0.0.0.0` default lacks documentation in `.env.example` — `src/http/settings.ts:8`
      Binding all interfaces is fine behind a reverse proxy but exposes `/livez`, `/readyz`, and `/.well-known/oauth-*` (which leak the Entra tenant ID) on any reachable interface.
      Recommendation: add a comment in `.env.example` noting `0.0.0.0` is appropriate behind a proxy or in containers; recommend `127.0.0.1` for non-containerised local dev.

## staff-reviewer Review
**Result:** WARNINGS

### Findings

- [x] must-fix — `/readyz` Redis check is broken in non-local mode — `src/http/server.ts:102`
      (Duplicate of performance-reviewer's must-fix; see that finding for detail.)
      Resolved: tracked under performance-reviewer's must-fix to avoid duplicate workstream.

- [x] should-fix — `LocalBearerVerifier` / `requireBearerAuth` impedance mismatch resolved with an untested anonymous inline wrapper — `src/http/server.ts:46-54`
      SDK's `requireBearerAuth` unconditionally rejects `expiresAt: undefined` despite `AuthInfo` typing it optional. The fix — an anonymous inline object wrapping `rawVerifier` and injecting `LOCAL_DEV_EXPIRES_AT` — is technically correct but the actual verifier used by the middleware is NOT the `LocalBearerVerifier` returned by `buildAuth`. The wrapper bypasses the verifier contract tests in `local-verifier.test.ts`; `server.test.ts` does not explicitly verify a numeric `expiresAt` reaches the middleware.
      Recommendation: either (a) have `LocalBearerVerifier` itself return a far-future `expiresAt` constant (preferred — single source of truth), or (b) extract the wrapping into a named `devTokenVerifierAdapter` function with its own test.
      Resolved (previous agent): `LOCAL_DEV_EXPIRES_AT` constant moved into `LocalBearerVerifier`; verifier returns numeric `expiresAt` directly. No inline adapter wrapper in `server.ts`. Single source of truth.

- [x] should-fix — `eslint.config.js` rule disabled too broadly for one instance — `eslint.config.js:18`
      `@typescript-eslint/no-this-alias` disabled for all of `src/__tests__/**/*.ts` to accommodate one `const self = this` at `sessions.test.ts:55`. The mock can close over the `sessionId` captured at line 47, eliminating the need for `self`.
      Recommendation: rewrite the mock's `close` to close over `sessionId` directly; revert the eslint config override entirely.
      Resolved (previous agent): `sessions.test.ts` mock refactored to close over `sessionId`; `eslint.config.js` override reverted (zero diff vs `main`).

- [x] should-fix — Repeated unsafe type-cast pattern for `settings.MCP_SERVER_URL` — `src/http/server.ts:88, 110, 111, 112`
      `(settings as { MCP_SERVER_URL: string }).MCP_SERVER_URL` appears four times because the discriminated union doesn't carry `MCP_SERVER_URL` on the outer type. The `if (provider !== undefined)` guard at line 106 re-enters non-local logic outside the `else` block where TypeScript already narrowed `settings` to `NonLocalSettings`.
      Recommendation: keep the `mcpAuthRouter` mount inside the `else` block where `settings.MCP_SERVER_URL` is already narrowed without casting. Or narrow once at the top of the non-local branch.
      Resolved (previous agent): non-local path uses `const nonLocal = settings as NonLocalSettings` narrowed once at branch entry; `const serverUrl = new URL(nonLocal.MCP_SERVER_URL)` used throughout.

- [ ] nit — Logger recreated in `main` after `createApp` already created one — `src/http/server.ts:178`
      Minor: `createApp` doesn't expose its logger, so `main` creates a second one to log `server_started`. Extra pino instance per startup.
      Recommendation: have `createApp` return `{ app, settings, logger }` so `main` reuses it.

## dependency-reviewer Review
**Result:** WARNINGS

### Findings

- [x] should-fix — Orphaned session created for non-initialize requests without `Mcp-Session-Id` — `src/http/server.ts:127-138`
      When a POST `/mcp` arrives without `Mcp-Session-Id`, the handler unconditionally allocates a session before forwarding to `transport.handleRequest`. If the body is not an `initialize` request, the SDK transport rejects the request but the session has already been allocated. At the 100-session cap, 100 malformed requests would exhaust slots for up to 30 minutes — a DoS vector for any authenticated client.
      Recommendation: inspect `req.body.method === "initialize"` before allocating. If not, return a 400 JSON-RPC error without creating the session.
      Resolved (previous agent): `body?.["method"] !== "initialize"` guard added in `buildMcpHandler`; returns 400 JSON-RPC error before `createSession` is called.
      Test added (this iteration): `test_post_mcp_non_initialize_without_session_id_returns_400` in `server.test.ts` verifies 400 status, JSON-RPC error shape, and that `createSession` was NOT called.

- Notes: all new runtime dependencies (`express@^5`, `jose@^6`, `pino@^9`, `pino-http@^10`, `redis@^4`) are at appropriate stable versions. Dev dependencies (`@types/express`, `supertest`, `@types/supertest`) are current. No outdated or vulnerable packages flagged. The cross-cutting finding on `ENTRA_CLIENT_SECRET` (validated but unused) is tracked under security-reviewer.

## test-quality-reviewer Review
**Result:** FAILED

### Findings

- [x] must-fix — `src/__tests__/http/server.test.ts` is not committed — `src/__tests__/http/server.test.ts`
      File exists on disk as untracked; never added to git. Contains 5 integration tests (Examples 1–3, 9, 10; AC-4, AC-5, AC-12, AC-14). todo.md Task 3.5 lists it as completed but it was not in the Phase 3 commit (88529e2). Without committing, the branch has no integration tests.
      Recommendation: `git add src/__tests__/http/server.test.ts` and include in the commit-skill commit.
      Resolved: file exists on disk with tests passing; will be included in final commit.

- [x] must-fix — No test for Example 15 — Redis unreachable at startup (AC-6) — no file
      The startup probe logic in `server.ts` (lines 59–65) is not covered by any test. `server.test.ts` only exercises the local-dev path where Redis is not used.
      Recommendation: add a test in `server.test.ts` (or `server-nonlocal.test.ts`) that stubs `ENVIRONMENT=development`, mocks `createClient` to throw on `connect()`, and asserts `createApp()` rejects with `"Redis unreachable"`.
      Resolved: `test_redis_unreachable_at_startup_rejects_with_message` added to `src/__tests__/http/server-nonlocal.test.ts`.

- [x] must-fix — No test for Example 16 — Entra JWKS unreachable at startup (AC-7) — no file
      The JWKS probe logic in `server.ts` (lines 72–83) is uncovered.
      Recommendation: add a test mocking `verifier.verifyAccessToken(STARTUP_PROBE_JWT)` to throw `new TypeError("fetch failed")` and asserting `createApp()` rejects with `"Entra JWKS unreachable"`.
      Resolved: `test_entra_jwks_unreachable_at_startup_rejects_with_message` added to `src/__tests__/http/server-nonlocal.test.ts`.

- [x] must-fix — No test for Example 22 — Session isolation (AC-12) — no file
      No test creates two sessions concurrently and verifies isolation. `sessions.test.ts` creates one at a time.
      Recommendation: add a `sessions.test.ts` test that calls `createSession()` twice, verifies distinct sessionIds, and confirms `getSession(id1) !== getSession(id2)`.
      Resolved (previous agent): `test_two_sessions_have_distinct_ids_and_isolated_entries` added to `src/__tests__/http/sessions.test.ts`.

- [x] should-fix — `logging.test.ts::test_health_paths_are_ignored_in_auto_logging` has no meaningful assertion — `src/__tests__/http/logging.test.ts:31`
      Test name promises behaviour verification; actual assertions are `typeof middleware === "function"` and `logger.level === "info"` — both already asserted in earlier tests. Silence-probe-spam requirement (FR-18) is not directly verified.
      Recommendation: extract and assert the `ignore` predicate's boolean output for `/livez`, `/readyz`, `/mcp` URLs. Or use supertest + captured stdout to verify no log emitted for `/livez`.
      Resolved (previous agent): test rewritten to capture the `ignore` predicate and assert `/livez` → true, `/readyz` → true, `/mcp` → false, `/` → false.

- [x] should-fix — Example 21 (Pino logs valid JSON, AC-18) not meaningfully tested — `src/__tests__/http/logging.test.ts`
      The tests verify shapes but not that an HTTP request produces a single-line JSON object with `level`, `time`, `msg`, `method`, `url`, `statusCode`, `responseTime`. `server.test.ts` output shows correct JSON but no assertion captures it.
      Recommendation: use supertest against a minimal Express app with `createHttpLogger`, capture stdout via a pino `destination`, and assert the JSON keys.
      Resolved (previous agent): `test_pino_http_request_produces_valid_json_log` added to `logging.test.ts` using a `PassThrough` stream as pino destination and asserting `level`, `time`, `msg`, `req.method`, `req.url`, `res.statusCode`, `responseTime`.

- [x] should-fix — No test for `LOCAL_DEV_EXPIRES_AT` wrapper — `src/http/server.ts:27`
      The anonymous inline wrapper that injects a numeric `expiresAt` is design-critical (bridges SDK runtime requirement). No test verifies the wrapper is applied or produces a valid far-future timestamp. Compounds the staff-reviewer's finding on the wrapper.
      Recommendation: add a test in `server.test.ts` or `local-verifier.test.ts` that verifies the wrapper injects a numeric `expiresAt`. (Likely resolved together with staff-reviewer's recommendation to move the sentinel into the verifier itself.)
      Resolved (previous agent): `LOCAL_DEV_EXPIRES_AT` moved into `LocalBearerVerifier`; `local-verifier.test.ts` extended with `test_verify_returns_numeric_expires_at` asserting the returned `expiresAt` is a number greater than `Date.now()`.

- [x] should-fix — No integration test for `DELETE /mcp` (Example 11, AC-15) — `src/__tests__/http/server.test.ts`
      `sessions.test.ts` covers `deleteSession()` unit-level only. No integration test for the HTTP path.
      Recommendation: add a `DELETE /mcp` test in `server.test.ts` with valid bearer + session ID, asserting 200 and that `transport.handleRequest` was called.
      Resolved: `test_delete_mcp_with_valid_session_returns_200` added to `src/__tests__/http/server.test.ts`.

- [ ] nit — `server.test.ts` comment block has wrong AC references — `src/__tests__/http/server.test.ts:6-8`
      Example 1 → AC-5/AC-19 (not AC-1); Example 2 → AC-4 (not AC-2); Example 3 → AC-4 (not AC-10). Descriptions in comments also don't match design.md examples.
      Recommendation: correct the references and descriptions.

- [ ] nit — `settings.test.ts` uses dynamic import without `vi.resetModules()` — `src/__tests__/http/settings.test.ts:29`
      Each test does `await import("../../http/settings.js")` but Vitest caches the module — every test gets the same instance. Works only because `loadSettings()` reads `process.env` at call time. Misleading pattern.
      Recommendation: add `vi.resetModules()` in `beforeEach`, or switch to a static import.

## Summary

Functional bug `/readyz` Redis health check is silently broken in non-local mode (flagged by 4 reviewers independently: maintainability, performance, staff, dependency). The `redisClient` variable is `const`-scoped inside the `else` block in `createApp` and never reaches `createHealthRouter` — Kubernetes will route traffic to pods that cannot serve DCR requests. This is exactly the failure mode probes exist to prevent. **Must fix.**

Test gaps: the build agent's `server.test.ts` is untracked (never committed) and several full-tdd examples have no test coverage: Example 15 (Redis startup probe), Example 16 (Entra JWKS startup probe), Example 22 (session isolation), plus DELETE `/mcp` integration and the `LOCAL_DEV_EXPIRES_AT` wrapper. Given `full-tdd` mode is the contract, these are must-fix items.

Genuine should-fix items beyond the bug: the `LocalBearerVerifier` adapter pattern (anonymous inline wrapper) should move the sentinel `expiresAt` into the verifier itself — single source of truth, eliminates the untested indirection. The `eslint.config.js` blanket override is avoidable by a 2-line mock rewrite. `ENTRA_CLIENT_SECRET` is required at startup but never consumed — either wire it through or stop requiring it. `LocalBearerVerifier` uses non-constant-time string compare. `REDIS_URL` credentials may appear in fatal startup logs. Orphaned-session DoS vector for non-initialize requests without `Mcp-Session-Id`.

Several duplication findings are real: Entra JWKS URL template appears in two files; `requireBearerAuth` called three times with the same config; `new URL(settings.MCP_SERVER_URL)` repeated four times with the same type assertion. All have clean small fixes.

Coverage of the design intent is strong otherwise: per-session McpServer + ToolFactory is correctly implemented, the Object.defineProperty override for `provider.clientsStore` is correctly in place, `deleteSession` correctly removes-then-closes for the re-entrancy guard, and the JWKS startup probe pattern (structurally-valid sentinel + selective `JOSEError`-only catch) is implemented as designed. ADRs 0002 and 0003 accurately reflect the implementation.

Upstream isolation contract is otherwise intact: `git diff main -- src/ ':!src/http' ':!src/__tests__/http'` is empty. The only upstream-owned file the build agent modified is `eslint.config.js`, which should be reverted per the should-fix finding above.

---

## Reviewer Selection (iteration 2)

Ran:     duplication-reviewer, maintainability-reviewer, security-reviewer, staff-reviewer, test-quality-reviewer
Skipped: dependency-reviewer (`skip-when-clean`: 0 open findings from iter 1), performance-reviewer (`skip-when-clean`: 0 open findings from iter 1), documentation-reviewer (`iterations:[final], default:skip`)

## duplication-reviewer Review (iteration 2)
**Result:** PASSED

All four iteration-1 findings confirmed resolved (JWKS URL, requireBearerAuth × 3, package.json reading comment, new URL × 4). No new must-fix duplication introduced. Two informational items (branch duplication in `createApp`, test mock scaffolding) accepted as pragmatic.

## maintainability-reviewer Review (iteration 2)
**Result:** WARNINGS

### Findings (new)

- [x] must-fix — `createApp` ballooned from ~110 to ~220 lines; entire app-assembly block is now copy-pasted between local and non-local branches — `src/http/server.ts:47-161`
      The fix for the iteration-1 `redisClient` scoping bug was implemented by moving the entire non-local app-assembly inside the `else` block and duplicating it for the local path. ~40 lines of verbatim duplication (`SessionManager` construction, `express()` + `express.json()` + `httpLogger` middleware, `authMiddleware` capture, three route registrations, eviction timer start, return statement). Outer-scope `let` declarations for `verifier`/`requiredScopes`/etc. are now misleading — never consumed by the non-local path because that branch returns early. **The diff grew from ~110 lines to ~220 to fix a one-line scoping bug.**
      Recommendation: keep the `if`/`else` tight around startup probes and auth wiring (where the paths genuinely differ); assemble the Express app once after the branch. Use `if (provider) app.use(mcpAuthRouter({...}))` as a single conditional for the only non-local-specific mount.

- [x] should-fix — `redisClient!` non-null assertions still in `build.ts:40-41` — `src/http/auth/build.ts`
      Was a nit in iter 1, still unresolved at iter 2. The implementation signature is `redisClient?: RedisClientType` so TypeScript still demands the `!` despite the overloads. Recommendation: add `if (!redisClient) throw new Error(...)` at top of non-local branch — converts a type assertion into a fail-loud runtime guard.

- [x] should-fix — Second `createLogger` call in `main` — `src/http/server.ts:218`
      Was a nit in iter 1, still unresolved at iter 2. Two pino instances at startup. Will be subsumed by the `createApp` refactor — have `createApp` return `{ app, sessionManager, settings, logger }`.

- [x] nit — `test_pino_http_request_produces_valid_json_log` uses `setTimeout(resolve, 20)` to flush pino — `src/__tests__/http/logging.test.ts:97-99`
      Timing-based assertion. Latent CI flake. Recommendation: use synchronous pino destination or drain via `dest.once('finish', resolve)`.

## security-reviewer Review (iteration 2)
**Result:** WARNINGS

### Findings

- [x] should-fix — `ENTRA_CLIENT_SECRET` still required but never consumed (3-way contradiction with ADR) — `src/http/settings.ts:33, 70`, `src/http/auth/build.ts:30`
      ADR-0002 explicitly states the secret is NOT required. Settings.ts requires it. `buildAuth` never references it. Documentation-only resolution from iter 2 is insufficient — the runtime contradiction remains and the secret is unnecessarily enlarged in the attack surface. The blocking test (`test_nonlocal_missing_entra_secret_throws_naming_field`) is part of the problem, not a frozen interface — it must be updated alongside the schema. Recommendation: remove from `BaseSettingsSchema`, from `NonLocalSettings`, from `superRefine`, from `.env.example`. Update AC-8 to reference a different field (e.g. `ENTRA_TENANT_ID`). Update settings.test.ts accordingly.

### Findings (new)

- [x] nit — `mcp-session-id` logged via `customProps` without `Array.isArray` guard — `src/http/logging.ts:28`
      pino-http middleware runs before the array guard in the MCP handler. A duplicate header would emit `sessionId: ["v1","v2"]` in the log. Benign but unexpected shape. Recommendation: normalise via `[req.headers["mcp-session-id"]].flat()[0]`.

## staff-reviewer Review (iteration 2)
**Result:** WARNINGS

### Findings (new)

- [x] should-fix — `ENTRA_CLIENT_SECRET` three-way contradiction between ADR-0002, `settings.ts`, and runtime
      Same finding as security-reviewer; tracked there.

- [x] should-fix — Duplicated Express app construction in `server.ts:54-160`
      Same finding as maintainability-reviewer's must-fix (`createApp` duplication); tracked there.

- [x] should-fix — Logger recreated in `main` after `createApp` — `src/http/server.ts:218`
      Same finding as maintainability-reviewer's should-fix; tracked there.

## test-quality-reviewer Review (iteration 2)
**Result:** FAILED

### Findings

- [x] must-fix — `server.test.ts` and `server-nonlocal.test.ts` still not committed
      **False positive at this stage.** The build agent was explicitly instructed by the mill at iteration 2 to NOT commit (`Do NOT commit. Leave all changes uncommitted so the mill's commit phase handles staging cleanly`). Files exist on disk, tests pass, and the commit skill picks them up after the mill completes. Not blocking.
      Resolved: marked as procedural false positive; the commit skill (post-mill) stages the files.

### Findings (new)

- [x] should-fix — AC-19 (serverInfo from package.json) has no test assertion — `src/__tests__/http/server.test.ts:110`
      `test_post_mcp_with_correct_bearer_returns_200` asserts only `res.status === 200` — does not verify `serverInfo.name` / `serverInfo.version` in the response body. No test in the suite exercises `SERVER_IDENTITY`'s read from `package.json`. Recommendation: add an assertion in `sessions.test.ts` that captures the `McpServer` constructor's arguments and verifies they match expected package.json values.

- [x] should-fix — `test_pino_http_request_produces_valid_json_log` uses overly broad `toBeDefined()` assertions — `src/__tests__/http/logging.test.ts:112-125`
      Should assert specific values for `method`, `url`, `statusCode` rather than just existence — ties the test to actual request fields.

- [x] nit — `server.test.ts` comment block has wrong AC references — `src/__tests__/http/server.test.ts:6-8`
      Still open from iter 1.

- [x] nit — `settings.test.ts` dynamic import without `vi.resetModules()` — `src/__tests__/http/settings.test.ts`
      Still open from iter 1.

## Summary (iteration 2)

Iteration 2 resolved 8 must-fix/should-fix items from iteration 1 successfully: `/readyz` Redis check is fixed, three startup-probe and isolation tests were added, `LOCAL_DEV_EXPIRES_AT` moved into the verifier, eslint config reverted, `timingSafeEqual`, redaction, JWKS URL centralization, `requireBearerAuth` capture, `serverUrl` extraction, orphaned-session guard, safe REDIS_URL log. The orphaned-session guard, DELETE /mcp integration test, session isolation test, and meaningful logging tests are all in place.

Three real items remain for iteration 3:

1. **`createApp` duplication (must-fix)** — the iteration-2 fix introduced ~40 lines of verbatim copy-paste between the local and non-local branches by moving entire app-assembly inside each branch. The correct fix is to keep the `if/else` tight around what genuinely differs (startup probes + auth wiring) and assemble Express once after.

2. **`ENTRA_CLIENT_SECRET` removal (should-fix)** — flagged by both security and staff reviewers as a real 3-way contradiction (ADR says no, code requires, runtime ignores). The blocking test from iteration 2 is part of the problem and should be updated alongside.

3. **Minor unresolved should-fixes**: `redisClient!` non-null guards, `createApp` returning logger, `customProps` array guard for sessionId, AC-19 assertion, Pino test specific values. Plus two old nits (AC comment refs, `vi.resetModules`).

Test coverage of the design intent is otherwise strong: all 19 ACs have tests or are explicitly verification-only, the JWKS startup probe pattern works in both directions (success → InvalidTokenError; network failure → TypeError propagates), and per-session isolation is verified.

---

## Iteration 3 — Fix Resolution Notes

**Finding #1 (must-fix): `createApp` duplication**
Resolved: `if/else` now covers only startup probes and auth wiring; Express app assembled once after the branch. Outer-scope `let` declarations (`redisClient`, `verifier`, `requiredScopes`, `resourceMetadataUrl`, `provider`) assigned inside branches, consumed after. `createApp` returns `{ app, sessionManager, settings, logger }`. `main()` destructures `logger` from return value — second `createLogger` call removed.

**Finding #2 (should-fix): Remove `ENTRA_CLIENT_SECRET`**
Resolved: Removed `ENTRA_CLIENT_SECRET: z.string().optional()` from `BaseSettingsSchema`, removed from `superRefine` nonLocalRequired list, removed from `NonLocalSettings` type. Removed from `.env.example`. Updated `settings.test.ts` (exempted modification): test renamed to `test_nonlocal_missing_entra_tenant_id_throws_naming_field`, now asserts `ENTRA_TENANT_ID` is required. Removed stub from `server-nonlocal.test.ts`. Removed from `build.test.ts` fixture. Updated `requirements.md` FR-3 and AC-8. Updated ADR-0002 Consequences.

**Finding #3 (should-fix): `redisClient!` non-null assertions**
Resolved: Added `if (!redisClient) throw new Error("redisClient is required in non-local mode")` at top of non-local branch in `buildAuth`. Both `!` assertions removed.

**Finding #4 (should-fix): `mcp-session-id` customProps array guard**
Resolved: Changed to `([req.headers["mcp-session-id"]].flat()[0]) ?? undefined` with a one-line comment explaining the duplicate-header edge case.

**Finding #5 (should-fix): AC-19 test assertion**
Resolved: Added `test_mcp_server_constructed_with_package_identity` to `sessions.test.ts`. Updated `McpServer` mock to capture constructor args. Test reads `package.json` via `readFileSync` and asserts the `SessionManager`'s `serverIdentity` is passed through to `McpServer`.

**Finding #6 (should-fix): Logging test weak assertions**
Resolved (exempted modification): Replaced `toBeDefined()` with `toBe("GET")`, `toBe("/test")`, `toBe(200)`. Replaced `setTimeout(resolve, 20)` with `dest.once("finish", resolve)` + `dest.end()` for synchronous stream drain.

**Finding #7 (nit): `server.test.ts` wrong AC refs**
Resolved: Corrected comment block: Example 1 → AC-5/AC-19; Example 2 → AC-4; Example 3 → AC-4.

**Finding #8 (nit): `settings.test.ts` `vi.resetModules()`**
Resolved: Added `beforeEach(() => { vi.resetModules(); })` to `settings.test.ts`.

---

## Reviewer Selection (iteration 3 — FINAL PASS, $IS_FINAL=true)

Ran:     dependency-reviewer (final-only trigger), documentation-reviewer (final-only trigger), maintainability-reviewer, security-reviewer, staff-reviewer, test-quality-reviewer
Skipped: duplication-reviewer (`skip-when-clean`: 0 open findings from iter 2), performance-reviewer (`skip-when-clean`: 0 open findings since iter 1)

## dependency-reviewer Review (iteration 3 — final pass)
**Result:** FAILED

### Findings (newly-added deps in scope)

- [ ] should-fix — `pino` at `^9.14.0`, latest stable is `10.3.1` — `package.json`
      One major behind. v10.0.0 published 2025-10-03. No `maintenance` dist-tag for v9 — it's simply behind.
      Recommendation: upgrade `pino` to `^10` and `pino-http` to `^11` together (they're tightly coupled). Defer to a follow-up Dependabot pass if a same-day upgrade is out of scope.

- [ ] should-fix — `pino-http` at `^10.5.0`, latest stable is `11.0.0` — `package.json`
      One major behind. Tightly coupled to `pino`; upgrade together.

- [ ] should-fix — `redis` at `^4.7.1`, latest stable is `5.12.1` — `package.json`
      One major behind. node-redis tagged v4 explicitly as `maintenance-v4` and `latest` as v5 (published 2025-04-30). The reference.md librarian was explicitly pinned to v4 API; an upgrade to v5 would require revising `redis-clients-store.ts` and possibly the connection lifecycle.
      Recommendation: handle as a follow-up dependency upgrade (likely a separate feature/PR) since the API surface changed in v5.

- [x] nit — `openid-client` extraneous — `package.json`
      The dependency-reviewer flagged this as added by this feature, but it pre-existed in upstream `package.json` (it ships with `xero-mcp` upstream). Out of scope here.
      Resolved: confirmed pre-existing in upstream; not a feature-introduced dependency.

## documentation-reviewer Review (iteration 3 — final pass)
**Result:** FAILED

### Findings

- [ ] must-fix — ADR README index shows `Draft` for ADR-0002 and ADR-0003 — `.specs/adr/README.md:35-36`
      Both ADR files have `Status: Accepted` in their own frontmatter. The index table still shows `Draft`. Two sources of truth disagree.
      Recommendation: update lines 35–36 of `.specs/adr/README.md` to `Accepted`. Two-line change.

- [ ] must-fix — `design.md` Component 1 still lists `ENTRA_CLIENT_SECRET` as required, says "six fields" instead of five — `.specs/002-http-transport-and-oauth/backend/design.md:149, 155`
      Stale from iteration 3 removal.

- [ ] must-fix — `design.md` Example 17 references `ENTRA_CLIENT_SECRET` as the tested missing field — `.specs/002-http-transport-and-oauth/backend/design.md:615-617`
      Test now checks `ENTRA_TENANT_ID`.

- [ ] must-fix — `design.md` `.env.example` block still contains `ENTRA_CLIENT_SECRET` — `.specs/002-http-transport-and-oauth/backend/design.md:394`

- [ ] must-fix — `requirements.md` FR-22 still lists `ENTRA_CLIENT_SECRET` in the required `.env.example` vars — `.specs/002-http-transport-and-oauth/backend/requirements.md:120`

- [ ] must-fix — `REPO.md` HTTP-mode env vars list includes `ENTRA_CLIENT_SECRET` — `.specs/REPO.md:138`

- [ ] should-fix — `requirements.md` FR-6 says JWKS is "lazy-cached at module level" — `.specs/002-http-transport-and-oauth/backend/requirements.md:60`
      Implementation uses a private instance field on `EntraVerifier`. design.md is correct; FR-6 wording is stale.

- [ ] should-fix — `requirements.md` documentation checklist items still `[ ]` — `.specs/002-http-transport-and-oauth/backend/requirements.md:225-228`
      ADRs are Accepted, `.env.example` has the OSB section, REPO.md is updated, PRD.md §7 lists the feature. The 4 checklist items should be `[x]`.

- [ ] should-fix — `todo.md` Task 1.3 and Task 3.4 acceptance criteria still reference `ENTRA_CLIENT_SECRET` — `.specs/002-http-transport-and-oauth/backend/todo.md:43, 153`

- [ ] should-fix — `design.md` Component 9 startup step 9 error message template uses `${settings.REDIS_URL}` not `safeRedisUrl(...)` — `.specs/002-http-transport-and-oauth/backend/design.md:332`
      Implementation strips credentials via `safeRedisUrl`; observable behaviour (the `"Redis unreachable"` prefix) still matches AC-6.

## maintainability-reviewer Review (iteration 3 — final pass)
**Result:** WARNINGS

### Findings

- [x] should-fix — `redisClient!` non-null assertions in `build.ts:40-41`
      Resolved (iter 3): `if (!redisClient) throw new Error(...)` guard added; both `!` assertions removed.

- [x] should-fix — Second `createLogger` in `main`
      Resolved (iter 3): `createApp` returns `{ app, sessionManager, settings, logger }`; `main` destructures and reuses.

- [x] nit — `setTimeout(resolve, 20)` to flush pino in logging test
      Resolved (iter 3): replaced with `dest.once("finish", resolve)` + `dest.end()`.

- [x] must-fix — `createApp` ballooned 110→220 lines, copy-pasted between branches
      Resolved (iter 3): refactored to ~95 lines. `if/else` covers only startup probes + auth wiring; Express app assembled once after. `createApp` returns `{ app, sessionManager, settings, logger }`.

### Findings (new — introduced by iter-3 refactor)

- [ ] should-fix — `verifier!` non-null assertion reintroduced at `server.ts:127` — `src/http/server.ts:127`
      Same class of problem fixed in `build.ts` in iter 2, re-introduced as a side-effect of outer-scope hoisting. TypeScript's definite-assignment doesn't trace through try/catch, forcing `verifier!`.
      Recommendation: declare `let verifier: OAuthTokenVerifier | undefined`, then add `if (!verifier) throw new Error("verifier not initialised — programming error")` immediately before line 127. Same fail-loud pattern now used in `build.ts`.

- [ ] nit — `if (provider)` block re-narrows `settings as NonLocalSettings` a second time — `src/http/server.ts:109-110`
      The cast was already performed inside the `else` branch. `serverUrl` is reconstructed redundantly.
      Recommendation: hoist `let serverUrl: URL | undefined` alongside the other outer-scope declarations; consume in the `if (provider)` block.

## security-reviewer Review (iteration 3 — final pass)
**Result:** WARNINGS

### Findings

- [x] should-fix — `ENTRA_CLIENT_SECRET` required but never consumed
      Resolved (iter 3): fully removed from settings.ts, NonLocalSettings, .env.example, tests, requirements.md, ADR-0002. (Note: still some doc references — see documentation-reviewer findings.)

- [x] nit — `mcp-session-id` customProps log emits raw `string[]` on duplicate header
      Resolved (iter 3): `[req.headers["mcp-session-id"]].flat()[0]` normalisation added.

### Findings (new)

- [ ] nit — Stale `ENTRA_CLIENT_SECRET` reference in `REPO.md:138`
      Already tracked by documentation-reviewer. Same recommendation.

- [ ] nit — `verifier!` at `server.ts:127`
      Same as maintainability-reviewer. Same recommendation.

## staff-reviewer Review (iteration 3 — final pass)
**Result:** MUST_FIX

### Findings

- [x] should-fix — `ENTRA_CLIENT_SECRET` three-way contradiction
      Resolved (iter 3) by full removal across source. (Doc references remain — see documentation-reviewer.)

- [x] should-fix — Duplicated Express app construction in server.ts
      Resolved (iter 3) by the createApp refactor.

- [x] should-fix — Logger recreated in main
      Resolved (iter 3) by createApp return shape.

### Findings (new)

- [ ] must-fix — ADR index shows `Draft` for both ADRs — `.specs/adr/README.md:35-36`
      Same finding as documentation-reviewer's first must-fix. Two sources of truth disagree about ADR status.

- [ ] should-fix — `design.md` stale `ENTRA_CLIENT_SECRET` references
      Same as documentation-reviewer's findings on design.md.

## test-quality-reviewer Review (iteration 3 — final pass)
**Result:** PASSED

All iteration-2 findings verified resolved (AC-19 test added, Pino test assertions strengthened, AC comment refs corrected, `vi.resetModules` added, `setTimeout` replaced with stream drain).

No new findings. 11 test files, 65 tests, 0 weakened, 0 removed without justification, 0 assertion regressions. Coverage: 22/24 examples have direct tests (the other 2 are build/git verification); 17/19 ACs have direct tests (the other 2 are verification-only). The single test rename (`test_nonlocal_missing_entra_secret_*` → `test_nonlocal_missing_entra_tenant_id_*`) is justified by the `ENTRA_CLIENT_SECRET` removal and documented.

### Findings
None.

## Summary (iteration 3 — final pass)

The implementation is functionally complete and tests pass. The iteration-3 refactor of `createApp` succeeded — code is down from ~220 to ~95 lines, `if/else` is tight around what genuinely differs, Express is assembled once, logger is reused. All five iteration-2 maintainability/security findings closed cleanly. test-quality returns PASSED with no findings.

What remains is **documentation drift from the iteration-3 `ENTRA_CLIENT_SECRET` removal** and a couple of minor code-quality items the refactor introduced.

**Genuine remaining must-fix items (8):**
- ADR index `Draft` → `Accepted` (1 finding, 2 lines)
- `ENTRA_CLIENT_SECRET` references in `design.md` (3 places), `requirements.md` FR-22, `REPO.md` (1), `todo.md` Tasks 1.3 and 3.4 — all stale; field was removed but documentation wasn't fully updated

These are low-effort spec cleanups (~30 min of work). The code is correct; the docs lag.

**Should-fix items worth addressing (7):**
- `verifier!` non-null assertion at `server.ts:127` — apply the same fail-loud pattern as `build.ts`
- `if (provider)` block redundant cast/new-URL — hoist `serverUrl`
- 3 dependency major upgrades (`pino` 9→10, `pino-http` 10→11, `redis` 4→5) — defer to Dependabot/follow-up; redis v5 requires API revisions
- `requirements.md` FR-6 stale wording (JWKS caching location)
- `requirements.md` 4 unticked checklist items
- `design.md` `safeRedisUrl` not in error template

**Mill exit:** iteration 3 = MAX_ITERATIONS. Per mill rules, the loop terminates regardless of status. The 8 must-fix items are documentation-only and don't block merging the code, but should be cleaned up before the commit skill runs to avoid stale specs landing in the merged history.

---

## Post-final-pass cleanup (orchestrator, 2026-05-26)

The mill loop terminated at iteration 3 (MAX). The final pass surfaced documentation drift from the iteration-3 `ENTRA_CLIENT_SECRET` removal plus two small code-quality items. Because these were low-effort and the code was already correct, the orchestrator applied them directly rather than spending another build iteration:

**Resolved:**
- [x] ADR index `Draft` → `Accepted` for ADR-0002 and ADR-0003 — `.specs/adr/README.md`
- [x] `design.md` Component 1: removed `ENTRA_CLIENT_SECRET` from required list, "six" → "five fields"
- [x] `design.md` Example 17: `ENTRA_CLIENT_SECRET` → `ENTRA_TENANT_ID`
- [x] `design.md` `.env.example` block: `ENTRA_CLIENT_SECRET=` line removed
- [x] `design.md` Component 9 step 9: error template now shows `safeRedisUrl(...)`
- [x] `requirements.md` FR-22: `ENTRA_CLIENT_SECRET` removed from var list
- [x] `requirements.md` FR-6: "lazy-cached at module level" → "private instance field on EntraVerifier"
- [x] `requirements.md` 4 documentation checklist items: `[ ]` → `[x]`
- [x] `REPO.md` line 138: `ENTRA_CLIENT_SECRET` removed from HTTP env var key-additions list
- [x] `todo.md` Task 1.3 + Task 3.4 acceptance criteria: `ENTRA_CLIENT_SECRET` → `ENTRA_TENANT_ID`
- [x] `server.ts:127` `verifier!` non-null assertion → explicit `if (!verifier) throw` fail-loud guard (matches `build.ts` precedent)
- [x] `server.ts` `if (provider)` block: hoisted `serverUrl` to outer scope; removed redundant `settings as NonLocalSettings` re-cast and duplicate `new URL(...)`; guard is now `if (provider && serverUrl)`

Re-verified after cleanup: `npm run build` clean, `npm run lint` clean, 65 tests pass, `git diff main -- src/ ':!src/http' ':!src/__tests__/http'` empty.

**Deferred to follow-up (dependency upgrades — out of scope for this feature):**
- [ ] `pino` ^9 → ^10 (major)
- [ ] `pino-http` ^10 → ^11 (major; upgrade together with pino)
- [ ] `redis` ^4 → ^5 (major; v5 changed the API surface — `redis-clients-store.ts` and the connection lifecycle would need revision, and `reference.md` was pinned to v4. Best handled as a dedicated dependency-upgrade PR.)

These three are pre-existing-style version-currency items, not defects in the feature. node-redis v4 is on an active `maintenance-v4` dist-tag and fully functional. Recommend a separate Dependabot/upgrade pass.
