# Todo: 007-response-shape

**Layer:** backend
**Status:** Pending
**Last updated:** 2026-07-20

Ordered, file-level, full-tdd (test first per task, then implement to green). Each task references
the design's `## Examples` numbers for its test cases.

## Phase 1 — Foundation: empty-value omission in `json-response.ts`

- [ ] **Task 1.1** — Extend the `jsonResponse` replacer to drop `""`/`null`, keep `0`/`false`
  - File(s): `src/helpers/json-response.ts`, `src/__tests__/helpers/json-response.test.ts`
  - What to do: In the replacer function passed to `JSON.stringify` inside `jsonResponse`, add
    `if (v === "" || v === null) return undefined;` ahead of/alongside the existing
    `REDACTED_KEYS.has(key)` check. No other logic changes — `listResponse` is unaffected because it
    delegates to `jsonResponse`.
  - Given/When/Then: Given an object `{ Account: "Sales (200)", Debit: "", Credit: "5000.00", YTDDebit: "" }`, when serialized through `jsonResponse`, then the parsed JSON has only `Account` and `Credit` keys.
  - Acceptance: New test cases pass; `npm run test -- json-response` green; no existing `json-response.test.ts` case regresses.
  - Depends on: (none)
  - Examples: Example 2, Example 4

- [ ] **Task 1.2** — Assert `0`/`false` survive omission
  - File(s): `src/__tests__/helpers/json-response.test.ts`
  - What to do: Add a case serializing `{ name: "Petty Cash", balance: 0, hasAttachments: false, code: "" }` and asserting the parsed result equals `{ name: "Petty Cash", balance: 0, hasAttachments: false }` (falls out of the same replacer change as Task 1.1; kept as its own task because it is a separate Given/When/Then and a distinct regression risk — a naive `!v` check would wrongly drop `0`/`false`).
  - Given/When/Then: Given `{ name: "Petty Cash", balance: 0, hasAttachments: false, code: "" }`, when serialized through `jsonResponse`, then the result equals `{ name: "Petty Cash", balance: 0, hasAttachments: false }`.
  - Acceptance: `npm run test -- json-response` green.
  - Depends on: Task 1.1
  - Examples: Example 3

- [ ] **Task 1.3** — Assert `null` and empty-string are both omitted (items-shaped fixture)
  - File(s): `src/__tests__/helpers/json-response.test.ts`
  - What to do: Add a case serializing `{ name: "Widget", quantityOnHand: null, purchaseDescription: "" }` and asserting the parsed result equals `{ name: "Widget" }`.
  - Given/When/Then: Given `{ name: "Widget", quantityOnHand: null, purchaseDescription: "" }`, when serialized through `jsonResponse`, then the result equals `{ name: "Widget" }`.
  - Acceptance: `npm run test -- json-response` green.
  - Depends on: Task 1.1
  - Examples: Example 4

## Phase 2 — Report envelope transformer + `reportResponse`

- [ ] **Task 2.1** — `transformReport`: header fields + columns (Header row, empty-title-as-"label", duplicate-title suffixing)
  - File(s): `src/helpers/report-envelope.ts` (new), `src/__tests__/helpers/report-envelope.test.ts` (new)
  - What to do: Create `report-envelope.ts` with a `transformReport(report: ReportWithRow): ReportEnvelope` stub that: extracts `report` from `reportName`, `date` from `reportDate` via `formatDate`, `updatedAt` from `updatedDateUTC` via `formatDateTime`; finds the top-level `ReportRows` with `rowType === "Header"` and builds `columns` from its `cells[].value`, mapping `""` to `"label"` and suffixing duplicate titles `" (2)"`, `" (3)"`, ...; returns `sections: []` (sections themselves are built in later tasks). Define the `ReportEnvelope`/`ReportSection`/`ReportDataRow` types from design.md's Data Model section in this file.
  - Given/When/Then: Given a mock `ReportWithRow` with `reportName: "Trial Balance"`, `reportDate: "20 July 2026"`, and a Header row with cells `["Account", "", "Debit", "Credit"]`, when `transformReport` runs, then it returns `columns: ["Account","label","Debit","Credit"]` and `report: "Trial Balance"`.
  - Given/When/Then (duplicate titles): Given a Header row with cells `["Account", "31 Jul 2026", "31 Jul 2026"]` and a Row with cells `["Sales", "100.00", "90.00"]`, when `transformReport` runs, then `columns` is `["Account","31 Jul 2026","31 Jul 2026 (2)"]` and the row carries both `"31 Jul 2026":"100.00"` and `"31 Jul 2026 (2)":"90.00"` (no silent overwrite).
  - Acceptance: `npm run test -- report-envelope` green for the columns/header cases.
  - Depends on: (none — new file; only depends on Phase 1 being mergeable, not executing before it)
  - Examples: Example 1 (columns portion only; full single-block assertion comes in Task 3.2), Example 16

