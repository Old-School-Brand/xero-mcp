# Review: OAuth2 Web App Auth Flow
**Layer:** backend
**Feature:** 001-oauth2-web-app-auth
**Date:** 2026-05-25
**Iteration:** iteration 1
**Status:** FAILED
**Baseline:** `git merge-base HEAD main` = `60e89bf` (main)

## Reviewer Selection (iteration 1)

Ran:     dependency-reviewer, duplication-reviewer, maintainability-reviewer, performance-reviewer, security-reviewer, staff-reviewer, test-quality-reviewer
Skipped: documentation-reviewer (iterations: ["final"], IS_FINAL=false, default=skip)

## staff-reviewer Review
**Result:** MUST_FIX

### Findings
- [x] must-fix — REPO.md contains stale auth references that will mislead all future agent sessions — `.specs/REPO.md`:21,42,110-115,171,229
      REPO.md is the first file every agent and developer reads at session start (per CLAUDE.md instructions). It currently describes the old auth system in at least 9 locations: Tech Stack auth row references openid-client/Custom Connections; Project Layout describes xero-client.ts as "XeroClient subclasses for Custom Connection + Bearer Token; V1/V2 scope fallback"; Required env vars table lists XERO_SCOPES and XERO_CLIENT_BEARER_TOKEN; V1/V2 scope fallback prose; Claude Desktop config example uses XERO_SCOPES; Environment section describes old startup validation; Testing row says "None yet" despite Vitest being introduced.
      Recommendation: Update REPO.md to reflect current state: (1) Auth row → "Refresh Token mode via axios"; (2) Project Layout description for xero-client.ts → "RefreshTokenXeroClient — refresh token exchange, token file persistence, proactive renewal"; (3) Required env vars table → XERO_CLIENT_ID, XERO_CLIENT_SECRET, XERO_REFRESH_TOKEN, XERO_TOKEN_FILE (remove XERO_SCOPES and XERO_CLIENT_BEARER_TOKEN); (4) Replace V1/V2 scope prose with Refresh Token mode note; (5) Update Claude Desktop config example; (6) Fix Environment section startup validation description; (7) Update Testing row to "Vitest 4.x (`vitest run`)".
      Resolved: Updated all 9 stale locations in REPO.md — Auth row, Project Layout xero-client.ts description, Required env vars table (removed XERO_SCOPES/XERO_CLIENT_BEARER_TOKEN, added XERO_REFRESH_TOKEN/XERO_TOKEN_FILE), replaced V1/V2 scope prose with Refresh Token mode note, updated Claude Desktop config example, fixed Environment startup validation description, added Testing row with Vitest 4.x.

