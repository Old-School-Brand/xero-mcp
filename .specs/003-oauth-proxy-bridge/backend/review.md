# Review: OAuth-Proxy Bridge for Entra (MCP HTTP auth)
**Layer:** backend
**Feature:** 003-oauth-proxy-bridge
**Date:** 2026-07-05
**Iteration:** iteration 2
**Status:** PASSED_WITH_WARNINGS (all must-fix/should-fix resolved; one deferred nit remains)

Baseline for change scope: `git merge-base HEAD main` = `a972b9d`.

## Reviewer Selection (iteration 2)

Ran:     security-reviewer, maintainability-reviewer, test-quality-reviewer (re-run to verify iteration-1 findings)
Skipped: staff-reviewer, performance-reviewer, duplication-reviewer (clean from iteration 1; nothing to re-check), documentation-reviewer + dependency-reviewer (iterations=[final]; run in the final pass)

**Iteration 2 outcome:** all three re-run reviewers returned PASSED / FINDINGS: none. The security should-fix
(query-string stripped from access logs), the maintainability should-fix (async IIFE → plain try/catch), and
the two test-quality should-fixes (server-PKCE math assertion, tokens-in-record assertion) plus the fetch-spy
nit are confirmed resolved with no regressions and no weakened tests. One nit remains open and deferred:
`/auth/callback` rate limiting (defense-in-depth, low practical risk).

## Reviewer Selection (iteration 2 — final pass)

Ran:     documentation-reviewer, dependency-reviewer (iterations=[final]; final pass)
Skipped: staff/performance/duplication/security/maintainability/test-quality (clean or resolved; nothing to re-check)

### documentation-reviewer Review (final pass)
**Result:** PASSED_WITH_WARNINGS
- [x] nit — README.md has no Entra/HTTP-mode auth section — README.md
      Pre-existing gap (introduced by 002-http-transport-and-oauth), NOT worsened by 003. `.env.example` +
      `.specs/REPO.md` are the authoritative env/architecture docs and are current. todo.md already surfaces this
      under Out of Scope for user decision. Not a blocker.
      Deferred: user to decide whether to add a user-facing README HTTP-mode/Entra section as a separate doc task.
- [x] nit — design.md §3 `createCallbackHandler` signature omitted the `logger` param — design.md Component Breakdown §3
      Shipped signature is `createCallbackHandler(codeStore, entraConfig, logger)` (Task 3.6 anticipated it).
      Resolved (final pass): design.md §3 updated to include `, logger` with the rationale.
- Verified clean: `.env.example`, `.specs/REPO.md` (names all new files, cites ADR-0004, no forward-proxy language),
  ADR-0004 Draft (accurately matches shipped code; promotion to Accepted is Task 6.3, pending user sign-off),
  PRD/GLOSSARY, and the three new files' doc-comments.

### dependency-reviewer Review (final pass)
**Result:** PASSED
- No findings. `git diff main...HEAD -- package.json package-lock.json` is empty — this feature added/removed/
  version-changed ZERO dependencies (reuses `node:crypto`, existing `redis` `GETDEL`, `@modelcontextprotocol/sdk`,
  `express`). Installed `@modelcontextprotocol/sdk` 1.29.0 is the current latest stable.
- Pre-existing, out-of-scope (recorded for awareness only, not introduced by this feature): repo-wide dependency
  drift exists (`redis` 4.7.1→6.1.0, `xero-node` 13→18, `zod` 3→4, `pino` 9→10, `typescript` 5.9→6, etc.). None
  touched by this PR; does not block this feature.

## Reviewer Selection (iteration 1)

Ran:     security-reviewer, staff-reviewer, maintainability-reviewer, performance-reviewer, duplication-reviewer, test-quality-reviewer
Skipped: documentation-reviewer (iterations=[final]; defers to final pass), dependency-reviewer (iterations=[final] and no package manifest changed)