- [ ] **Task 2.2** — `transformReport`: Section rows, cell-to-column-keyed-object, attribute hoist/dedup
  - File(s): `src/helpers/report-envelope.ts`, `src/__tests__/helpers/report-envelope.test.ts`
  - What to do: Walk top-level `Section` rows' nested `rows`. For each `rowType === "Row"`, build a `ReportDataRow` keyed by column title (index-aligned to `columns`), skipping cells with empty/missing `value`. Collect every cell's non-empty `ReportAttribute`s into one deduplicated `attributes: {id: value}` object per row (first-wins on `id` collision), attached only when non-empty.
  - Given/When/Then: Given a Row with 5 cells — cell 0 has `attributes: [{id:"account", value:"0aa0e7a2-xxx"}]`; cells 1-4 each have `[{id:"account", value:"0aa0e7a2-xxx"}, {id:"toDate", value:"2/28/2026"}]`; cells 2-4 also have `{id:"fromDate", value:""}` — when `transformReport` processes the row, then it has exactly one `attributes` object equal to `{"account":"0aa0e7a2-xxx","toDate":"2/28/2026"}` and no `fromDate` key.
  - Acceptance: `npm run test -- report-envelope` green.
  - Depends on: Task 2.1
  - Examples: Example 5

- [ ] **Task 2.3** — `transformReport`: attribute id collision is first-wins
  - File(s): `src/helpers/report-envelope.ts`, `src/__tests__/helpers/report-envelope.test.ts`
  - What to do: Verify (or adjust) the dedup logic from Task 2.2 so that when two cells in the same row carry the same attribute `id` with different `value`s, the first cell processed wins.
  - Given/When/Then: Given a Row with 2 cells — cell 0 has `{id:"account", value:"aaa"}`, cell 1 has `{id:"account", value:"bbb"}` — when `transformReport` processes the row, then `attributes.account` is `"aaa"`.
  - Acceptance: `npm run test -- report-envelope` green.
  - Depends on: Task 2.2
  - Examples: Example 9

- [ ] **Task 2.4** — `transformReport`: verbatim cell values, no numeric coercion
  - File(s): `src/helpers/report-envelope.ts`, `src/__tests__/helpers/report-envelope.test.ts`
  - What to do: Assert (no production code change expected beyond what Task 2.2 already does — this task exists to lock the "never parse" contract with an explicit regression test) that cell values pass through as strings untouched.
  - Given/When/Then: Given a Row where cell 0 (column "Account") has value `"123"` and cell 1 (column "Debit") has value `"0.00"`, when `transformReport` processes the row, then the row object contains `"Account":"123"` and `"Debit":"0.00"` as strings.
  - Acceptance: `npm run test -- report-envelope` green.
  - Depends on: Task 2.2
  - Examples: Example 13

- [ ] **Task 2.5** — `transformReport`: `SummaryRow` becomes the section's `total`
  - File(s): `src/helpers/report-envelope.ts`, `src/__tests__/helpers/report-envelope.test.ts`
  - What to do: In the Section-walking logic, route nested rows with `rowType === "SummaryRow"` to the section's `total` (same cell-to-object transform as Task 2.2) instead of appending to `rows`.
  - Given/When/Then: Given a Section "Bank" with one Row and one SummaryRow (cells `["Total Bank", "10000.00"]`, empty-title first column), when `transformReport` processes the section, then the section has `total` with `label: "Total Bank"` and `total` is not present in `rows`.
  - Acceptance: `npm run test -- report-envelope` green.
  - Depends on: Task 2.2
  - Examples: Example 6

