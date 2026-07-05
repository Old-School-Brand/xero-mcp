# Todo: OAuth-Proxy Bridge for Entra (MCP HTTP auth)
**Layer:** backend
**Status:** In Progress
**Last updated:** 2026-07-05

## Implementation Tasks

Tasks are ordered. Do not start a task until its dependencies are complete. Testing mode is
**full-tdd** — each implementation task's failing test(s) are written first (see `Examples:`),
then made to pass in the same task. No separate "write tests" tasks exist for new code; Phase 3
is integration verification, not test authoring.

### Phase 1: Redis code/txn store (new, isolated, no dependents yet)

- [x] **Task 1.1** — `RedisOAuthCodeStore`: transaction round-trip (set/get/delete)
  - Completed: 2026-07-05
  - Tests: `src/__tests__/http/auth/redis-code-store.test.ts`
  - File(s): `src/http/auth/redis-code-store.ts` (new), `src/__tests__/http/auth/redis-code-store.test.ts` (new)
  - What to do: Define `RedisCodeInterface` (`get`, `set` with `{ EX?: number }` options, `del`,
    and `getDel` — node-redis `GETDEL`), `OAuthTransaction` (no `scopes` field) and `OAuthServerCode`
    types per design.md Data Model, and a `type NamespaceRecord = { txn: OAuthTransaction; code:
    OAuthServerCode }` mapping. Implement `RedisOAuthCodeStore` with **generic namespaced methods
    keyed on the namespace** (not per-record trios), so a wrong namespace/type pairing or a typo'd
    namespace fails to compile (make illegal states unrepresentable): `set<K extends keyof
    NamespaceRecord>(namespace: K, id, value: NamespaceRecord[K], ttlSeconds)`
    (`SET oauth:<namespace>:<id>` JSON with `EX`), `get<K extends keyof NamespaceRecord>(namespace:
    K, id)` (`GET` + `JSON.parse`, returns `NamespaceRecord[K] | undefined`), `del(namespace: keyof
    NamespaceRecord, id)` (`DEL`). Call sites use inference — `codeStore.get("txn", id)`, NO explicit
    type argument. Key format `oauth:<namespace>:<id>`; JSON (de)serialisation and key-building live
    in one place. Mirror `RedisOAuthClientsStore`'s constructor-injected narrow-interface pattern
    (`redis-clients-store.ts`) — no SDK interface to implement here, just a plain class. Write the
    test first: an in-memory `Map`-backed fake implementing `RedisCodeInterface` (same style as
    `redis-clients-store.test.ts`'s `makeRedisFake`), verifying `set("txn", id, rec, 600)` +
    `get("txn", id)` round-trips the record and calls `redis.set` with key `oauth:txn:<id>` and
    `{ EX: 600 }`, and `del("txn", id)` then `get("txn", id)` returns `undefined`.
  - Acceptance: Given a txn record and a fake Redis store, when `set` then `get` are called for
    namespace `"txn"`, then the exact record round-trips under key `oauth:txn:<id>`; when `del` runs
    then `get`, then it returns `undefined`. `npx vitest run src/__tests__/http/auth/redis-code-store.test.ts` green.
  - Depends on: (none)

- [x] **Task 1.2** — `RedisOAuthCodeStore`: server-code round-trip + atomic single-use (`getAndDelete`)
  - Completed: 2026-07-05
  - Tests: `src/__tests__/http/auth/redis-code-store.test.ts`
  - File(s): `src/http/auth/redis-code-store.ts`, `src/__tests__/http/auth/redis-code-store.test.ts`
  - What to do: Add `getAndDelete<T>(namespace, id)` — a single atomic Redis `GETDEL`
    (`this.redis.getDel(oauth:<namespace>:<id>)`), `JSON.parse`, `undefined` if `null`. This is the
    single-use consumption primitive Task 2.4 relies on (read+delete in ONE Redis command, so a
    concurrent replay cannot also read the record — AC 4). Extend the `Map` fake with a `getDel`
    that returns then deletes in one call. Write the test first: `set("code", c, rec, 60)` then
    `getAndDelete("code", c)` returns the record; a second `getAndDelete("code", c)` returns
    `undefined` (already consumed).
  - Acceptance: Given a server-code record, when `set` then `getAndDelete` for namespace `"code"`,
    then it round-trips once with key `oauth:code:<code>` and is removed; when `getAndDelete` is
    called again, then `undefined` (single-use holds).
  - Depends on: Task 1.1
  - Examples: Example 4 (store half), Example 5 (store half — TTL expiry is a Redis-native
    behaviour, verified here only as "missing key returns undefined")

### Phase 2: `EntraBridgeProvider` (new class, depends on Phase 1)

- [x] **Task 2.1** — `authorize()` stores a transaction and redirects to Entra with server PKCE
  - Completed: 2026-07-05
  - Tests: `src/__tests__/http/auth/bridge-provider.test.ts`
  - File(s): `src/http/auth/bridge-provider.ts` (new), `src/__tests__/http/auth/bridge-provider.test.ts` (new)
  - What to do: Create `EntraBridgeProvider extends ProxyOAuthServerProvider`. Constructor takes
    `(options: ProxyOptions, codeStore: RedisOAuthCodeStore, entraConfig: { clientId: string;
    clientSecret: string; callbackUrl: string; scope: string })`; calls `super(options)`; sets
    `this.skipLocalPkceValidation = false`. Override `authorize(client, params, res)`: generate
    `txnId = randomBytes(32).toString("base64url")`, generate `serverVerifier =
    randomBytes(32).toString("base64url")` and `serverChallenge = createHash("sha256")
    .update(serverVerifier).digest("base64url")`, call `codeStore.set("txn", txnId,
    { clientRedirectUri: params.redirectUri, clientState: params.state ?? "", clientCodeChallenge:
    params.codeChallenge, serverCodeVerifier: serverVerifier }, 600)` (no `scopes` field — the
    upstream scope is always the fixed `entraConfig.scope`), build the Entra
    authorize URL with `client_id=entraConfig.clientId`, `redirect_uri=entraConfig.callbackUrl`,
    `state=txnId`, `code_challenge=serverChallenge`, `code_challenge_method=S256`,
    `scope=entraConfig.scope`, `response_type=code` (no `resource`), then `res.redirect(url)`.
    Write the test first (mock `codeStore` with `vi.fn()`s; `res = { redirect: vi.fn() }`): assert
    `codeStore.set` is called with namespace `"txn"`, the txn id, the client's
    redirect/state/challenge and a 43-char base64url `serverCodeVerifier` (and TTL 600), and
    `res.redirect` is called with a URL whose `client_id` is the Entra
    id (not the DCR id), `redirect_uri` is the server callback, `state` is the generated `txnId`
    (not the client's state), `code_challenge` is present, `code_challenge_method=S256`, and
    `scope` is the fully-qualified scope.
  - Acceptance: Given a DCR client's `authorize` params, when `authorize()` runs, then Redis
    receives the transaction under a random `txn_id` and the browser is redirected to Entra with
    `state=txn_id` (not the client's state) and the server's own PKCE challenge.
  - Depends on: Task 1.1, Task 1.2
  - Examples: Example 1

- [x] **Task 2.2** — `authorize()` never forwards the RFC 8707 `resource` parameter
  - Completed: 2026-07-05
  - Tests: `src/__tests__/http/auth/bridge-provider.test.ts`
  - File(s): `src/http/auth/bridge-provider.ts`, `src/__tests__/http/auth/bridge-provider.test.ts`
  - What to do: No production change expected (Task 2.1's URL construction already omits
    `resource` since it is never read from `params`) — add the regression test to lock this in
    since Entra v2.0 (AC 3, FR-1) rejects a `resource` query param.
  - Acceptance: Given `authorize()` called with `params.resource` set, when the redirect URL is
    inspected, then it contains no `resource` query parameter.
  - Depends on: Task 2.1
  - Examples: Example 2

- [x] **Task 2.3** — `challengeForAuthorizationCode()` returns the stored client PKCE challenge
  - Completed: 2026-07-05
  - Tests: `src/__tests__/http/auth/bridge-provider.test.ts`
  - File(s): `src/http/auth/bridge-provider.ts`, `src/__tests__/http/auth/bridge-provider.test.ts`
  - What to do: Override `challengeForAuthorizationCode(_client, authorizationCode)`: call
    `codeStore.get("code", authorizationCode)` (inferred `OAuthServerCode | undefined`; peek only — do NOT delete; the SDK
    calls this before `exchangeAuthorizationCode`, which consumes the code); if found, return
    `record.clientCodeChallenge`; if not found, `throw new InvalidGrantError("...")` (import from
    `@modelcontextprotocol/sdk/server/auth/errors.js` — NOT `ServerError`, which maps to HTTP 500).
    Write the test first: mocked `codeStore.get` resolving to a record returns its
    `clientCodeChallenge`; mocked `codeStore.get` resolving to `undefined` causes the call to
    reject with `InvalidGrantError`.
  - Acceptance: Given a stored server-code record, when `challengeForAuthorizationCode` is
    called with its code, then the stored `clientCodeChallenge` is returned; given an
    unknown/expired code, then it throws `InvalidGrantError` (→ HTTP 400 `invalid_grant`).
  - Depends on: Task 1.2
  - Examples: Example 5, Example 6

- [x] **Task 2.4** — `exchangeAuthorizationCode()` returns stored tokens and deletes the code (single-use)
  - Completed: 2026-07-05
  - Tests: `src/__tests__/http/auth/bridge-provider.test.ts`
  - File(s): `src/http/auth/bridge-provider.ts`, `src/__tests__/http/auth/bridge-provider.test.ts`
  - What to do: Override `exchangeAuthorizationCode(client, authorizationCode)` (drop the SDK's
    `codeVerifier`/`redirectUri`/`resource` params — they are unused, per design.md): call
    `codeStore.getAndDelete("code", authorizationCode)` — a SINGLE atomic `GETDEL`,
    not a separate get+delete (so a concurrent replay cannot also read it); if not found (already
    consumed or expired), `throw new InvalidGrantError("...")`; otherwise return `record.tokens`.
    Write the test first: first call with a code present returns the stored tokens (fake's
    `getAndDelete` removes it); a second call with the same code (fake now resolves `undefined`)
    rejects with `InvalidGrantError`.
  - Acceptance: Given a server code exists, when `exchangeAuthorizationCode` is called once, then
    it returns the stored Entra tokens and the code is atomically consumed; when called again with
    the same code, then it throws `InvalidGrantError` (replay rejected → HTTP 400 `invalid_grant`).
  - Depends on: Task 2.3
  - Examples: Example 4

- [x] **Task 2.5** — `exchangeRefreshToken()` substitutes the Entra identity
  - Completed: 2026-07-05
  - Tests: `src/__tests__/http/auth/bridge-provider.test.ts`
  - File(s): `src/http/auth/bridge-provider.ts`, `src/__tests__/http/auth/bridge-provider.test.ts`
  - What to do: Override `exchangeRefreshToken(client, refreshToken)`: build an
    `entraClient = { ...client, client_id: entraConfig.clientId, client_secret:
    entraConfig.clientSecret }` and call `super.exchangeRefreshToken(entraClient, refreshToken,
    [entraConfig.scope])` (no `resource`). This is the same substitution pattern as the deleted
    `EntraProxyOAuthServerProvider.toEntraClient`, applied only here (not to `authorize`/
    `exchangeAuthorizationCode`, which use the bridge instead). **Intentional change:** the old
    provider also passed `this.entraResource` as the 4th (`resource`) arg — the bridge drops it
    (Entra v2.0 does not support RFC 8707; it was silently ignored before). Do NOT re-add it.
    Write the test first: spy on
    `ProxyOAuthServerProvider.prototype.exchangeRefreshToken` (or mock `fetch` and assert the
    POST body) to verify `client_id`/`client_secret`/`scope` are the Entra values and the DCR
    client's own id/secret never appear in the request.
  - Acceptance: Given a DCR client and its refresh token, when `exchangeRefreshToken` is called,
    then the upstream call carries `ENTRA_CLIENT_ID`/`ENTRA_CLIENT_SECRET`/the fully-qualified
    scope, and no `resource` parameter, and the DCR client's own `client_id`/`client_secret` are
    never sent to Entra.
  - Depends on: Task 2.1
  - Examples: Example 11

- [x] **Task 2.6** — LOC checkpoint for `bridge-provider.ts` + `redis-code-store.ts`
  - Completed: 2026-07-05
  - File(s): `src/http/auth/bridge-provider.ts`, `src/http/auth/redis-code-store.ts`
  - What to do: Eyeball non-import/non-type/non-comment/non-blank lines in both files and confirm
    the combined provider-class-body + store logic is within the ~70-90 line budget design.md
    allocates to these two files (`bridge-provider.ts` ~50-60, `redis-code-store.ts` ~20-30 — the
    generic 3+1 methods, not six trios). The callback handler (`callback-handler.ts`, ~30-40) is
    counted separately in Phase 3; the whole-feature AC-7 check (~100-120 total) is Task 5.1. If
    these two files are bloated, trim before proceeding — do not defer to Phase 4. Per the design's
    LOC-accounting note, the goal is "no bulk, no cleverness," not an exact integer.
  - Acceptance: Given the two files as they stand after Task 2.5, when non-test/non-doc lines
    are counted, then the combined total is ≤ ~90 lines (excluding imports, types, blank lines,
    comments).
  - Depends on: Task 2.5

### Phase 3: `GET /auth/callback` handler (depends on Phase 1, uses `EntraBridgeProvider`'s Entra config shape)

- [x] **Task 3.1** — Callback happy path: exchange upstream code, mint server code, redirect to client
  - Completed: 2026-07-05
  - Tests: `src/__tests__/http/auth/callback-handler.test.ts`
  - File(s): `src/http/auth/callback-handler.ts` (NEW — its own file, not `bridge-provider.ts`),
    `src/__tests__/http/auth/callback-handler.test.ts` (new)
  - What to do: Create a new file `src/http/auth/callback-handler.ts` exporting a factory
    `createCallbackHandler(codeStore, entraConfig): express.RequestHandler` (its own file per
    design.md Component Breakdown §3 — it's pure Express glue with no provider-internal access, and
    a separate source file lets `callback-handler.test.ts` mirror it 1:1 per `.specs/REPO.md`).
    Handler: read `code`, `state`, `error`, `error_description` from `req.query`; on the happy path,
    `codeStore.get("txn", state)`, `POST` to Entra's token endpoint (`fetch`) with
    `grant_type=authorization_code`, `code`, `client_id`, `client_secret`,
    `code_verifier=txn.serverCodeVerifier`, `redirect_uri=entraConfig.callbackUrl`; parse the
    response with `OAuthTokensSchema.parse()`; `codeStore.del("txn", state)`; mint
    `serverCode = randomBytes(32).toString("base64url")`; `codeStore.set("code",
    serverCode, { clientCodeChallenge: txn.clientCodeChallenge, clientRedirectUri:
    txn.clientRedirectUri, tokens }, 60)`; build the redirect with the WHATWG URL API — **never
    string concatenation**: `const redirect = new URL(txn.clientRedirectUri);
    redirect.searchParams.set("code", serverCode); redirect.searchParams.set("state",
    txn.clientState); res.redirect(302, redirect.toString());`. Write the test first (mock
    `codeStore`, mock global `fetch` per `entra-proxy-provider.test.ts`'s `FetchLike` pattern,
    `res = { redirect: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn() }`): assert the POST
    body's fields, the `del("txn", state)` call, the `set("code", ...)` call, and the final
    `res.redirect` URL/query. Add a second test (Example 3b): `clientRedirectUri` with an existing
    `?foo=bar` query and a `clientState` containing `&`/`=` → assert the pre-existing param is
    preserved (single `?`) and the state is percent-encoded.
  - Acceptance: Given a stored transaction and a successful upstream token exchange, when
    `GET /auth/callback?code=...&state=<txn_id>` is handled, then Entra's token endpoint is
    called with the server's PKCE verifier and confidential credentials, the transaction is
    deleted, a server code is stored with the client's challenge+redirect+tokens, and the browser
    is redirected (URL built via `new URL`) to the client's original `redirect_uri` with the new
    code and the client's original `state` — preserving any existing query string and encoding
    special characters.
  - Depends on: Task 1.1, Task 1.2
  - Examples: Example 3, Example 3b

- [x] **Task 3.2** — Callback error path: Entra `error` param returns 502, no redirect
  - Completed: 2026-07-05
  - Tests: `src/__tests__/http/auth/callback-handler.test.ts`
  - File(s): `src/http/auth/callback-handler.ts`, `src/__tests__/http/auth/callback-handler.test.ts`
  - What to do: At the top of the handler, if `req.query.error` is present, respond
    `res.status(502).json({ error: "upstream_error", error_description: req.query.error_description
    ?? req.query.error })` and return — before any Redis or fetch call.
  - Acceptance: Given `GET /auth/callback?error=access_denied&error_description=User+cancelled&state=txn-999`,
    when handled, then the response is `502` with `{ error: "upstream_error", error_description:
    "User cancelled" }` and `res.redirect` is never called.
  - Depends on: Task 3.1
  - Examples: Example 7

- [x] **Task 3.3** — Callback error path: missing `state` returns 400
  - Completed: 2026-07-05
  - Tests: `src/__tests__/http/auth/callback-handler.test.ts`
  - File(s): `src/http/auth/callback-handler.ts`, `src/__tests__/http/auth/callback-handler.test.ts`
  - What to do: After the `error` check, if `req.query.state` is missing/not a string, respond
    `res.status(400).json({ error: "invalid_request", error_description: "Missing state parameter" })`
    and return.
  - Acceptance: Given `GET /auth/callback?code=some-code` (no `state`), when handled, then the
    response is `400` with `{ error: "invalid_request", error_description: "Missing state parameter" }`.
  - Depends on: Task 3.2
  - Examples: Example 8

- [x] **Task 3.4** — Callback error path: unknown/expired `txn_id` returns 400
  - Completed: 2026-07-05
  - Tests: `src/__tests__/http/auth/callback-handler.test.ts`
  - File(s): `src/http/auth/callback-handler.ts`, `src/__tests__/http/auth/callback-handler.test.ts`
  - What to do: After loading `codeStore.get("txn", state)`, if `undefined`,
    respond `res.status(400).json({ error: "invalid_request", error_description: "Authorization
    transaction expired or not found" })` and return — before calling `fetch`.
  - Acceptance: Given Redis has no `oauth:txn:expired-txn`, when
    `GET /auth/callback?code=some-code&state=expired-txn` is handled, then the response is `400`
    with the "expired or not found" body.
  - Depends on: Task 3.3
  - Examples: Example 9

- [x] **Task 3.5** — Callback error path: upstream token exchange failure returns 502, txn preserved
  - Completed: 2026-07-05
  - Tests: `src/__tests__/http/auth/callback-handler.test.ts`
  - File(s): `src/http/auth/callback-handler.ts`, `src/__tests__/http/auth/callback-handler.test.ts`
  - What to do: If the Entra token POST is non-`ok` or `OAuthTokensSchema.parse()` throws, respond
    `res.status(502).json({ error: "upstream_error", error_description: "Upstream token exchange
    failed" })` and return — without calling `codeStore.del("txn", ...)` (per design.md's Example
    10: preserves retry option).
  - Acceptance: Given a valid transaction and a fetch to Entra's token endpoint returning HTTP
    400, when the callback is handled, then the response is `502` with "Upstream token exchange
    failed" and the transaction delete (`codeStore.del("txn", ...)`) is not called.
  - Depends on: Task 3.4
  - Examples: Example 10

- [x] **Task 3.6** — No sensitive data in callback logs or error bodies (AC 8)
  - Completed: 2026-07-05
  - Tests: `src/__tests__/http/auth/callback-handler.test.ts`
  - File(s): `src/http/auth/callback-handler.ts`, `src/__tests__/http/auth/callback-handler.test.ts`
  - What to do: Add a `warn`-level `pino` log call (reuse the logger passed into
    `createCallbackHandler`, or accept one as a parameter per design.md's Error Handling section)
    on each error path, logging only `{ txnId: state }` plus the error code — never the Entra
    code, tokens, `client_secret`, or PKCE verifier. Write the test first: for each error path
    (missing state, unknown txn, Entra error, upstream failure), assert the JSON error body and
    any log call arguments contain none of `serverCodeVerifier`, `client_secret`, `access_token`,
    `refresh_token`, or the raw Entra `code`.
  - Acceptance: Given each callback error path, when triggered, then neither the HTTP response
    body nor any log call includes a token, secret, or PKCE verifier value.
  - Depends on: Task 3.5
  - Examples: (AC 8 — security property, no single design.md Example numbers this; covers FR-7's "no silent success" alongside Examples 7-10)

### Phase 4: Wire the bridge into `buildAuth()` and `settings.ts` (depends on Phase 2 + Phase 3)

- [x] **Task 4.1** — `settings.ts`: `ENTRA_CLIENT_SECRET` becomes required in non-local mode
  - Completed: 2026-07-05
  - Tests: `src/__tests__/http/settings.test.ts`
  - File(s): `src/http/settings.ts`, `src/__tests__/http/settings.test.ts`
  - What to do: Add `"ENTRA_CLIENT_SECRET"` to the `nonLocalRequired` array inside `superRefine`.
    Remove the `// Optional (guard): ...` comment above `ENTRA_CLIENT_SECRET` in the Zod schema
    (it stays `z.string().optional()` at the base-schema level since the discriminated
    `superRefine` enforces presence per-branch, matching the existing pattern for
    `ENTRA_TENANT_ID` etc.). Change `NonLocalSettings.ENTRA_CLIENT_SECRET` from `string | undefined`
    to `string`. Write the test first: extend `settings.test.ts`'s
    `test_nonlocal_missing_entra_tenant_id_throws_naming_field`-style test with a new case that
    stubs all non-local fields except `ENTRA_CLIENT_SECRET` and asserts the `ZodError` paths
    contain `"ENTRA_CLIENT_SECRET"`.
  - Acceptance: Given `ENVIRONMENT=development` and every non-local var set except
    `ENTRA_CLIENT_SECRET`, when `loadSettings()` is called, then it throws `ZodError` naming
    `ENTRA_CLIENT_SECRET`.
  - Depends on: (none — independent of Phase 1-3, but sequenced here since `buildAuth` in Task 4.2
    consumes the now-required field)
  - Examples: Example 12

- [x] **Task 4.2** — `buildAuth()`: delete `EntraProxyOAuthServerProvider`, instantiate `EntraBridgeProvider`
  - Completed: 2026-07-05
  - Tests: `src/__tests__/http/auth/build.test.ts`
  - File(s): `src/http/auth/build.ts`, `src/__tests__/http/auth/build.test.ts`
  - What to do: Delete the `EntraProxyOAuthServerProvider` class and its `toEntraClient` method
    entirely (superseded — AC 6). Import `EntraBridgeProvider` from `./bridge-provider.js`,
    `createCallbackHandler` from `./callback-handler.js`, `RedisOAuthCodeStore` from
    `./redis-code-store.js`. In the non-local branch: instantiate `RedisOAuthCodeStore` binding
    `get`/`set`/`del`/`getDel` from `redisClient` (node-redis exposes `getDel`);
    instantiate `EntraBridgeProvider` with the code store and
    `{ clientId: ENTRA_CLIENT_ID, clientSecret: ENTRA_CLIENT_SECRET, callbackUrl:
    \`${MCP_SERVER_URL}/auth/callback\`, scope: \`api://${ENTRA_CLIENT_ID}/${requiredScopes[0] ??
    "mcp"}\` }`; keep the existing `Object.defineProperty(provider, "clientsStore", { value: store })`
    override; build `callbackHandler = createCallbackHandler(codeStore, entraConfig)`; return
    `{ provider, verifier, requiredScopes, callbackHandler }`. Update the non-local overload's
    return type to include `callbackHandler: express.RequestHandler`. Update `build.test.ts`'s
    mocks (`vi.mock` for `@modelcontextprotocol/sdk/.../proxyProvider.js` stays; the test no
    longer needs `EntraProxyOAuthServerProvider`-specific assertions) and add an assertion that
    `result.callbackHandler` is a function when `"provider" in result`.
  - Acceptance: Given non-local settings with `ENTRA_CLIENT_SECRET` set, when `buildAuth()` is
    called, then it returns a `provider` that is an `EntraBridgeProvider` instance and a
    `callbackHandler` function; `EntraProxyOAuthServerProvider` no longer exists anywhere in the
    file (`grep -c EntraProxyOAuthServerProvider src/http/auth/build.ts` → `0`).
  - Depends on: Task 2.6, Task 3.6, Task 4.1

- [x] **Task 4.3** — Delete the superseded `entra-proxy-provider.test.ts`
  - Completed: 2026-07-05
  - File(s): `src/__tests__/http/auth/entra-proxy-provider.test.ts` (delete)
  - What to do: Remove this file. Its five test cases (identity/scope/resource rewrite,
    per-client-secret guard) test behaviour that no longer exists on `EntraBridgeProvider`
    (uniform confidential flow, no guard, no scope/resource rewrite on `authorize`/
    `exchangeAuthorizationCode`) and is superseded by `bridge-provider.test.ts` (Tasks 2.1-2.5).
  - Acceptance: Given the test suite, when `npx vitest run src/__tests__/http/auth/` runs, then
    `entra-proxy-provider.test.ts` no longer exists and no test references
    `EntraProxyOAuthServerProvider`. `git grep -c EntraProxyOAuthServerProvider` across `src/`
    returns `0`.
  - Depends on: Task 4.2
  - Examples: Example 13

- [x] **Task 4.4** — `server.ts`: mount `GET /auth/callback` in the non-local branch
  - Completed: 2026-07-05
  - Tests: `src/__tests__/http/server-nonlocal.test.ts`
  - File(s): `src/http/server.ts`, `src/__tests__/http/server-nonlocal.test.ts`
  - What to do: In `createApp()`'s non-local branch, capture `callbackHandler` from the `buildAuth`
    return value alongside `provider`/`verifier`/`requiredScopes`. In the
    `if (provider && serverUrl)` block, after `app.use(mcpAuthRouter(...))`, add
    `app.get("/auth/callback", callbackHandler)`. Update `server-nonlocal.test.ts`'s mocked
    `buildAuth` return value (it currently omits `callbackHandler`, which would make `app.get`
    receive `undefined` as a handler and crash) to include `callbackHandler: vi.fn((_req, res) =>
    res.redirect(302, "https://client.example/callback"))` or similar, and add an assertion (or a
    new small test) that `GET /auth/callback` is routed to it (e.g. via `supertest`, asserting the
    mock was invoked or the response is a redirect rather than a 404).
  - Acceptance: Given the non-local branch wiring, when `GET /auth/callback` is requested against
    the app returned by `createApp()`, then the mounted `callbackHandler` runs (not a 404 from
    Express's default handler). `npx vitest run src/__tests__/http/server-nonlocal.test.ts` green.
  - Depends on: Task 4.2

### Phase 5: Integration & Verification

- [x] **Task 5.1** — Full suite regression + LOC budget final check (AC 7)
  - Completed: 2026-07-05
  - File(s): (verification only — no new files)
  - What to do: Run `npm run build`, `npm run lint`, `npm run test` (full suite, not just
    `src/__tests__/http/auth/`). Then count total non-test/non-doc implementation lines added
    across `src/http/auth/bridge-provider.ts`, `src/http/auth/redis-code-store.ts`, and
    `src/http/auth/callback-handler.ts` (each minus imports/types/blank/comments), the net-new diff
    to `src/http/auth/build.ts` (it's a replacement — count net new only), and the one new
    line/route in `src/http/server.ts`. Confirm the total is within the design's ~100-120 LOC
    accounting for AC 7 (`≤ ~100` with the tilde covering the callback handler's four
    security-required error branches). Per the design's LOC-accounting note, do NOT drop error
    handling, logging, or type safety to hit a smaller number; the check is "lean, no cleverness,"
    not an exact integer. If the code is genuinely bloated (dead code, needless indirection,
    duplication), trim it — flag rather than silently accept obvious bulk.
  - Acceptance: Given the finished feature, when `npm run build && npm run lint && npm run test`
    are run, then all pass with zero regressions in adjacent suites (`health.test.ts`,
    `sessions.test.ts`, `entra-verifier.test.ts`, `local-verifier.test.ts`,
    `redis-clients-store.test.ts`); and the counted core LOC is within ~100-120 with no obvious bulk.
  - Depends on: Task 4.4

- [x] **Task 5.2** — Security property spot-check across the full flow (AC 8)
  - Completed: 2026-07-05
  - File(s): (verification only — cross-references existing tests from Tasks 2.1-3.6)
  - What to do: Re-read `bridge-provider.test.ts` and `callback-handler.test.ts` end-to-end and
    confirm, as a checklist against AC 8, that the test suite as a whole (not any single test)
    demonstrates: (a) two independent PKCE pairs exist (client↔server via `clientCodeChallenge`,
    server↔Entra via `serverCodeVerifier`/`serverChallenge`) and are never cross-checked against
    each other; (b) server codes are single-use (Task 2.4, atomic `getAndDelete`) and TTL-bound
    (Task 1.2 `set("code", …)` TTL argument); (c) transactions are TTL-bound (Task 1.1
    `set("txn", …)` TTL argument) and the
    upstream `state` is always the `txn_id`, never the client's `state` (Task 2.1); (d) no test
    fixture or assertion anywhere in the new test files hardcodes an expectation that a token,
    `client_secret`, or PKCE verifier appears in a logged string or JSON response body (Task 3.6
    covers the negative assertions directly). If any property lacks coverage, add the missing
    assertion to the relevant existing test file rather than opening a new one.
  - Acceptance: Given the full `src/__tests__/http/auth/` suite, when reviewed against AC 8's five
    bullet points, then each has at least one asserting test; any gap is closed before this task
    is checked off.
  - Depends on: Task 5.1

### Phase 6: Docs & ADR

- [x] **Task 6.1** — `.env.example`: describe the required `ENTRA_CLIENT_SECRET` and `/auth/callback`
  - Completed: 2026-07-05
  - File(s): `.env.example`
  - What to do: Change the `ENTRA_CLIENT_SECRET` block from "Optional: ... Leave unset for the
    public/PKCE flow" to describe it as required in non-local mode (confidential upstream flow
    only, no public/PKCE option), uncomment the variable name (`ENTRA_CLIENT_SECRET=` not
    `# ENTRA_CLIENT_SECRET=`, consistent with other required non-local vars like
    `ENTRA_TENANT_ID=`). Add a comment near `MCP_SERVER_URL` noting that the Entra app
    registration must include `{MCP_SERVER_URL}/auth/callback` as a registered redirect URI (Web
    platform) and that per-client MCP redirect URIs are no longer registered in Entra.
  - Acceptance: Given `.env.example`, when read, then `ENTRA_CLIENT_SECRET` is presented as
    required (not optional) for non-local environments, and the `/auth/callback` redirect
    registration requirement is documented next to `MCP_SERVER_URL`.
  - Depends on: Task 4.2

- [x] **Task 6.2** — `.specs/REPO.md`: update the Auth (MCP HTTP) row to describe the bridge
  - Completed: 2026-07-05
  - File(s): `.specs/REPO.md`
  - What to do: In the Tech Stack table's `Auth (MCP HTTP)` row, replace "SDK's
    `ProxyOAuthServerProvider` / `mcpAuthRouter` / `requireBearerAuth`... See ADR-0002" with
    wording that names the OAuth-proxy bridge (`EntraBridgeProvider`, subclass of
    `ProxyOAuthServerProvider`) terminating the Entra flow at `{MCP_SERVER_URL}/auth/callback`,
    and reference both ADR-0002 (transport/local-auth decisions, still accepted) and ADR-0004
    (OAuth handshake model, supersedes ADR-0002 decision 2). Add `src/http/auth/bridge-provider.ts`
    and `src/http/auth/redis-code-store.ts` to the `Project Layout` tree under `auth/`, and remove
    `build.ts`'s no-longer-accurate implicit reference to the dumb-forward provider if any exists.
  - Acceptance: Given `.specs/REPO.md`, when read, then the Auth (MCP HTTP) row and Project Layout
    tree accurately name the bridge components and cite ADR-0004, and no longer describe a
    transparent forward-proxy to Entra.
  - Depends on: Task 4.2

- [ ] **Task 6.3** — Promote ADR-0004 from Draft to Accepted
  - File(s): `.specs/adr/0004-oauth-proxy-bridge.md`
  - What to do: Once the user confirms the implementation matches the recorded decision, change
    the `Status` field from `Draft` to `Accepted`. Do not alter the Context/Decision/Consequences
    sections unless implementation deviated from what was recorded (if it did, update those
    sections to match reality first, then confirm with the user before promoting status).
  - Acceptance: Given the finished, reviewed implementation, when the user confirms it matches
    ADR-0004's recorded decision, then `Status: Accepted` is set.
  - Depends on: Task 5.2

## Out of Scope
- **Entra app registration change** — cloud-infra dependency (`modules/xero-mcp`), not a backend-layer
  task. Must ship alongside this deploy per requirements.md Dependencies, but is tracked in the
  `infra` layer, not here.
- **Live Entra sign-in end-to-end verification (AC 1, AC 2)** — browser-based, validated post-deploy,
  not unit-testable per design.md's Testing Strategy "Out of scope for unit tests".
- **JWT minting, JTI indirection, consent UI, bespoke refresh machinery** — explicit design.md
  non-goals; inherited/passthrough behaviour is used instead.
- **`ENTRA_VERIFIER`/`EntraVerifier` changes** — unchanged per design.md; no task modifies it.
- **README.md auth section** — grep confirms no existing Entra/HTTP-mode auth section exists in
  README.md today (only Xero OAuth2 bootstrap docs). Adding one is a documentation expansion
  beyond this feature's scope; `.env.example` (Task 6.1) and `.specs/REPO.md` (Task 6.2) are the
  authoritative env/architecture docs updated here. Flagged for the user: confirm whether a
  README HTTP-mode/Entra section should be added as separate scope.