## security-reviewer Review
**Result:** WARNINGS

### Findings
- [x] should-fix — Entra authorization code logged in plaintext via full-URL access logging — src/http/logging.ts:19-21
      `createHttpLogger`'s `req` serializer logs full `req.url` at `info` for every request, including
      `GET /auth/callback?code=<entra_code>&state=<txn_id>` — writing the live Entra authorization code
      to logs on every callback. Runs counter to AC 8's "no ... written to logs" (the callback handler's
      own `logger.warn` calls correctly omit it, but the access logger does not). Exploitability is reduced
      (the code is bound to a server-side PKCE verifier that is never logged, Redis-only, short TTL), but it
      is still avoidable exposure of a live authorization credential — newly introduced by this feature's route.
      Recommendation: strip/redact the query string for logged URLs (e.g. log `req.url.split("?")[0]`), or a
      pino `redact`/serializer stripping `code`/`state`.
      Resolved: `src/http/logging.ts`'s `req` serializer now logs `req.url?.split("?")[0]` (path only,
      query string stripped) with a comment explaining why — applies globally to all routes. Verified
      `src/__tests__/http/logging.test.ts` still passes unmodified (its assertions use `/test` with no
      query string, so behaviour is unaffected).
- [ ] nit — `/auth/callback` has no rate limiting, unlike the SDK's `/authorize` and `/token` — src/http/server.ts:127-129
      Mounted via a bare `app.get` with no `express-rate-limit`. Impact is low (a valid `state` requires
      guessing a 256-bit `txn_id` before any outbound Entra fetch), but it is an inconsistency worth closing
      for defense-in-depth as the auth surface grows. (Nit — recorded for awareness, not auto-fixed.)

## staff-reviewer Review
**Result:** PASSED

### Findings
No findings. Confirmed: org code cleanly isolated under `src/http/`; subclass reuses inherited
`exchangeRefreshToken`(super)/`verifyAccessToken`/`revokeToken`/`clientsStore` correctly; all four overrides
are valid subtype signatures; `EntraProxyOAuthServerProvider` dead code fully removed; the cloud-infra Entra
redirect change is correctly out-of-scope and documented; both authorized deviations (`logger` param,
`CallbackEntraConfig`) are sound; ADR-0002/0003/0004 alignment holds.

## maintainability-reviewer Review
**Result:** WARNINGS

### Findings
- [x] should-fix — Unnecessary async IIFE for a plain try/catch — src/http/auth/callback-handler.ts:65-77
      The fetch/parse is wrapped in an immediately-invoked async arrow purely to keep `tokens` a `const`,
      swallowing the error into `undefined` and deferring the log+502 to a separate `if (!tokens)` block. A
      reader must spot the trailing `()`, recognise the IIFE, and jump down to see what falsy-tokens means —
      exactly the micro-cleverness the design's LOC note warned against. Replace with a plain
      `try { tokens = ... } catch { log + 502 + return }` (`let tokens`), keeping the failure branch next to
      the code that fails. No loss of type safety.
      Resolved: replaced the async IIFE with `let tokens: OAuthTokens;` and a plain `try { ... } catch { ... }`,
      moving the log+502+return directly into the `catch` block next to the code that can fail. Type safety
      preserved via `OAuthTokens` from the SDK's auth module; `tsc` remains clean.
- [x] nit — `code ?? ""` silently defaults a required field — src/http/auth/callback-handler.ts:58
      A callback with no `error` and no `code` proceeds to the Entra POST with `code=""`, relying on Entra's
      4xx → generic 502. Safe, but FR-7's fail-loud is satisfied incidentally. Recommendation: add `code` to the
      missing-param guard for an explicit 400, or a one-line comment noting the fallthrough is intentional.
      Resolved (iteration 2): a clarifying comment was added above the token-request body noting the missing-`code`
      case intentionally falls through to the upstream-failure 502 path (no control-flow change → no test churn).