- [ ] **Task 2.6** — `transformReport`: label-only sections and computed rows in empty-title sections
  - File(s): `src/helpers/report-envelope.ts`, `src/__tests__/helpers/report-envelope.test.ts`
  - What to do: Ensure a `Section` with no nested data rows produces `{ title }` only (no `rows`/`total` keys ever set — do not default to `[]`/`{}`), and that a `Section` with `title: ""` containing an ordinary Row (e.g. "Net Assets") serializes with the row inside `rows`, not as `total`, and no `title` key (the empty string is dropped by the Phase 1 replacer, not by the transformer).
  - Given/When/Then (label-only): Given a Section with `title: "Assets"` and no nested `rows`, when `transformReport` processes it, then the section appears as `{"title":"Assets"}` (no `rows` key, no `total` key).
  - Given/When/Then (computed row): Given a report whose Header cells are `["", "Amount"]` and a Section `""` with a Row `["Net Assets", "500000.00"]`, when `transformReport` processes the section, then it serializes as `{"rows":[{"label":"Net Assets","Amount":"500000.00"}]}`.
  - Acceptance: `npm run test -- report-envelope` green; both cases covered in the same task (same code path, same file).
  - Depends on: Task 2.2, Task 2.5
  - Examples: Example 7, Example 8

- [ ] **Task 2.7** — `transformReport`: empty report (Section present, zero data rows)
  - File(s): `src/helpers/report-envelope.ts`, `src/__tests__/helpers/report-envelope.test.ts`
  - What to do: Confirm a `Section` with `title: "Revenue"` and `rows: []` (present-but-empty array on the Xero side) produces `{"title":"Revenue"}` with no `rows` key in the envelope (the transformer omits the key rather than emitting `"rows":[]`).
  - Given/When/Then: Given a `ReportWithRow` with a Header row and one Section `title: "Revenue"`, `rows: []`, when `transformReport` processes it, then `sections` is `[{"title":"Revenue"}]`.
  - Acceptance: `npm run test -- report-envelope` green.
  - Depends on: Task 2.6
  - Examples: Example 12

