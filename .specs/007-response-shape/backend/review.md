# Review: Response Shape
**Layer:** backend
**Feature:** 007-response-shape
**Date:** 2026-07-21
**Iteration:** iteration 1
**Status:** PASSED_WITH_WARNINGS

Baseline for change scope: `git merge-base HEAD main` (branch `feat/007-response-shape`).

## Reviewer Selection (iteration 1)

Ran:     duplication-reviewer, maintainability-reviewer, performance-reviewer, security-reviewer, staff-reviewer, test-quality-reviewer
Skipped: documentation-reviewer (iterations [final], default=skip), dependency-reviewer (no manifest in change set; defers to final pass)

## duplication-reviewer Review
**Result:** PASSED

### Findings
- [x] info — Test helper `cell()` redefined in two test files — src/__tests__/tools/list-trial-balance.tool.test.ts:30 vs src/__tests__/helpers/report-envelope.test.ts:48
      Same-name fixture helpers with deliberately different signatures (tool test omits attributes).
      Recommendation: Accept duplication — extracting a 1-line shared fixture factory adds coupling for negligible benefit.
      Resolved: accepted by reviewer (info-level, no action required).

## maintainability-reviewer Review
**Result:** PASSED

### Findings
- [ ] nit — Cell value could theoretically collide with the hoisted `attributes` key — src/helpers/report-envelope.ts:54-63
      A column literally titled "attributes" would be overwritten by the hoisted attributes object. Unobserved in all 5 live reports; speculative.
      Recommendation: No action now; add a one-line guard only if such a column ever appears.

## performance-reviewer Review
**Result:** PASSED

### Findings
No findings. All design Performance Considerations verified implemented (O(1) replacer check; single-pass transform; server-side `where` filtering).

## security-reviewer Review
**Result:** WARNINGS

### Findings
- [x] should-fix — listXeroAccounts's `where` param has no safeguard against future caller-supplied filter strings — src/handlers/list-xero-accounts.handler.ts:7
      `where` threads straight into `getAccounts` as a raw Xero filter clause. Today the only caller passes one of two hardcoded literals (zod-boolean-driven), so no live injection path — but the handler boundary itself carries no guard rail for future callers.
      Recommendation: Constrain the parameter (closed union of pre-built clauses) or add an explicit trust-boundary comment/assertion at the handler so free-text is never wired in unnoticed.
      Resolved: added a private `AccountsWhereFilter` closed union type (`'Status=="ACTIVE"'` only) in src/handlers/list-xero-accounts.handler.ts, replacing the bare `string` parameter on both `listAccounts` and `listXeroAccounts`. Any future caller attempting to pass an arbitrary string is now a compile-time error, making the illegal state unrepresentable per the repo's "Prove It in CI" principle.

Verified intact: `REDACTED_KEYS` aPIKey redaction still runs first and unconditionally in the replacer (regression-tested); no user-controlled string reaches the Xero `where` clause.

## staff-reviewer Review
**Result:** SHOULD_FIX

### Findings
- [x] should-fix — ADR-0006 status in README.md index still says "Draft" while ADR file says "Accepted" — .specs/adr/README.md:39
      Two sources of truth disagree on an accepted architectural decision; the index is what the pipeline reads first.
      Recommendation: Change the ADR-0006 row in `.specs/adr/README.md` from `Draft` to `Accepted`.
      Resolved: updated the ADR-0006 row in .specs/adr/README.md to `Accepted`, matching the ADR file's own status header.

## test-quality-reviewer Review
**Result:** PASSED_WITH_WARNINGS

Test integrity: 4 files checked, 8 → 27 test functions, zero removed/weakened/regressed. Coverage: 17/17 design Examples, 7/7 ACs, 0 stubs.

### Findings
- [x] should-fix — Example 10 Then clause partially asserted — src/__tests__/tools/list-accounts.tool.test.ts:29
      Example 10 contracts two assertions: (1) handler called with `where: 'Status=="ACTIVE"'` — asserted; (2) response envelope `showing` equals mock result length — NOT asserted (return value discarded).
      Recommendation: Parse the handler's returned content block and assert `showing` matches the mock result length, closing Example 10's full Then clause. (Test-strengthening only — adds an assertion, changes none.)
      Resolved: `test_noArgs_callsHandlerWithActiveOnlyWhereClause` now captures the handler's return value, mocks a 2-element `listXeroAccounts` result, parses `content[0].text`, and asserts `parsed.showing` equals the mock result length (2). No existing assertion was altered.
- [ ] nit — Double invocation in unknown-rowType test — src/__tests__/helpers/report-envelope.test.ts:368
      `transformReport` runs twice (once in `not.toThrow`, once to capture), so `console.warn` fires twice and `toHaveBeenCalled()` is imprecise.
      Recommendation: Single call + `toHaveBeenCalledTimes(1)`.

## Summary

Clean first pass overall: implementation matches design exactly (RowType enum handled, dependency direction correct, minimal upstream diffs, dead code removed), 165/165 tests green, build and lint clean, and both credential redaction and performance commitments verified. Three should-fix items block a clean PASS: a trust-boundary guard on the new `where` handler parameter, a one-line ADR index status correction, and completing Example 10's contracted assertion in the accounts tool test. Two nits and one accepted info are recorded for awareness.

All three should-fix items resolved in the fix-mode pass on 2026-07-21 (see per-finding resolutions above). Remaining two nits left as-is per findings scope (nit severity, not addressed per fix-mode instructions).