## performance-reviewer Review
**Result:** PASSED

### Findings
No findings. Verified the bounded per-flow Redis op counts match design (1 SET authorize; 1 GET + 1 DEL + 1 SET
callback; 1 atomic GETDEL token exchange; 1 acknowledged peek GET). No in-memory state (all Redis + TTLs,
self-cleaning), single `fetch` POST per flow, no N+1 / loops / blocking sync I/O.

## duplication-reviewer Review
**Result:** PASSED

### Findings
No findings. `RedisOAuthCodeStore` shares only a pattern (not extractable logic) with `RedisOAuthClientsStore`;
Entra-identity substitution is not duplicated (refresh via `super` vs callback `fetch` body, both reading the
single `entraConfig`); fully-qualified scope `api://<clientId>/mcp` is single-sourced at `build.ts:77`.

## test-quality-reviewer Review
**Result:** PASSED_WITH_WARNINGS

### Findings
- [x] must-fix — Deleted test file `src/__tests__/http/auth/entra-proxy-provider.test.ts` — flagged by test-integrity protocol
      Dismissed: intentional and justified per AC 6 / Example 13 (the `EntraProxyOAuthServerProvider` class it
      tested was deleted entirely; guards #4/#5 no longer apply under the uniform confidential flow). Superseded
      by `bridge-provider.test.ts`. No code change needed.
- [x] should-fix — Server PKCE pair not mathematically verified — src/__tests__/http/auth/bridge-provider.test.ts:104
      `code_challenge` sent to Entra is asserted merely `toBeTruthy()`, never `=== base64url(sha256(serverCodeVerifier))`.
      A wrong-input hash or accidentally sending the client challenge would still pass. Closes an AC 8
      "two independent PKCE pairs" verification gap.
      Resolved (orchestrator — build agent is barred from tests): now asserts
      `params.get("code_challenge") === createHash("sha256").update(record.serverCodeVerifier).digest("base64url")`.
- [x] should-fix — Stored server-code record not asserted to contain the Entra tokens — src/__tests__/http/auth/callback-handler.test.ts:118
      The record written to `codeStore.set("code", ...)` is asserted for challenge/redirect/TTL but not `tokens` —
      the most critical payload (what `exchangeAuthorizationCode` returns to the client). Assert it per Example 3.
      Resolved (orchestrator): happy-path test now asserts `record["tokens"]` deep-equals the full Entra token set
      (access_token/token_type/refresh_token/expires_in).
- [x] nit — `global.fetch` assigned without `vi.spyOn`, not restored between tests — bridge-provider.test.ts:186 (also callback-handler.test.ts)
      `global.fetch = vi.fn(...)` isn't restored by `vi.restoreAllMocks()`. Low risk (per-file worker isolation),
      but `vi.spyOn(globalThis, "fetch")` makes restoration automatic.
      Resolved (orchestrator): bridge-provider.test.ts now uses `vi.spyOn(globalThis, "fetch")` with an
      `afterEach(vi.restoreAllMocks)` hook. (callback-handler.test.ts already had a `beforeEach(vi.restoreAllMocks)`.)

## Summary
Strong, disciplined execution of the approved design. Three reviewers passed clean (staff, performance,
duplication). The bridge honours every architectural decision: the `RedisOAuthCodeStore` is the four generic
namespace-typed methods (a genuine deep module), the subclass overrides only the three intended methods and
inherits the rest, the `new URL()` redirect and atomic `GETDEL` single-use are correct, `InvalidGrantError`
(not `ServerError`) is thrown, and no dead code remains. Findings are all should-fix or nit — no genuine
must-fix (the test-integrity "must-fix" is a self-acknowledged, justified deletion). Iteration 2 addresses:
one real security exposure (Entra `code` in access logs), one readability regression (async IIFE), and two
additive test-coverage completions the design's Examples already imply (server-PKCE math, tokens-in-record).