- [ ] **Task 2.8** — Unknown `rowType` at top level and nested: `console.warn` + skip
  - File(s): `src/helpers/report-envelope.ts`, `src/__tests__/helpers/report-envelope.test.ts`
  - What to do: Add the fail-loud-but-non-crashing guard from design.md's Error Handling table: a top-level or nested row with an unrecognised `rowType` (not `Header`/`Section`/`Row`/`SummaryRow`) is skipped and logged via `console.warn`, not thrown.
  - Given/When/Then: Given a `ReportWithRow` whose top-level `rows` includes one entry with an unrecognised `rowType`, when `transformReport` processes it, then that entry is absent from `sections`, `console.warn` was called once, and no exception is thrown.
  - Acceptance: `npm run test -- report-envelope` green (spy on `console.warn`).
  - Depends on: Task 2.1
  - Examples: (none numbered in design.md — covers the Error Handling table's "Unknown rowType" row; include for completeness per design.md §Error Handling & Edge Cases)

- [ ] **Task 2.9** — `reportResponse(report)` composes `transformReport` + `jsonResponse`
  - File(s): `src/helpers/report-envelope.ts`, `src/__tests__/helpers/report-envelope.test.ts`
  - What to do: Add `export function reportResponse(report: ReportWithRow) { return jsonResponse(transformReport(report)); }`, importing `jsonResponse` from `./json-response.js`.
  - Given/When/Then: Given a minimal `ReportWithRow` with `reportName: "Balance Sheet"`, a Header row, and one empty Section `"Assets"`, when `reportResponse(report)` is called, then it returns `{ content: [{ type: "text", text: <minified JSON> }] }` where the parsed text has `report: "Balance Sheet"` and `sections: [{"title":"Assets"}]`.
  - Acceptance: `npm run test -- report-envelope` green; `npm run build` passes (verifies `ReportEnvelope`/`ReportWithRow` types line up).
  - Depends on: Task 2.1, Task 2.6, Task 2.7
  - Examples: Example 14

- [ ] **Task 2.10** — `transformReport`: top-level `SummaryRow` wrapped as a synthetic section `total`
  - File(s): `src/helpers/report-envelope.ts`, `src/__tests__/helpers/report-envelope.test.ts`
  - What to do: A top-level row with `rowType === RowType.SummaryRow` (outside any Section — structurally possible, unobserved in the 5 live reports) is wrapped in a synthetic section (`title: ""`) with the row as `total`, so the data is never dropped and no warning fires for a known rowType.
  - Given/When/Then: Given a `ReportWithRow` whose top-level `rows` contain a Header and one `SummaryRow` with cells `["Grand Total", "999.00"]`, when `transformReport` processes it, then `sections` contains one entry whose `total` has `label: "Grand Total"` and no `rows` key; `console.warn` is not called.
  - Acceptance: `npm run test -- report-envelope` green.
  - Depends on: Task 2.5, Task 2.8
  - Examples: Example 17

## Phase 3 — Convert the 5 report tools to `reportResponse`

- [ ] **Task 3.1** — `list-trial-balance.tool.ts`: replace 4 content blocks with `reportResponse`, update description
  - File(s): `src/tools/list/list-trial-balance.tool.ts`, `src/__tests__/tools/list-trial-balance.tool.test.ts` (new)
  - What to do: Write the test first (mirroring `list-invoices.tool.test.ts`'s `vi.hoisted` mock pattern): mock `listXeroTrialBalance`, invoke the tool, assert a single content block whose parsed JSON matches the report envelope shape. Then edit the tool: remove the `formatDate`/`formatDateTime`-driven prose blocks and the pretty-printed `JSON.stringify(trialBalanceReport.rows, null, 2)` block; success branch becomes `return reportResponse(trialBalanceReport);` (guard: keep the existing `response.error !== null` error branch's text output unchanged). Remove now-unused `formatDate`/`formatDateTime` imports; add `import { reportResponse } from "../../helpers/report-envelope.js";`. Update the tool's `description` string to mention the report envelope shape (`report`, `date`, `updatedAt`, `columns`, `sections`).
  - Given/When/Then: Given a mock `ReportWithRow` with `reportName: "Trial Balance"`, `reportDate: "20 July 2026"`, one Header row with cells `["Account", "", "Debit", "Credit"]`, one Section "Revenue" with one Row, when `list-trial-balance` tool is called, then the response has exactly 1 content block, its text starts with `{"report":"Trial Balance"` and contains no `\n` characters, and `columns` is `["Account","label","Debit","Credit"]`.
  - Acceptance: New test green; `npm run test` full suite green; `npm run build` green.
  - Depends on: Task 2.9
  - Examples: Example 1

- [ ] **Task 3.2** — Tool description documents the envelope shape (dedicated assertion)
  - File(s): `src/__tests__/tools/list-trial-balance.tool.test.ts`
  - What to do: Add a assertion-only test case (no production change beyond what Task 3.1 already wrote) inspecting `ListTrialBalanceTool().description` for envelope-shape language (mentions of `sections`/`columns`).
  - Given/When/Then: Given the `list-trial-balance` tool definition, when its `description` string is inspected, then it mentions the report envelope shape (`sections`, `columns`).
  - Acceptance: `npm run test -- list-trial-balance` green.
  - Depends on: Task 3.1
  - Examples: Example 15

- [ ] **Task 3.3** — `list-profit-and-loss.tool.ts`: convert to `reportResponse`, update description
  - File(s): `src/tools/list/list-profit-and-loss.tool.ts`
  - What to do: Same minimal-diff pattern as Task 3.1 — replace the 4 content blocks with `return reportResponse(profitAndLossReport);`, drop unused `formatDate`/`formatDateTime` imports, add the `reportResponse` import, update the description to document the envelope shape. No new test file (design.md scopes one new tool test to `list-trial-balance`; this tool shares the identical transform path already covered by Phase 2's unit tests plus Task 3.1's integration test — a second near-identical integration test would be redundant per the design's stated test-file list).
  - Given/When/Then: Given the existing manual/build verification, when `npm run build` runs, then it passes with no unused-import lint errors; when the full suite runs, then no existing test for this file (there is none) regresses.
  - Acceptance: `npm run build` and `npm run lint` green; manual smoke check optional (dev instance) per REPO.md's "Verifying a change" guidance.
  - Depends on: Task 2.9
  - Examples: (none — see rationale above; covered structurally by Phase 2 tests)

- [ ] **Task 3.4** — `list-report-balance-sheet.tool.ts`: convert to `reportResponse`, update description
  - File(s): `src/tools/list/list-report-balance-sheet.tool.ts`
  - What to do: Same pattern — replace the 2 content blocks (`reportName` prose + pretty-printed rows) with `return reportResponse(balanceSheetReport);`; this tool has no `formatDate`/`formatDateTime` imports to remove. Update description.
  - Given/When/Then: Given `npm run build`, when it runs, then it passes; the tool's success path returns exactly one content block (verified indirectly via Phase 2's `reportResponse` unit tests, which already assert the wrapper's shape).
  - Acceptance: `npm run build` and `npm run lint` green.
  - Depends on: Task 2.9
  - Examples: (none — see Task 3.3 rationale)

- [ ] **Task 3.5** — `list-aged-receivables-by-contact.tool.ts` + `list-aged-payables-by-contact.tool.ts`: convert to `reportResponse`, drop `formatAgedReportFilter`
  - File(s): `src/tools/list/list-aged-receivables-by-contact.tool.ts`, `src/tools/list/list-aged-payables-by-contact.tool.ts`
  - What to do: For both tools, replace the 4 content blocks (report name, report date, filter text, pretty-printed rows) with `return reportResponse(report);` on the success path (keep the existing `response.isError` error branch text unchanged). Remove the `formatAgedReportFilter` and `formatDate` imports/calls from both files — the `invoicesFromDate`/`invoicesToDate` filter description moves into the tool's `description` string instead of a runtime prose block. Update both descriptions to document the envelope shape.
  - Given/When/Then: Given `npm run build`, when it runs, then it passes with no unused-import errors (confirms `formatAgedReportFilter` is no longer referenced from either tool file, a precondition for Task 3.6's deletion).
  - Acceptance: `npm run build` and `npm run lint` green.
  - Depends on: Task 2.9
  - Examples: (none — see Task 3.3 rationale; structural coverage from Phase 2)

- [ ] **Task 3.6** — Delete dead code: `format-aged-report-filter.ts`
  - File(s): `src/helpers/format-aged-report-filter.ts` (delete)
  - What to do: `git rm src/helpers/format-aged-report-filter.ts`. Confirm via `grep -rn "format-aged-report-filter" src/` that no import remains (Task 3.5 must land first).
  - Given/When/Then: Given Task 3.5 is complete (both aged-report tool files no longer import `formatAgedReportFilter`), when the file is deleted, then `npm run build` still passes (no dangling import) and `grep -rn "format-aged-report-filter" src/` returns nothing.
  - Acceptance: `npm run build` green; grep returns no matches.
  - Depends on: Task 3.5

## Phase 4 — `list-accounts` `activeOnly`

- [ ] **Task 4.1** — Handler: `listXeroAccounts` accepts optional `where`, passes it to `getAccounts`
  - File(s): `src/handlers/list-xero-accounts.handler.ts`
  - What to do: Add `where?: string` parameter to the internal `listAccounts` function and to the exported `listXeroAccounts`, threading it through as the 3rd positional argument to `xeroClient.accountingApi.getAccounts(xeroTenantId, ifModifiedSince, where, order, options)` in place of the current hardcoded `undefined`. No test file for this handler alone — its behaviour is asserted end-to-end via the tool test in Task 4.2 (mirrors how `listXeroInvoices`'s params are tested via `list-invoices.tool.test.ts`, not a standalone handler test).
  - Given/When/Then: Given `listXeroAccounts('Status=="ACTIVE"')` is called, when the underlying `getAccounts` mock is inspected, then it was invoked with `'Status=="ACTIVE"'` as the 3rd argument; given `listXeroAccounts()` (no arg), when inspected, then the 3rd argument is `undefined`.
  - Acceptance: Verified via Task 4.2's tool-level test (this task's own verification is `npm run build` passing with the new optional param — no behavioural test until Task 4.2, since the tool test exercises the full path with a mocked handler, not a mocked Xero SDK call).
  - Depends on: (none)

- [ ] **Task 4.2** — Tool: `activeOnly` param (default `true`) drives the `where` clause; new `list-accounts.tool.test.ts`
  - File(s): `src/tools/list/list-accounts.tool.ts`, `src/__tests__/tools/list-accounts.tool.test.ts` (new)
  - What to do: Write the test first — `vi.hoisted` mock of `listXeroAccounts` capturing its `where` argument, mirroring `list-invoices.tool.test.ts`'s pattern. Case A: call the tool with no args, assert the mock was called with `where: 'Status=="ACTIVE"'`. Case B: call with `{ activeOnly: false }`, assert the mock was called with `where: undefined`. Then implement: add `activeOnly: z.boolean().optional().default(true)` to the tool's zod schema; in the handler function, compute `const where = activeOnly !== false ? 'Status=="ACTIVE"' : undefined;` and call `listXeroAccounts(where)`; update the tool description to state the `activeOnly` default and its effect.
  - Given/When/Then (default): Given a mock `listXeroAccounts` capturing its `where` argument, when `list-accounts` tool is called with no arguments, then the handler was called with `where: 'Status=="ACTIVE"'`.
  - Given/When/Then (explicit false): Given the same mock, when `list-accounts` tool is called with `{ activeOnly: false }`, then the handler was called with `where: undefined`.
  - Acceptance: Both new tests green; `npm run test` full suite green; `npm run build` green.
  - Depends on: Task 4.1
  - Examples: Example 10, Example 11

## Phase 5 — Bookkeeping

- [ ] **Task 5.1** — REPO.md: add the feature-007 upstream-isolation exception note
  - File(s): `.specs/REPO.md`
  - What to do: Append a new "Known exception (feature 007-response-shape)" paragraph to the Upstream Sync section, following the exact style of the existing 004/005/006 exception notes: name the modified upstream-owned files (5 report tool files, `list-xero-accounts.handler.ts`, `list-accounts.tool.ts`), the new fork-owned file (`report-envelope.ts`), and the deleted file (`format-aged-report-filter.ts`). State that `git diff upstream/main -- src/ ':!src/http'` remains non-empty for this additional, named reason on top of 004/005/006's.
  - Given/When/Then: Given the REPO.md Upstream Sync section, when read after this task, then it lists a feature-007 exception paragraph in the same format and position (chronologically after 006's) as the existing three.
  - Acceptance: Manual read-through matches the style of the 004/005/006 paragraphs; no other REPO.md content altered.
  - Depends on: Phase 3 and Phase 4 complete (so the file list in the note is accurate)

- [ ] **Task 5.2** — Flip ADR-0006 status to `Accepted`
  - File(s): `.specs/adr/0006-report-envelope-and-empty-value-omission.md`
  - What to do: Change the `| Status | Draft |` row to `| Status | Accepted |` now that the design is implemented and tests are green. No other content changes (the Decision/Consequences sections were already written accurately in the design phase).
  - Given/When/Then: Given the ADR-0006 file, when its Status field is read after this task, then it reads `Accepted`.
  - Acceptance: Diff is a single-line status change.
  - Depends on: Phase 3, Phase 4 complete and full suite green

- [ ] **Task 5.3** — Update `.specs/backlog/response-size-and-502-stability.md`: mark items 2-4 delivered
  - File(s): `.specs/backlog/response-size-and-502-stability.md`
  - What to do: In the "Post-v0.3.0 tester feedback" section, annotate the "Envelope inconsistency" and "Trial balance bloat" bullets (items 2-3 in that list) and the `list-accounts` `activeOnly` half of item 4 as **delivered by 007-response-shape** (report envelope + attribute dedup + empty-value omission + `activeOnly` default), leaving the field-trimming/`fields`-param request explicitly out of scope (per this feature's Non-Goals) and the infra 502/OOM diagnostics + `list-items` 9 MB pagination strategy as remaining open scope for this backlog item.
  - Given/When/Then: Given the backlog file, when read after this task, then the delivered sub-items are marked resolved with a pointer to 007, and the remaining infra/pagination scope is unchanged and still legible as open.
  - Acceptance: Manual read-through; no remaining-scope content deleted, only the delivered portions annotated.
  - Depends on: Task 5.1

- [ ] **Task 5.4** — Full verification sweep
  - File(s): (none — verification only)
  - What to do: Run the full test suite, build, and lint from repo root.
  - Given/When/Then: Given all Phase 1-4 tasks complete, when `npm run test`, `npm run build`, and `npm run lint` are run, then all three exit 0 with no regressions in `json-response.test.ts`, `list-invoices.tool.test.ts`, `list-organisation-details` coverage, `xero-client.test.ts`, or the `http/` suite.
  - Acceptance: All three commands green; `grep -rn "format-aged-report-filter" src/` still returns nothing.
  - Depends on: Task 5.3

## Out of Scope
- **Field trimming / a `fields` param on `list-accounts` or `list-items`** — explicit Non-Goal in requirements.md; belongs to `.specs/backlog/response-size-and-502-stability.md`'s remaining scope if ever picked up.
- **Items `description`-dedup** — explicit Non-Goal.
- **Aged-receivables/payables live failure fix** — covered by `.specs/backlog/aged-reports-live-failure.md`; this feature only proves the transformer correct via fixtures, per design.md.
- **A recursive pre-pass to strip empty objects (`{}`)** — resolved as accepted behavior in design.md's Open Questions; not implemented.
- **Handler-level standalone test for `listXeroAccounts`** — covered end-to-end via the tool test (Task 4.2), matching the existing `list-invoices` precedent (no standalone handler test in the suite today).
- **Second/third near-duplicate tool-level integration tests for P&L, balance sheet, and aged reports** — design.md scopes exactly one new report-tool test file (`list-trial-balance.tool.test.ts`); the shared `transformReport`/`reportResponse` path is already exhaustively unit-tested in Phase 2, and Task 3.3-3.5 are build/lint-verified conversions of the same one-line pattern.