- [x] should-fix — `test_timerIsUnrefed` does not actually verify `unref()` was called — `src/__tests__/clients/xero-client.test.ts`:362-381
      The test claims to verify "the timer handle has unref() called on it" but only asserts that setTimeout was called and its return value is defined. It never asserts unref() was invoked. If the .unref() call were removed from the implementation, this test would still pass. FR-6 requirement (timer unref'd so process exits cleanly on MCP client disconnect) silently unverified.
      Recommendation: Spy on the unref method of the timer handle, or mock setTimeout to return an object with a mocked unref and assert it was called.
      Resolved: Replaced the test body: mocks globalThis.setTimeout to inject a spy on `.unref()` for each returned handle, then asserts `unrefSpy` was called after `getBootstrappedClient()` completes.

- [x] should-fix — `exchangeToken` does not validate `access_token` or `refresh_token` presence in Xero response — `src/clients/xero-client.ts`:131-145
      Validates `expires_in` presence (correctly preventing tight-loop scenario), but does not validate `access_token` or `refresh_token`. If Xero returned a 200 with a missing refresh_token, persistRefreshToken would write the string "undefined" to the token file, corrupting it and requiring manual recovery.
      Recommendation: Add validation alongside the existing `expires_in` check: `if (!access_token || !refresh_token) throw new Error("Xero response missing required token fields")`.
      Resolved: Added `if (!access_token || !refresh_token) throw new Error("Xero response missing required token fields")` in `exchangeToken` before the `expires_in` check. Also loosened the cast to `{ access_token?: string; refresh_token?: string; expires_in?: number | null; token_type: string }` so the guard is reachable.

- [x] should-fix — `persistRefreshToken` test uses wrong token file path assertion — `src/__tests__/clients/xero-client.test.ts`:260-270
      `vi.stubEnv("XERO_TOKEN_FILE", "/tmp/test-refresh-token")` at line 262 is called, but `getClient()` at line 263 does `vi.resetModules()` and re-stubs XERO_TOKEN_FILE. The line 262 stub is overridden. Test passes because writeFileSync assertion uses `expect.any(String)` so it doesn't verify correct path was written.
      Recommendation: Fix `getClient` to accept a custom XERO_TOKEN_FILE parameter, or assert the specific path in the writeFileSync expectation (expect the .tmp suffix on the expected path).
      Resolved: Refactored `getClient()` into a shared `getFreshClient()` helper (see finding #9). The `test_dirExists_writesTokenFile` test now stubs `XERO_TOKEN_FILE` to `/tmp/test-refresh-token` before calling `getFreshClient()` and asserts the exact `.tmp` path `"/tmp/test-refresh-token.tmp"` in the `writeFileSync` expectation.

## maintainability-reviewer Review
**Result:** WARNINGS

### Findings
- [x] should-fix — `test_timerIsUnrefed` does not assert `.unref()` was called — `src/__tests__/clients/xero-client.test.ts`:362
      [Duplicate of staff-reviewer finding above — same root cause]
      Recommendation: Mock setTimeout to return `{ unref: vi.fn() }`, then assert `unrefSpy` was called.
      Resolved: See staff-reviewer finding #2 — same fix applied.

- [x] should-fix — Two separate `expect(...).toThrow` calls on the same error message — `src/__tests__/clients/xero-client.test.ts`:167-172, 223-229
      In `test_noTokenSource_throwsWithGuidance` and `test_expiredToken_throwsWithGuidance`, the method under test is called twice to assert two parts of the same error message. Doubles side effects and creates a redundant production call.
      Recommendation: Use a single `await expect(...).rejects.toThrow(...)` with a single regex matching both substrings, or capture the error and assert against `err.message` twice.
      Resolved: Both tests now use a single call with a combined alternation regex (`/A.*B|B.*A/`) that matches either ordering of both substrings.

- [x] should-fix — `as unknown as { privateMethod() }` cast repeated 19 times in the test file — `src/__tests__/clients/xero-client.test.ts` (throughout)
      Every test exercising a private method re-casts xeroClient to a hand-written inline interface. If a private method is renamed, all 19 sites must be updated independently — and none will produce a compile error, they will silently call `undefined`.
      Recommendation: Define a single `type TestableClient` at the top of the test file exposing all the private methods under test. Use it consistently.
      Resolved: Defined `type TestableClient` at the top of the test file exposing all private methods under test. All cast sites now use `client as unknown as TestableClient` instead of repeating the inline interface shapes.

- [ ] nit — `AxiosError` catch in `exchangeToken` wraps all HTTP errors with the "invalid or expired" message — `src/clients/xero-client.ts`:147-155
      Message is accurate for `invalid_grant` (400) but misleading for 500/DNS/timeout. Users seeing this for a transient outage will unnecessarily regenerate their refresh token.
      Recommendation: Check `data?.error === "invalid_grant"` before using the "invalid or expired" message. For other HTTP/network errors, propagate with generic "token exchange failed" message that includes status code and Xero error body.

- [ ] nit — Missing test for `expires_in` absent from Xero response — `src/__tests__/clients/xero-client.test.ts`
      Design's error table explicitly documents this as fail-loud. Guard exists in implementation at line 139 but no test covers it.
      Recommendation: Add `test_missingExpiresIn_throws` in the `exchangeToken()` describe block: mock axios.post to resolve with response missing `expires_in` and assert the call rejects with a message matching `expires_in`.

- [ ] nit — README does not give the explicit `mkdir -p ~/.xero-mcp` command for first-time users — `README.md`:73
      Note says "make sure the directory exists" but never gives the command. First-time users hit `persistRefreshToken` throw on first run with no copy-paste fix.
      Recommendation: Add a code block immediately below the note: `mkdir -p ~/.xero-mcp`.

## security-reviewer Review
**Result:** WARNINGS

### Findings
- [x] should-fix — `authenticate()` has no concurrency guard — multiple in-flight calls will each run the full startup flow — `src/clients/xero-client.ts`:192-206
      `initialised` flag is set to true only after all async operations complete. If two callers invoke `authenticate()` concurrently before the first sets `initialised = true`, both run the full token exchange, write to the token file, and schedule separate refresh timers. Cannot happen in normal operation (authenticate is awaited in main() before ToolFactory) but no in-code guard makes the invariant explicit.
      Recommendation: Introduce an in-progress promise guard: `if (this.authPromise) return this.authPromise; this.authPromise = this._doAuthenticate(); return this.authPromise;`
      Resolved: Added `private authPromise: Promise<void> | null = null` to `RefreshTokenXeroClient`. `authenticate()` now checks `this.authPromise` before creating a new one; extracted startup logic into `_doAuthenticate()`. Concurrent callers share the same in-flight promise.

- [ ] nit — Negative `delayMs` causes immediate repeated refresh if `expires_in` < 300 — `src/clients/xero-client.ts`:173
      `const delayMs = (expiresIn - 300) * 1000` produces a negative value if `expires_in < 300`. Node.js treats negative setTimeout delay as 1ms, causing tight loop. Xero's current TTL is 1800 so not exploitable today, but silent failure mode.
      Recommendation: Add a floor: `const delayMs = Math.max((expiresIn - 300) * 1000, 0)`. Optionally log a warning if `expiresIn <= 300`.

- [ ] nit — Raw error object logged to stderr could leak Authorization header — `src/index.ts`:24, `src/clients/xero-client.ts`:186
      `console.error("Error:", error)` and `console.error("Scheduled token refresh failed:", error)` log the raw error. If a non-AxiosError is propagated, the original exception including axios request config (which contains `Authorization: Basic …`) could be logged.
      Recommendation: In `exchangeToken`, ensure catch block always wraps every thrown value in a new plain `Error`. Change `throw error` on line 156 to `throw new Error(\`Unexpected error during token exchange: ${error instanceof Error ? error.message : String(error)}\`)`. Same for the console.error in scheduleRefresh — log `error instanceof Error ? error.message : String(error)`.

## test-quality-reviewer Review
**Result:** WARNINGS

### Findings
- [x] should-fix — Test does not verify `unref()` is called on timer handle — `src/__tests__/clients/xero-client.test.ts`:362
      [Duplicate of staff-reviewer and maintainability-reviewer findings — same root cause]
      Recommendation: Spy on the timer handle's `unref` method by wrapping `setTimeout` to return an object with a spied `.unref()`. Assert it was called.
      Resolved: See staff-reviewer finding #2 — same fix applied.

- [x] should-fix — `setTokenSet` assertion does not verify `refresh_token` is excluded — `src/__tests__/clients/xero-client.test.ts`:432
      `test_firstAuthenticate_fullStartupFlow` asserts `setTokenSetSpy` was called with `expect.objectContaining({ access_token: "at_new" })`. Design (Component 5) explicitly states refresh_token must NOT be passed to setTokenSet. The broad `objectContaining` matcher does not enforce this invariant.
      Recommendation: Change to `expect.not.objectContaining({ refresh_token: expect.anything() })` or assert the exact shape `{ access_token, expires_in, token_type }`.
      Resolved: Added a second assertion `expect(setTokenSetSpy).toHaveBeenCalledWith(expect.not.objectContaining({ refresh_token: expect.anything() }))` immediately after the existing `objectContaining` assertion.

- [ ] nit — `persistRefreshToken` tests do not verify atomic write (`renameSync`) — `src/__tests__/clients/xero-client.test.ts`:260
      Verifies `writeFileSync` is called with 0600 permissions but does not assert `renameSync` is called to complete the atomic temp-then-rename pattern. If renameSync were accidentally removed, the partial-write vulnerability returns silently.
      Recommendation: Add `expect(vi.mocked(fs.renameSync)).toHaveBeenCalledWith(expect.stringContaining('.tmp'), expect.any(String))`.

- [ ] nit — `test_dirExists_writesTokenFile` re-stubs XERO_TOKEN_FILE after module import — `src/__tests__/clients/xero-client.test.ts`:263
      Line 263 stubs to `/tmp/test-refresh-token` but client's tokenFilePath was already set during construction. Re-stub has no effect; test passes only because path argument is asserted with `expect.any(String)`.
      Recommendation: Either remove the dead `vi.stubEnv` at line 263 or set the desired XERO_TOKEN_FILE before calling `getClient()` and assert the exact path.
      Resolved: This nit is now superseded by the should-fix fix for finding #4 — the test now stubs XERO_TOKEN_FILE before `getFreshClient()` and asserts the exact `.tmp` path.

## duplication-reviewer Review
**Result:** PASSED

### Findings
- [x] should-fix — Repeated `getClient()` helper functions across test describe blocks — `src/__tests__/clients/xero-client.test.ts`:103-112, 180-193, 236-245
      Three nearly-identical `getClient()` functions (~85% similar). The core logic is identical; only the return type annotation and one extra env var stub differ.
      Recommendation: Extract a single top-level `async function getFreshClient()` that resets modules, stubs env, imports the module, returns `mod.xeroClient`. Each describe block casts as needed at the call site. `getBootstrappedClient()` stays separate as it has different logic.
      Resolved: Extracted `getFreshClient()` as a top-level helper. All three describe-local `getClient()` functions removed. Call sites in Sections 2, 3, and 4 now use `getFreshClient()`. `getBootstrappedClient()` remains local to `scheduleRefresh()` describe block.

- [x] should-fix — Repeated `(client as unknown as { resolveRefreshToken(): string }).resolveRefreshToken()` type cast — `src/__tests__/clients/xero-client.test.ts`:128,136,147,156,168,171
      The same 69-character type assertion is repeated 6 times. The `getClient()` helper already casts to a type that includes `resolveRefreshToken`, yet every call site re-casts. Same pattern in `exchangeToken` and `persistRefreshToken` describe blocks.
      Recommendation: Use the helper's return type directly (`client.resolveRefreshToken()`). If TypeScript still complains, define `const resolve = () => (client as any).resolveRefreshToken()` once at the top.
      Note: This finding overlaps with maintainability-reviewer's `as unknown as` finding above.
      Resolved: Superseded by the `TestableClient` type fix (finding #6 / maintainability). All call sites now use `(client as unknown as TestableClient).methodName()` consistently.

- [ ] nit — `setTokenSet(...)` call duplicated in `authenticate()` and `scheduleRefresh()` — `src/clients/xero-client.ts`:179-183, 199-203
      Identical 4-line blocks destructuring tokenData into setTokenSet().
      Recommendation: Accept the duplication — both call sites are 4 lines in closely related methods; extracting a helper would add indirection for minimal gain. Two similar lines are better than one premature helper.

- [ ] nit — `openid-client` remains as a direct dependency despite being unused in source code — `package.json`:31
      The design explicitly notes removal is out of scope for FR-8. Flagging for awareness; no action required this iteration.

## dependency-reviewer Review
**Result:** PASSED_WITH_WARNINGS

### Findings
- [x] should-fix — Design deviation: `authenticate()` missing the "not initialised" throw guard — `src/clients/xero-client.ts`:192-207
      Design component 5 specifies three branches: first call runs full flow; subsequent calls with `initialised=true` return immediately; subsequent calls with `initialised=false` (i.e. startup failed mid-flight) throw `Error("xeroClient not initialised")`. The third branch is absent — current implementation simply re-runs the full flow.
      Note: Maintainability-reviewer noted this as a positive simplification. This is a design vs. simplicity trade-off — user decision required if the design's explicit error is preferred over the more resilient re-run behaviour.
      Recommendation: Either add the guard as designed, or update design.md to record the simplification decision.
      Resolved: Updated design.md Component Breakdown §5 to document the concurrency guard approach (`this.authPromise` in-flight promise sharing) as the replacement for the "throw on subsequent false" branch. The edge case note is also updated to reflect the correct concurrent-call behaviour.

- [x] should-fix — Test `test_timerIsUnrefed` does not assert `unref()` was called — `src/__tests__/clients/xero-client.test.ts`:362-381
      [Duplicate of staff, maintainability, test-quality findings — same root cause]
      Resolved: See staff-reviewer finding #2 — same fix applied.

- [ ] nit — `expires_in` null-check in `exchangeToken()` is unreachable per TypeScript types and untested — `src/clients/xero-client.ts`:139
      `expires_in` is destructured from a value cast to `{ expires_in: number; ... }`. The `=== null` and `=== undefined` branches are unreachable per TypeScript types. In full-TDD mode, an unreachable error path is a code-vs-types mismatch.
      Recommendation: Either make the cast looser (`expires_in?: number | null`) so the guard is reachable and meaningful, or add a test for this path (matching maintainability-reviewer's recommendation).
      Resolved (partial): The cast is now loosened to `{ access_token?: string; refresh_token?: string; expires_in?: number | null; token_type: string }` so the guard is reachable. A test for this path is a nit and deferred.

- [ ] nit — `XERO_TOKEN_FILE` uses `||` instead of `??` (nullish coalescing) — `src/clients/xero-client.ts`:88
      Design specifies `??` but implementation uses `||`. With `||`, empty string `""` falls through to default; with `??`, empty string is treated as valid.
      Note: Maintainability-reviewer noted the `||` choice as correct for this use case (treating empty string as unset). Either re-align with the design spec by using `??`, or update the design to record the deliberate change.

## performance-reviewer Review
**Result:** PASSED

### Findings
No findings.

All four Performance Considerations from design.md are correctly implemented:
- `authenticate()` guard is a synchronous `initialised` flag check — subsequent handler calls are free after startup
- Timer at line 189 calls `.unref()` so it does not prevent process exit when MCP client disconnects
- File I/O occurs once at startup and once per token exchange — never inside a loop
- The `expires_in` null-check at line 139 prevents NaN delay tight-loop

No backend anti-patterns found: no N+1 queries, no synchronous HTTP calls in request handlers, no file I/O inside loops.

## Summary

The implementation is structurally sound — the design's goal of one auth mode, one file, minimal surface area change, no handler modifications was executed faithfully. Atomic temp-then-rename is correct, `unref()` is in place, `setTokenSet` correctly excludes `refresh_token`, all old auth code is fully gone, all 17 tests pass.

**However:** staff-reviewer flagged a **must-fix** that elevates overall status to FAILED — `.specs/REPO.md` still describes the old auth system (Custom Connections, openid-client, V1/V2 scopes, XERO_CLIENT_BEARER_TOKEN, XERO_SCOPES) in 9 locations. Since REPO.md is the first file every agent and developer reads at session start, leaving it stale will actively mislead every future feature session in this fork.

Three reviewers independently flagged the same `test_timerIsUnrefed` test as not actually verifying `.unref()` is called — a real test gap on a security-critical behaviour (process exit on MCP client disconnect). One reviewer flagged a real correctness gap: `exchangeToken` doesn't validate `access_token`/`refresh_token` presence in the Xero response, which could silently corrupt the token file in a malformed-response edge case.

The remaining findings cluster around test hygiene (19 repeated `as unknown as` casts, three duplicate `getClient` helpers, weak `objectContaining` assertions that don't enforce design invariants), one missing concurrency guard in `authenticate()`, and a few nits around error message specificity and the unused `openid-client` dependency.

Recommended fix priority for iteration 2:
1. **Must-fix:** Update REPO.md (~10 minute edit, eliminates session-start confusion for all future work).
2. **Should-fix correctness:** Validate `access_token`/`refresh_token` in `exchangeToken`; add real `.unref()` assertion; add concurrency guard.
3. **Should-fix test quality:** Strengthen `setTokenSet` assertion; consolidate `as unknown as` casts; extract shared `getFreshClient` helper; fix XERO_TOKEN_FILE re-stub.
4. **Nits:** Generic error for non-`invalid_grant` HTTP errors; `Math.max` floor on delayMs; safer error logging in stderr; missing `expires_in`-absent test; `mkdir` example in README.
