# Review: OAuth2 Web App Auth Flow
**Layer:** backend
**Feature:** 001-oauth2-web-app-auth
**Date:** 2026-05-25
**Iteration:** iteration 3 (final pass)
**Status:** PASSED_WITH_WARNINGS (nits only)
**Baseline:** `git merge-base HEAD main` = `60e89bf` (main)

## Reviewer Selection (iteration 1)

Ran:     dependency-reviewer, duplication-reviewer, maintainability-reviewer, performance-reviewer, security-reviewer, staff-reviewer, test-quality-reviewer
Skipped: documentation-reviewer (iterations: ["final"], IS_FINAL=false, default=skip)

## Reviewer Selection (iteration 2)

Ran:     dependency-reviewer, duplication-reviewer, maintainability-reviewer, security-reviewer, test-quality-reviewer
Skipped:
  - documentation-reviewer (iterations: ["final"], IS_FINAL=false, default=skip)
  - performance-reviewer (iterations: [1, "final"], iter=2 doesn't match; PASSED clean in iter 1)
  - staff-reviewer (iterations: [1, "final"], iter=2 doesn't match)

## Reviewer Selection (iteration 3 — final pass)

Ran:     dependency-reviewer, documentation-reviewer, duplication-reviewer, maintainability-reviewer, security-reviewer, test-quality-reviewer
Skipped:
  - performance-reviewer (clean from iter 1; skip-when-clean)
  - staff-reviewer (clean from iter 2; skip-when-clean — all 4 findings resolved)

Iter 3 reviewer results:
  - dependency-reviewer: PASSED (no new outdated deps from this feature; pre-existing tech debt remains out-of-scope)
  - documentation-reviewer: PASSED_WITH_WARNINGS (1 must-fix + 4 should-fix doc accuracy — all resolved inline)
  - duplication-reviewer: PASSED (Section 6 setup duplication still open as a nit; no new duplication)
  - maintainability-reviewer: PASSED (iter 3 fix confirmed non-vacuous)
  - security-reviewer: PASSED (no new issues from iter 3)
  - test-quality-reviewer: PASSED (iter 3 fix confirmed non-vacuous)

## documentation-reviewer Review (iter 3 — final pass)
**Result (iter 3):** PASSED_WITH_WARNINGS → all findings resolved inline before completion

### Findings
- [x] must-fix — ADR index lists ADR 0001 as "Draft" but the ADR file itself is "Accepted" — `.specs/adr/README.md`:34
      Resolved (iter 3 inline): Updated the ADR index status column from `Draft` to `Accepted`.

- [x] should-fix — requirements.md has two unchecked acceptance-criteria checkboxes for completed work — `.specs/001-oauth2-web-app-auth/backend/requirements.md`:113-114
      Resolved (iter 3 inline): Ticked both `.env.example` and `README.md` acceptance criterion boxes.

- [x] should-fix — design.md describes XERO_TOKEN_FILE resolution using `??` but implementation uses `||` — `.specs/001-oauth2-web-app-auth/backend/design.md`:112
      Resolved (iter 3 inline): Updated Component 2 logic to use `||` with a note explaining why (empty-string env var should fall through to default).

- [x] should-fix — design.md Testing Strategy describes Vitest as "to be introduced — no test framework currently exists in this repo" — `.specs/001-oauth2-web-app-auth/backend/design.md`:230
      Resolved (iter 3 inline): Updated Framework line to read "Vitest 4.x" (dropping the stale parenthetical).

- [x] should-fix — REPO.md Testing table omits the npm scripts added by this feature — `.specs/REPO.md`:143-146
      Resolved (iter 3 inline): Added rows for `npm run test` and `npm run test:coverage`; reordered the table.

## staff-reviewer Review
**Result (iter 1):** MUST_FIX → not re-run in iter 2

### Findings
- [x] must-fix — REPO.md contains stale auth references that will mislead all future agent sessions — `.specs/REPO.md`:21,42,110-115,171,229
      Resolved (iter 2): Updated all 9 stale locations in REPO.md — Auth row, Project Layout xero-client.ts description, Required env vars table (removed XERO_SCOPES/XERO_CLIENT_BEARER_TOKEN, added XERO_REFRESH_TOKEN/XERO_TOKEN_FILE), replaced V1/V2 scope prose with Refresh Token mode note, updated Claude Desktop config example, fixed Environment startup validation description, added Testing row with Vitest 4.x.

- [x] should-fix — `test_timerIsUnrefed` does not actually verify `unref()` was called — `src/__tests__/clients/xero-client.test.ts`:362-381
      Resolved (iter 2): Replaced the test body — mocks `globalThis.setTimeout` to inject a spy on `.unref()` for each returned handle, then asserts `unrefSpy` was called after `getBootstrappedClient()` completes.

- [x] should-fix — `exchangeToken` does not validate `access_token` or `refresh_token` presence in Xero response — `src/clients/xero-client.ts`:131-145
      Resolved (iter 2): Added `if (!access_token || !refresh_token) throw new Error("Xero response missing required token fields")` in `exchangeToken` before the `expires_in` check. Also loosened the cast to `{ access_token?: string; refresh_token?: string; expires_in?: number | null; token_type: string }` so the guard is reachable.

- [x] should-fix — `persistRefreshToken` test uses wrong token file path assertion — `src/__tests__/clients/xero-client.test.ts`:260-270
      Resolved (iter 2): Refactored `getClient()` into a shared `getFreshClient()` helper. The `test_dirExists_writesTokenFile` test now stubs `XERO_TOKEN_FILE` to `/tmp/test-refresh-token` before calling `getFreshClient()` and asserts the exact `.tmp` path `"/tmp/test-refresh-token.tmp"` in the `writeFileSync` expectation.

## maintainability-reviewer Review
**Result (iter 1):** WARNINGS
**Result (iter 2):** WARNINGS

### Findings
- [x] should-fix — `test_timerIsUnrefed` does not assert `.unref()` was called
      Resolved (iter 2): See staff-reviewer finding above — same fix applied.

- [x] should-fix — Two separate `expect(...).toThrow` calls on the same error message — `src/__tests__/clients/xero-client.test.ts`:167-172, 223-229
      Resolved (iter 2): Both tests now use a single call with a combined alternation regex (`/A.*B|B.*A/`) that matches either ordering of both substrings.

- [x] should-fix — `as unknown as { privateMethod() }` cast repeated 19 times — test file (throughout)
      Resolved (iter 2): Defined `type TestableClient` at the top of the test file. All cast sites now use `client as unknown as TestableClient`.

- [x] should-fix (iter 2 NEW) — Vacuous `updateTenants` not-called assertion — `src/__tests__/clients/xero-client.test.ts`:332-336
      The iter 1 fix created a new `vi.spyOn` on `updateTenants` *after* the timer callback has already fired, then calls `mockClear()` and asserts `not.toHaveBeenCalled()`. The new spy does not observe the already-completed call. The assertion passes regardless of whether the implementation calls `updateTenants` during the timer callback. Design Component 6's "no updateTenants on refresh" invariant is silently unverified. (Also flagged by test-quality-reviewer.)
      Recommendation: Capture the spy returned at line 300 (inside `getBootstrappedClient`, where `updateTenants` is already spied on before `authenticate()` is called). Hold it in a variable. After `advanceTimersByTimeAsync` fires the timer, call `spy.mockClear()` on that captured spy and assert `not.toHaveBeenCalled()` — but actually, the spy must be cleared BEFORE the timer fires, not after, to detect a regression. Pattern: `spy.mockClear(); await vi.advanceTimersByTimeAsync(...); expect(spy).not.toHaveBeenCalled();`
      Resolved (iter 3): Moved `vi.spyOn(client, "updateTenants")` and `updateTenantsSpy.mockClear()` to immediately after `getBootstrappedClient()` returns, BEFORE any timer advancement. The spy now captures a clean baseline before the callback fires. Verified non-vacuousness: temporarily adding `await this.updateTenants()` inside `scheduleRefresh` caused the assertion to fail; removing it restored all 17 tests to green.

- [ ] nit (carried from iter 1) — `AxiosError` catch wraps all HTTP errors with "invalid or expired" — `src/clients/xero-client.ts`:154-164
      Misleading for 500/DNS/timeout. Users may unnecessarily regenerate refresh token on a transient outage.
      Recommendation: Check `(error.response?.data as Record<string, unknown>)?.error === "invalid_grant"` and use the "invalid or expired" message only for that case. For other HTTP/network errors, throw with a message that includes status code and Xero error body without the misleading framing.

- [ ] nit (carried from iter 1) — Missing test for `expires_in` absent from Xero response — `src/__tests__/clients/xero-client.test.ts`
      Recommendation: Add `test_missingExpiresIn_throws` in the `exchangeToken()` describe block: mock `axios.post` to resolve with response missing `expires_in` and assert the call rejects with a message matching `/expires_in/`.

- [ ] nit (carried from iter 1) — README missing `mkdir -p ~/.xero-mcp` command — `README.md`:73
      Recommendation: Add a code block immediately below the existing note: `mkdir -p ~/.xero-mcp`.

## security-reviewer Review
**Result (iter 1):** WARNINGS
**Result (iter 2):** WARNINGS

### Findings
- [x] should-fix — `authenticate()` has no concurrency guard — `src/clients/xero-client.ts`:192-206
      Resolved (iter 2): Added `private authPromise: Promise<void> | null = null` to `RefreshTokenXeroClient`. `authenticate()` checks `this.authPromise` before creating a new one; startup logic extracted to `_doAuthenticate()`.

- [ ] nit (iter 2 NEW) — `authPromise` retained after failure prevents retry — `src/clients/xero-client.ts`:203-204
      If `_doAuthenticate()` rejects (e.g. bad refresh token), `authPromise` is set to the rejected promise and never cleared. A second call returns the stale rejected promise rather than retrying. Benign in current `main()` design (process.exit on failure), but the comment says "concurrent callers share the same promise" — a caller reasoning about the guard will expect it to be safe for retries.
      Recommendation: `this.authPromise = this._doAuthenticate().catch(err => { this.authPromise = null; throw err; });`

- [ ] nit (carried from iter 1) — Negative `delayMs` causes immediate tight-loop if `expires_in` < 300 — `src/clients/xero-client.ts`:180
      Recommendation: `const delayMs = Math.max((expiresIn - 300) * 1000, 0);`

- [ ] nit (carried from iter 1) — Raw error object logged to stderr could expose Authorization header — `src/clients/xero-client.ts`:193, `src/index.ts`:24
      Recommendation: Log `error instanceof Error ? error.message : String(error)` in both `console.error` sites. In `exchangeToken`'s catch, change `throw error` to `throw new Error(\`Unexpected error during token exchange: ${error instanceof Error ? error.message : String(error)}\`)` so all escaping errors are plain Error instances without attached axios config.

## test-quality-reviewer Review
**Result (iter 1):** WARNINGS
**Result (iter 2):** PASSED_WITH_WARNINGS

### Findings
- [x] should-fix — Test does not verify `unref()` is called on timer handle
      Resolved (iter 2): See staff-reviewer finding above.

- [x] should-fix — `setTokenSet` assertion does not verify `refresh_token` is excluded — `src/__tests__/clients/xero-client.test.ts`:432
      Resolved (iter 2): Added `expect(setTokenSetSpy).toHaveBeenCalledWith(expect.not.objectContaining({ refresh_token: expect.anything() }))` after the existing assertion.

- [x] should-fix (iter 2 NEW — duplicate of maintainability NEW finding) — Vacuous `updateTenants` not-called assertion — `src/__tests__/clients/xero-client.test.ts`:332-336
      See maintainability-reviewer finding above. Same fix.
      Resolved (iter 3): Same fix as maintainability-reviewer above — spy captured and cleared before timer fires. 17/17 tests pass, regression check confirmed.

- [ ] nit (carried from iter 1) — `persistRefreshToken` tests do not verify atomic write (`renameSync`) — `src/__tests__/clients/xero-client.test.ts`:250-260
      Recommendation: Add `expect(vi.mocked(fs.renameSync)).toHaveBeenCalledWith("/tmp/test-refresh-token.tmp", "/tmp/test-refresh-token")` after the existing `writeFileSync` assertion.

- [ ] nit (iter 2 NEW) — Missing test for `access_token`/`refresh_token` absent from Xero response
      The iter 1 fix work added the validation guard but no test was written for the new code path.
      Recommendation: Add test in `exchangeToken()` describe block: mock `axios.post` to resolve with a response missing `refresh_token` and assert the call rejects with a message matching `/missing required token fields/`.

## duplication-reviewer Review
**Result (iter 1):** PASSED
**Result (iter 2):** PASSED

### Findings
- [x] should-fix — Repeated `getClient()` helper functions across describe blocks
      Resolved (iter 2): Extracted single top-level `async function getFreshClient()` replacing the three describe-local `getClient()` functions. `getBootstrappedClient()` remains local to its describe block. Confirmed in iter 2 review.

- [x] should-fix — Repeated `(client as unknown as { resolveRefreshToken(): string }).resolveRefreshToken()` type cast
      Resolved (iter 2): All cast sites now use `TestableClient` type alias. Confirmed in iter 2 review.

- [ ] should-fix (iter 2 NEW) — Section 6 `authenticate()` tests bypass `getFreshClient()` with duplicated inline setup — `src/__tests__/clients/xero-client.test.ts`:383-399, 428-444
      Two test bodies with identical 15-line setup blocks (env stubs + fs mocks + axios mock + module import + client extraction). The `getFreshClient()` helper was extracted in iter 1 to eliminate this pattern but Section 6 tests were not migrated.
      Recommendation: Either use `getFreshClient()` in Section 6 for the env-stub + import portion (then add fs/axios mocks after), or create a second helper `getAuthReadyClient()` that calls `getFreshClient()` and additionally stubs `XERO_TOKEN_FILE`, `XERO_REFRESH_TOKEN`, `fs.readFileSync`, `fs.existsSync`, `axios.post` to happy-path defaults.

- [ ] nit (carried from iter 1) — `setTokenSet(...)` call duplicated in `_doAuthenticate()` and `scheduleRefresh()` — `src/clients/xero-client.ts`:186-190, 213-217
      Accept the duplication — two similar lines are better than one premature helper.

- [ ] nit (carried from iter 1) — `openid-client` remains as a direct dependency despite being unused — `package.json`:31
      Out of scope for this feature per design.

## dependency-reviewer Review
**Result (iter 1):** PASSED_WITH_WARNINGS (mistakenly reviewed implementation code, not dependencies)
**Result (iter 2):** FAILED (correctly reviewed dependency versions)

### Iteration 1 (off-spec implementation findings)
- [x] should-fix — Design deviation: `authenticate()` missing the "not initialised" throw guard
      Resolved (iter 2): Concurrency guard via `authPromise` (security-reviewer finding) supersedes this. design.md Component §5 updated to document the new approach.

- [x] should-fix — Test `test_timerIsUnrefed` does not assert `unref()` was called
      Resolved (iter 2): See staff-reviewer finding above — same fix applied.

- [x] nit — `expires_in` null-check unreachable per TypeScript types
      Resolved (iter 2): The cast was loosened to `expires_in?: number | null` to make the guard reachable.

- [x] nit — `XERO_TOKEN_FILE` uses `||` instead of `??`
      Decision (iter 2): Keep `||` — empty string env var should fall through to default path. Updated design.md.

### Iteration 2 (proper dependency-freshness audit)

> **Scope note:** All findings below are **pre-existing tech debt on `main`** — they were not introduced or modified by this feature. This feature only touched: `vitest` (current), `@vitest/coverage-v8` (current), and `axios` (elevated to direct dep, version current). Per mill rule "no scope changes", these are recorded for awareness but **out of scope** for this feature's merge. They should be addressed in a separate dependency-upgrade workstream using the `dependency-upgrader` agent.

- [ ] out-of-scope (must-fix flag) — `dotenv` ^16.4.7 → 17.4.2 (major)
- [ ] out-of-scope (must-fix flag) — `xero-node` ^13.3.0 → 17.0.0 (major; 4 versions behind)
- [ ] out-of-scope (must-fix flag) — `zod` 3.25 → 4.4.3 (major)
- [ ] out-of-scope (must-fix flag) — `@eslint/js` ^9.39.1 → 10.0.1 (major)
- [ ] out-of-scope (must-fix flag) — `@types/node` ^22.13.10 → 25.9.1 (major)
- [ ] out-of-scope (must-fix flag) — `eslint` ^9.39.1 → 10.4.0 (major)
- [ ] out-of-scope (must-fix flag) — `globals` ^16.5.0 → 17.6.0 (major)
- [ ] out-of-scope (must-fix flag) — `typescript` ^5.9.3 → 6.0.3 (major)
- [ ] out-of-scope (should-fix flag) — `@modelcontextprotocol/sdk` ^1.23.4 → 1.29.0 (minor)
- [ ] out-of-scope (should-fix flag) — `shx` ^0.3.4 → 0.4.0 (minor)
- [ ] out-of-scope (should-fix flag) — `typescript-eslint` ^8.48.1 → 8.60.0 (minor)
- [ ] out-of-scope (nit flag) — `openid-client` ^6.8.1 → 6.8.4 (patch; also unused — separate cleanup task)
- [ ] out-of-scope (nit flag) — `prettier` 3.7.4 → 3.8.3 (patch)

## performance-reviewer Review
**Result (iter 1):** PASSED — no findings
**Status (iter 2):** Skipped (clean from prior iteration; nothing to re-check)

## Summary

Iteration 2 resolved all 1 must-fix and 10 should-fix findings from iteration 1. Verification gates green: 17/17 tests pass, `npm run build` clean, `npm run lint` clean.

Two reviewers (maintainability, test-quality) flagged the **same new should-fix** in iter 2: the `updateTenants` not-called assertion at lines 332-336 is now vacuously true. The iter 1 fix (`mockClear` after the timer fires) creates a fresh spy that doesn't observe the already-completed call. The fix needs the spy clear to happen *before* the timer fires.

Dependency-reviewer (which did an off-spec implementation review in iter 1) is now correctly auditing dependency freshness in iter 2 and flagged 8 major-version-behind dependencies. **None were introduced by this feature** — they are pre-existing tech debt on `main` (e.g. `xero-node` 13→17, `zod` 3→4, `typescript` 5→6, `eslint` 9→10). Per the mill rule "no scope changes", bulk-upgrading these is not in scope for the OAuth2 auth feature. They should be addressed in a separate dependency-upgrade workstream.

The remaining items are all nits — most carried from iter 1 (AxiosError message specificity, `Math.max` floor on `delayMs`, raw error logging, README `mkdir` command, missing `renameSync`/`expires_in`/`refresh_token` test cases) plus two new in iter 2 (`authPromise` not cleared on failure; Section 6 tests skipping `getFreshClient`).

Overall status: **PASSED_WITH_WARNINGS** (the 8 must-fix dependency flags are reclassified as out-of-scope; the only in-scope should-fix is the single vacuous-assertion fix duplicated across 2 reviewers).

Recommended fix priority for iteration 3:
1. **Should-fix:** Fix the vacuous `updateTenants` assertion (move spy clear to before timer fires).
2. **Quick nits:** Add `Math.max` floor on `delayMs`; add `mkdir -p ~/.xero-mcp` to README; add `renameSync` assertion; clear `authPromise` on rejection; add tests for `expires_in` absent and `refresh_token` absent.
3. **Larger nits to defer:** AxiosError message specificity; raw error log sanitisation; Section 6 helper refactor; openid-client direct dep removal.
4. **Out of scope (separate feature):** Dependency upgrades.
