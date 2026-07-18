# Review: Response Formatting Fixes
**Layer:** backend
**Feature:** 004-response-formatting-fixes
**Date:** 2026-07-06
**Iteration:** iteration 2 (final pass)
**Status:** PASSED_WITH_WARNINGS (in-scope) — dependency-reviewer flagged pre-existing, out-of-scope repo drift (deferred by owner decision; not recorded, not a blocker for this feature)
**Baseline:** `git merge-base HEAD main` = d8f94f4

## Reviewer Selection (iteration 2, final pass)

Ran:     staff-reviewer, maintainability-reviewer, test-quality-reviewer (re-check iter-1 findings), documentation-reviewer, dependency-reviewer (final-only)
Skipped: duplication-reviewer, security-reviewer, performance-reviewer (clean from iteration 1; skip-when-clean)

Iteration-2 outcome: all iteration-1 should-fixes RESOLVED (design.md doc gap; 3 test-quality items). documentation PASSED. dependency returned FAILED, but 100% of its findings are pre-existing repo-wide version drift with zero manifest changes in this feature — carved out and deferred by owner decision (not recorded as a backlog item), not fixed here.

## Reviewer Selection (iteration 1)

Ran:     staff-reviewer, maintainability-reviewer, duplication-reviewer, security-reviewer, performance-reviewer, test-quality-reviewer
Skipped: dependency-reviewer (iterations=[final], not final pass); documentation-reviewer (iterations=[final], not final pass)

## staff-reviewer Review
**Result:** PASSED (iteration 2)

### Findings
- [x] should-fix — design.md doc gap: non-prefixed string parse branch — `.specs/004-response-formatting-fixes/backend/design.md`:§Component Breakdown / `src/helpers/format-date.ts`:9-17
      design.md specified `new Date(value).toISOString().slice(0,10)` for `formatDate`'s "other string" branch, but the implementation correctly uses local `Date` components (`getFullYear/getMonth/getDate`) to avoid a UTC day-shift on strings like `"28 June 2026"`.
      Recommendation: Update design.md's "Other string input" bullet to describe the local-component read-back and why `toISOString()` was rejected. Documentation fix — leave code as-is.
      Resolved (iteration 2): design.md §Component Breakdown "Other string input" bullet rewritten to describe the local-component read-back + tz rationale; staff-reviewer re-check confirmed PASSED.

Verified separately: all ~45 date sites pick formatDate vs formatDateTime correctly per reference.md; all Group A formats match repo precedents.

## maintainability-reviewer Review
**Result:** PASSED (iteration 2) — one cosmetic nit accepted-as-is by owner

### Findings
- [x] should-fix — design.md not updated to reflect the (correct) date-parse deviation — `src/helpers/format-date.ts`:12-17 vs `design.md` §Component Breakdown
      Duplicate of the staff-reviewer finding above (same root: design.md documented the `toISOString()` approach; the code correctly uses local components — confirmed with `TZ=Pacific/Kiritimati`). Documentation-debt fix, not a code fix.
      Recommendation: Update design.md's "Other string input" bullet; leave code as-is.
      Resolved (iteration 2): design.md updated; maintainability re-check confirmed PASSED.
- [x] nit — duplicate "tracking options" header — `src/tools/list/list-tracking-categories.tool.ts`:41-44
      Output shows `Found N tracking options:` immediately followed by `Tracking Options:`. todo.md-specified artifact; satisfies AC 6 but reads redundantly.
      Recommendation: Drop the second `Tracking Options:` label or fold the count in (`Tracking Options (N):`). Cosmetic.
      Resolved (post-review): an external reviewer of PR #8 independently confirmed the double header; the redundant `Tracking Options:` prefix was dropped, keeping the `Found N tracking options:` count line and the `No tracking options` fallback.
- [x] nit — incidental whitespace/newline churn across ~12 date-site diffs — e.g. `list-credit-notes.tool.ts`, `list-quotes.tool.ts`, `create-invoice.tool.ts`
      Trailing-whitespace trims and final-newline additions inflate some diffs beyond the one-line date wrap. Genuine cleanup, not complexity.
      Dismissed (iteration 2): no action needed; genuine cleanup. To be noted in the PR description.

## duplication-reviewer Review
**Result:** PASSED

### Findings
No findings. `format-date.ts` is the correct DRY extraction of ~45 inline sites; no pre-existing date helper existed; `formatTrackingOption` (TrackingOption) vs the line-item tracking render (LineItemTracking) are genuinely distinct; `get-external-link.ts` deletion confirmed with zero remaining references.

## security-reviewer Review
**Result:** PASSED

### Findings
No findings. Rendering `link.url` raw (after deleting `get-external-link.ts`) introduces no injection risk — MCP `text` content is plain JSON text, not an HTML/script context; the removed `encodeURIComponent` was never a security control. Consistent with the tool's existing raw-rendering of other free-text Xero fields. (Informational: a permissive Markdown-rendering client auto-linkifying a `javascript:`/`data:` URL from org config is a pre-existing, client-side, out-of-scope consideration that applies equally to all free-text fields.)

## performance-reviewer Review
**Result:** PASSED

### Findings
No findings. Pure single-pass string/`Date` operations over already-fetched arrays; no I/O, no per-item network/DB, no nested-loop amplification. Matches design's "negligible" characterization; regex fast-path correctly retained for tz-correctness (not perf).

