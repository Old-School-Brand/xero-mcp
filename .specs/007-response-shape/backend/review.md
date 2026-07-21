# Review: Response Shape
**Layer:** backend
**Feature:** 007-response-shape
**Date:** 2026-07-21
**Iteration:** iteration 2 (final pass)
**Status:** PASSED (all findings resolved, dismissed with rationale, or deferred to backlog with audit trail)

Baseline for change scope: `git merge-base HEAD main` (branch `feat/007-response-shape`).

## Reviewer Selection (iteration 2)

Ran:     maintainability-reviewer, test-quality-reviewer (each had an open finding from iteration 1)
Skipped: duplication-reviewer, performance-reviewer, security-reviewer, staff-reviewer (clean from prior iteration; staff/performance also iteration-gated), documentation-reviewer + dependency-reviewer (final-only; run in the final pass)

Iteration-2 results: maintainability-reviewer PASSED with no findings (verified all three fixes minimal and regression-free; re-assessed its nit and dismissed it as correctly deferred). test-quality-reviewer PASSED_WITH_WARNINGS (confirmed Example 10 now fully asserted and strictly additive; its double-invocation nit persists).

## Reviewer Selection (iteration 2 — final pass)

Ran:     documentation-reviewer, dependency-reviewer (iterations ["final"])
Skipped: all others (clean from prior iteration / iteration-gated)

## documentation-reviewer Review (final pass)
**Result:** PASSED

### Findings
No findings. All 13 documentation surfaces verified consistent with the implementation (~30 references checked): tool descriptions document the envelope and activeOnly default; REPO.md's feature-007 exception note matches the actual diff; ADR-0006 Accepted in both file and index; GLOSSARY/PRD/backlog annotations accurate; zero dangling references to deleted helpers.

## dependency-reviewer Review (final pass)
**Result:** FAILED (pre-existing repo-wide drift; dispositioned as out-of-scope for 007 — see resolutions)

### Findings
- [x] must-fix — xero-node ^13.3.0 vs latest 19.0.0 (6 majors) — package.json:41
      Resolved: deferred — pre-existing drift, not introduced by 007 (`git diff main -- package.json` is empty); reviewer's own note: "none should block this PR". Tracked in `.specs/backlog/dependency-refresh.md`; majors must ride upstream syncs per fork charter.
- [x] must-fix — typescript ^5.9.3 vs latest 7.0.2 — package.json:56
      Resolved: deferred — same disposition; tracked in `.specs/backlog/dependency-refresh.md`.
- [x] must-fix — zod pinned `3.25` (bare pin) vs latest 4.4.3 — package.json:42
      Resolved: deferred — same disposition; bare-pin intent flagged in the backlog item for verification.
- [x] should-fix — @modelcontextprotocol/sdk ^1.23.4 vs 1.29.0 (minor) — package.json:32
      Resolved: deferred to `.specs/backlog/dependency-refresh.md` (no manifest change belongs in this feature).
- [x] nit — vitest ^4.1.7 vs 4.1.10 (patch) — package.json:58
      Resolved: deferred, same backlog item.

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
- [x] nit — Cell value could theoretically collide with the hoisted `attributes` key — src/helpers/report-envelope.ts:54-63
      A column literally titled "attributes" would be overwritten by the hoisted attributes object. Unobserved in all 5 live reports; speculative.
      Recommendation: No action now; add a one-line guard only if such a column ever appears.
      Resolved: dismissed by maintainability-reviewer (iteration 2) — re-assessed as correctly deferred; the code comment documents the risk, and a guard would be defensive code for a never-observed case.

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
- [x] nit — Double invocation in unknown-rowType test — src/__tests__/helpers/report-envelope.test.ts:368
      `transformReport` runs twice (once in `not.toThrow`, once to capture), so `console.warn` fires twice and `toHaveBeenCalled()` is imprecise.
      Recommendation: Single call + `toHaveBeenCalledTimes(1)`.
      Resolved: polish pass (post final review) — collapsed to a single invocation and tightened to `toHaveBeenCalledTimes(1)`, exactly as recommended. Test-precision strengthening only; no assertion weakened.

## Summary

Clean first pass overall: implementation matches design exactly (RowType enum handled, dependency direction correct, minimal upstream diffs, dead code removed), 165/165 tests green, build and lint clean, and both credential redaction and performance commitments verified. Three should-fix items block a clean PASS: a trust-boundary guard on the new `where` handler parameter, a one-line ADR index status correction, and completing Example 10's contracted assertion in the accounts tool test. Two nits and one accepted info are recorded for awareness.

All three should-fix items resolved in the fix-mode pass on 2026-07-21 (see per-finding resolutions above). Remaining two nits left as-is per findings scope (nit severity, not addressed per fix-mode instructions).
