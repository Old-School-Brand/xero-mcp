# Review: Xero Usability — GL Access, Pagination & Session Persistence
**Layer:** backend
**Feature:** 005-xero-usability
**Date:** 2026-07-18
**Iteration:** iteration 2 (final pass)
**Status:** PASSED (all findings resolved)
**Baseline:** `git merge-base HEAD main`

## Reviewer Selection (iteration 1)

Ran:     staff-reviewer, maintainability-reviewer, duplication-reviewer, security-reviewer, performance-reviewer, test-quality-reviewer
Skipped: dependency-reviewer (no package manifest changed; `iterations: [final]`, not final), documentation-reviewer (`iterations: [final]`, not final)

## Reviewer Selection (iteration 2, final pass)

Ran:     staff-reviewer (re-verify), test-quality-reviewer (re-verify), documentation-reviewer (final), dependency-reviewer (final)
Skipped: maintainability-reviewer, duplication-reviewer, security-reviewer, performance-reviewer (all clean in iteration 1; skip-when-clean)

## staff-reviewer Review
**Result:** PASSED (iteration 2 — prior finding resolved)

### Findings
- [x] should-fix — UUID account comparison is case-sensitive while detection is case-insensitive — `src/handlers/list-xero-account-transactions.handler.ts:104-106`
      The UUID regex uses the `i` flag but the comparison was strict `line.accountID === account`; Xero returns lowercase GUIDs, so an uppercase-UUID input silently returned empty results (fail-loud violation).
      Recommendation: normalise both sides to lowercase; update the UUID test to a lowercase mock with uppercase input.
      Resolved: comparison now `line.accountID?.toLowerCase() === account.toLowerCase()` (handler); `test_accountUUID_matchesByAccountID` now passes uppercase input against a lowercase mock `accountID`, guarding the fix. Staff re-review confirmed PASSED.

## maintainability-reviewer Review
**Result:** PASSED

### Findings
No findings. Deep-module decomposition clean; `paginationHint` reused across all five tool files; `MAX_PAGES_PER_CALL` a single literal; YAGNI respected.

## duplication-reviewer Review
**Result:** PASSED

### Findings
No findings. All shared helpers reused; `paginationHint` called in all five tools with no inline logic; minified-JSON divergence from report tools deliberate and documented.

## security-reviewer Review
**Result:** PASSED

### Findings
No findings. Errors via `formatError` (no leakage); no injection surface (params used in local comparisons / as the `ifModifiedSince` SDK arg); zod validation at boundary; tenant-scoped as existing handlers; `offline_access` adds no new server-side secret handling.

## performance-reviewer Review
**Result:** PASSED

### Findings
No findings. Paging bounded by `MAX_PAGES_PER_CALL`; early-return on empty page; offset advances via `Math.max(...journalNumbers)` (no re-fetch); `ifModifiedSince` threaded through; `journalDate` normalised once per journal; `pageSize 100` = Xero max.

## test-quality-reviewer Review
**Result:** PASSED (iteration 2 — prior findings resolved). Coverage: 18/18 Examples, 7/8 ACs (AC 7 non-change by design). Test integrity clean (0 deleted/removed/weakened).

### Findings
- [x] should-fix — `journalDate` normalisation never exercised with a `Date` input — `src/__tests__/handlers/list-xero-account-transactions.test.ts`
      Resolved: added `wireDate` helper (a `Date` value in a `string`-typed field, reproducing xero-node's runtime) as the `journal()` factory default, plus dedicated `test_dateInput_normalisedToIsoDateString` asserting `row.date === "2026-06-15"` from a Date input.
- [x] should-fix — `fromDate`-omitted path not verified with matching journal lines — `src/__tests__/handlers/list-xero-account-transactions.test.ts`
      Resolved: added `test_fromDateOmitted_stillReturnsMatchingLines` (no fromDate, matching line on `631`, asserts `showing:1`) — guards the `!fromDate` prefix in `isWithinRange`.
- [x] nit — Example 17 (tool registration) had no test assertion — `src/__tests__/tools/tool-factory.test.ts`
      Resolved: added `expect(names).toContain("list-account-transactions")` to the read-tools test.

## documentation-reviewer Review
**Result:** PASSED_WITH_WARNINGS (final pass) — findings resolved by orchestrator before commit

### Findings
- [x] should-fix — README read-tool list omitted the new `list-account-transactions` tool — `README.md`
      Resolved: added `- \`list-account-transactions\`: Retrieve general-ledger lines for one account (Xero Journals feed, paginated by offset)` to the read-tools list.
- [x] should-fix — README "Required Scopes" list missing `accounting.journals.read` — `README.md`
      Resolved: added `accounting.journals.read  # general ledger (list-account-transactions)` to the granular read-scope block.
- [x] nit — design.md A1 step 5 didn't mention the case-normalisation fix — `.specs/005-xero-usability/backend/design.md`
      Resolved: added a clause noting UUID matches are case-insensitive (both sides lowercased).

Note (not a finding): backlog-file cleanup + OOM-evidence commit are pipeline commit-stage tasks, handled next.

## dependency-reviewer Review
**Result:** PASSED (final pass)

### Findings
No findings. `git diff main...HEAD -- package.json package-lock.json` empty; new files import only pre-existing deps (`xero-node`, `zod`, existing local helpers). No new packages, no undeclared imports.

## Post-review hardening (owner-requested, after a first-principles "did we overcomplicate?" review)

A follow-up staff + maintainability review questioned the whole approach (not the code). Consensus: workstreams B and C are model fork changes; workstream A's code is clean but is an interim GL tool superseded by feature 006. The one genuine liability identified — a reconciliation tool that can *silently* under-report — was hardened without deferring A:

- [x] GL envelope now carries `complete: boolean` + `warning: string|null` — `complete:false` (with an explanatory warning) whenever `fromDate` narrowing may omit journals. Incompleteness is now visible in the *response*, not just the tool description. (handler + tool description + specs updated; `test_completeFlag_reflectsFromDateNarrowing` added)
- [x] Added a pagination-hint integration test (`src/__tests__/tools/list-invoices.tool.test.ts`) guarding the five-tool `paginationHint` wiring from a silent upstream-merge regression (staff should-fix).

Test gate after hardening: build exit 0, 160/160 tests, lint exit 0.

## Summary
Two review iterations. Iteration 1: four of six reviewers clean (maintainability, duplication, security, performance); staff and test-quality raised low-risk should-fix items (a UUID case-sensitivity footgun and two test-coverage gaps + a nit). Iteration 2 (final pass): staff and test-quality re-reviewed and confirmed all resolved; dependency clean; documentation surfaced two README-staleness should-fix items and a design nit, all resolved before commit. No must-fix at any point. Independent test gate green throughout (build exit 0, 157/157 tests, lint exit 0). Feature is ready for commit.