## test-quality-reviewer Review
**Result:** PASSED (iteration 2)

Test integrity: 2 files, 15 functions at iteration-1 baseline → 18 at HEAD (3 added, 0 deleted/weakened/regressed). Coverage strengthened.

### Findings
- [x] should-fix — missing test: `formatDate` with bare `YYYY-MM-DD` string — `src/helpers/__tests__/format-date.test.ts`
      Design test plan lists 8 format-date cases; 7 implemented. The bare `"2022-07-22"` slice-passthrough boundary case was untested.
      Recommendation: Add `expect(formatDate("2022-07-22")).toBe("2022-07-22")`.
      Resolved (iteration 2): added `test_bare_date_string_returns_same_date`.
- [x] should-fix — tz-safety test can't catch the regression it guards — `src/helpers/__tests__/format-date.test.ts`
      The existing assertion passed under BOTH the correct and a buggy `toISOString().slice(0,10)` impl when CI runs at UTC+0. It asserted output, not mechanism.
      Recommendation: Add a near-midnight tz-boundary case that diverges under Date-construction in UTC-positive zones. Consider an analogous guard for the parse branch.
      Resolved (iteration 2): added `test_date_prefixed_string_is_tz_immune` and `test_non_prefixed_parse_is_tz_immune`, both forcing `process.env.TZ = "Pacific/Kiritimati"` (UTC+14) with try/finally restore — test-quality re-check confirmed they deterministically fail under the buggy impl and pass under the correct one, regardless of CI timezone.
- [x] should-fix — missing positive assertions for `description`/`accountCode` fallbacks — `src/helpers/__tests__/format-line-item.test.ts`
      The fallback test covered `itemCode`/`taxType` positively but only checked `description`/`accountCode` via `not.toContain("undefined")`.
      Recommendation: Add `toContain("No description")` and `toContain("No account code")`.
      Resolved (iteration 2): both positive assertions added.
- [x] nit — Example 13 (list-quotes consistency) has no integration test — Dismissed: no action needed; behavior covered by helper-level tests + Phase 5 greps, per the pure-function testing strategy.
- [x] nit — ACs 6-9 (join/payment-terms/scalar/external-link tool edits) have no unit test — Dismissed: no action needed; mechanical tool-file edits verified by Phase 5 greps, by design.

## documentation-reviewer Review (iteration 2, final pass)
**Result:** PASSED

### Findings
No findings. Spec files (requirements/design/todo/reference/review), PRD feature-004 entry, GLOSSARY "Formatter" addition, and backlog 005 all verified accurate and internally consistent; design.md date-helper description matches `format-date.ts`; REPO.md/README need no update for a rendering-only change. (Informational, pre-existing/out-of-scope: REPO.md says `dist/` is committed, but `.gitignore` has excluded it since the upstream base commit — unrelated to this feature.)

## dependency-reviewer Review (iteration 2, final pass)
**Result:** FAILED — but entirely OUT OF SCOPE for this feature (deferred)

This feature changed **no** manifest (`package.json`/`package-lock.json` unchanged vs main — confirmed by the reviewer). Every finding below is **pre-existing repo-wide version drift**, not introduced by 004, and each is a breaking major upgrade requiring its own risk assessment. Per owner decision these are **deferred by owner decision (not recorded as a backlog item)** and are NOT a blocker for merging 004.

### Findings (deferred by owner decision)
- [x] must-fix (deferred) — 11 major-version-behind deps: `dotenv` 16→17, `pino` 9→10, `pino-http` 10→11, `redis` 4→6, `xero-node` 13→19, `zod` 3→4, `@eslint/js` 9→10, `@types/node` 22→26, `eslint` 9→10, `globals` 16→17, `typescript` 5.9→7.0.
      Deferred (iteration 2): pre-existing drift, unrelated to this rendering-only feature; deferred by owner decision (not recorded). Not fixed in 004.
- [x] should-fix (deferred) — 5 minor-behind: `@modelcontextprotocol/sdk`, `axios`, `prettier`, `shx`, `typescript-eslint`.
      Deferred (iteration 2): owner decision, not recorded.
- [x] nit (deferred) — 4 patch-behind: `openid-client`, `@types/supertest`, `@vitest/coverage-v8`, `vitest`.
      Deferred (iteration 2): owner decision, not recorded.

## Summary
**Iteration 2 (final pass): all in-scope findings resolved.** Every iteration-1 should-fix is fixed and re-confirmed by the respective reviewer: the design.md date-parse documentation gap (staff + maintainability → PASSED) and the three test-quality items — bare-date case, two forced-TZ regression guards, and positive fallback assertions (test-quality → PASSED, 15→18 tests). documentation → PASSED. duplication/security/performance stayed clean from iteration 1. Two cosmetic maintainability nits were accepted/dismissed by owner decision. The implementation is minimal-LOC, matches repo precedents verbatim, and applies formatDate/formatDateTime correctly per reference.md across all ~45 sites; build + lint + full test suite (140/140) pass.

**The only non-passing reviewer is dependency-reviewer (FAILED), and it is fully out of scope:** this feature changed no manifest; all 20 findings are pre-existing repo-wide version drift (11 major, 5 minor, 4 patch), each a breaking upgrade requiring its own assessment. These are deferred by owner decision (not recorded as a backlog item) and are not a blocker for merging 004. **In-scope verdict: PASSED_WITH_WARNINGS — ready for commit** (owner confirmed the dependency deferral).
