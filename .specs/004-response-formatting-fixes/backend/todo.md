# Todo: Response Formatting Fixes
**Layer:** backend
**Status:** Complete
**Last updated:** 2026-07-06

## Implementation Tasks

Tasks are ordered. Do not start a task until its dependencies are complete.

Testing mode is **full-tdd**. Do not create separate "write tests" tasks for the pure
functions — each Phase 1/2 task's Define→Specify→Build cycle produces its own test file
alongside the implementation, per the file paths listed in design.md's Testing Strategy
(`src/helpers/__tests__/format-date.test.ts`, `src/helpers/__tests__/format-line-item.test.ts`).

### Phase 0: Librarian verification gate

- [x] **Task 0.1** — Consult `reference.md` before touching any date call site
  - Completed: 2026-07-07
  - File(s): `.specs/004-response-formatting-fixes/backend/reference.md` (read-only)
  - What to do: Before starting Phase 3 (date standardisation), read `reference.md` to confirm,
    per Xero resource, which fields are `Date` objects vs plain strings, and which are
    calendar-date vs timestamp semantics. Design.md's Phase 3 tables assume `updatedDateUTC` /
    `createdDateUTC` are timestamps (`formatDateTime`) and all other date fields
    (`date`, `dueDate`, `startDate`, `endDate`, `dateString`, `expiryDateString`, `reportDate`,
    `periodLockDate`, `fullyPaidOnDate`, `scheduleOfAccrualDate`, `periodStartDate`,
    `periodEndDate`) are calendar dates (`formatDate`). If `reference.md` contradicts this
    mapping for any specific field, use `reference.md`'s field type over the table below for
    that site and note the deviation in the PR description.
  - Acceptance: Mapping confirmed or deviations noted before any Phase 3 task starts.
  - Depends on: (none — librarian stage runs before build per pipeline)

### Phase 1: Date helper (new file, full-tdd)

- [x] **Task 1.1** — `formatDate`: Date object and undefined
  - Completed: 2026-07-07
  - Tests: src/helpers/__tests__/format-date.test.ts
  - File(s): `src/helpers/format-date.ts`, `src/helpers/__tests__/format-date.test.ts`
  - What to do: Create `format-date.ts` exporting `formatDate(value: Date | string | undefined): string | undefined`. Implement the `undefined` guard and the `Date` branch (`value.toISOString().slice(0, 10)`). Write the two corresponding tests first (Define→Specify→Build).
  - Acceptance: `formatDate(new Date("2026-07-04T00:00:00.000Z"))` returns `"2026-07-04"`; `formatDate(undefined)` returns `undefined`.
  - Depends on: (none)
  - Examples: Example 7, Example 9

- [x] **Task 1.2** — `formatDate`: tz-safe date-prefixed string fast path
  - Completed: 2026-07-07
  - Tests: src/helpers/__tests__/format-date.test.ts
  - File(s): `src/helpers/format-date.ts`, `src/helpers/__tests__/format-date.test.ts`
  - What to do: Add the `/^\d{4}-\d{2}-\d{2}/` regex branch that returns `value.slice(0, 10)` without constructing a `Date`, covering both `"2022-07-22"` and `"2022-07-22T00:00:00"`.
  - Acceptance: `formatDate("2022-07-22T00:00:00")` returns `"2022-07-22"` regardless of `process.env.TZ` (assert this doesn't rely on `new Date(...)`).
  - Depends on: Task 1.1
  - Examples: Example 8

- [x] **Task 1.3** — `formatDate`: non-prefixed string parse + unparseable passthrough
  - Completed: 2026-07-07
  - Tests: src/helpers/__tests__/format-date.test.ts
  - File(s): `src/helpers/format-date.ts`, `src/helpers/__tests__/format-date.test.ts`
  - What to do: Add the `new Date(value)` parse branch for strings that don't match the date-prefix regex, returning `d.toISOString().slice(0, 10)` when valid, `String(value)` when `isNaN(d.getTime())`.
  - Acceptance: `formatDate("28 June 2026")` returns `"2026-06-28"`; `formatDate("not-a-date")` returns `"not-a-date"`.
  - Depends on: Task 1.2
  - Examples: Example 10, Example 15

- [x] **Task 1.4** — `formatDateTime`: Date and undefined only (no string branch)
  - Completed: 2026-07-07
  - Tests: src/helpers/__tests__/format-date.test.ts
  - File(s): `src/helpers/format-date.ts`, `src/helpers/__tests__/format-date.test.ts`
  - What to do: Add `formatDateTime(value: Date | undefined): string | undefined` to the same file. `undefined` → `undefined`; `Date` → `value.toISOString()`. **No string-input branch** — the signature is deliberately Date-only (reference.md confirms `updatedDateUTC`/`createdDateUTC` are always `Date` at runtime; a string caller must be a compile-time error, per the repo's "prove it in CI" principle).
  - Acceptance: `formatDateTime(new Date("2026-07-05T15:07:49.000Z"))` returns `"2026-07-05T15:07:49.000Z"`; `formatDateTime(undefined)` returns `undefined`.
  - Acceptance (full file): all test cases in design.md's "Test plan for format-date.test.ts" pass (formatDateTime cases: Date input, undefined only).
  - Depends on: Task 1.3
  - Examples: Example 11, Example 12, Example 13

### Phase 2: Line-item formatter (modify existing, full-tdd)

- [x] **Task 2.1** — `formatLineItem`: tracking render (fixes A#1)
  - Completed: 2026-07-07
  - Tests: src/helpers/__tests__/format-line-item.test.ts
  - File(s): `src/helpers/format-line-item.ts`, `src/helpers/__tests__/format-line-item.test.ts`
  - What to do: Replace `` `Tracking: ${lineItem.tracking}` `` with a branch: non-empty `tracking` array renders `` `Tracking: ${tracking.map(t => `${t.name}: ${t.option}`).join(", ")}` ``; empty/absent renders `"Tracking: No tracking"`. Write the 4 tracking test cases first (single entry, multiple entries, undefined, empty array).
  - Acceptance: `formatLineItem({tracking:[{name:"Region",option:"South"}]} as LineItem)` output contains `"Tracking: Region: South"`; two entries joins with `", "`; `tracking: undefined` and `tracking: []` both render `"Tracking: No tracking"`.
  - Depends on: (none — independent of Phase 1)
  - Examples: Example 1, Example 2, Example 3, Example 4

- [x] **Task 2.2** — `formatLineItem`: item, and empty-field fallbacks (fixes A#1 noise, FR#2)
  - Completed: 2026-07-07
  - Tests: src/helpers/__tests__/format-line-item.test.ts
  - File(s): `src/helpers/format-line-item.ts`, `src/helpers/__tests__/format-line-item.test.ts`
  - What to do: Replace `` `Item ID: ${lineItem.item}` `` with `lineItem.item?.name ? \`Item: ${lineItem.item.name}\` : null` (omit line when absent — `item` is a `LineItemItem` object, not a scalar). Add per-field ternary fallbacks for `itemCode` ("No item code"), `description` ("No description"), `taxType` ("No tax type"), `accountCode` ("No account code"), matching the `list-manual-journals.tool.ts:66-72` precedent. Add `.filter(Boolean)` before `.join("\n")`. Leave `quantity`, `unitAmount`, `lineAmount` untouched (always-present numerics).
  - Acceptance: a `LineItem` missing `itemCode`/`taxType` renders `"No item code"` / `"No tax type"` with no literal `undefined`; a `LineItem` with `item = {name: "Widget"}` renders `"Item: Widget"`; a `LineItem` with `item` absent has no `Item:` line at all; the full-fields example (Example 6) produces a multi-line string with no `undefined`/`[object Object]`.
  - Depends on: Task 2.1
  - Examples: Example 5, Example 6

### Phase 3: Object/fallback fixes (Group A, sites 2, 3, 4, 5)

- [x] **Task 3.1** — Join fix: `list-invoices.tool.ts` line items (fixes A#4)
  - Completed: 2026-07-07
  - File(s): `src/tools/list/list-invoices.tool.ts`
  - What to do: Replace `` returnLineItems ? `Line Items: ${invoice.lineItems?.map(formatLineItem)}` : null `` with a branch that joins with `"\n\n"` and falls back to `"Line Items: No line items"` when `invoice.lineItems` is empty/absent, per design.md's join-fix table.
  - Given: `invoiceNumbers` filter returns an invoice with 2 line items, one carrying `tracking`. When: `list-invoices` renders. Then: line items are separated by a blank line (`\n\n`) and the tracking line reads `Region: South` (not comma-glued, not `[object Object]`).
  - Depends on: Task 2.1, Task 2.2

- [x] **Task 3.2** — Join fix: `list-bank-transactions.tool.ts` line items (fixes A#4)
  - Completed: 2026-07-07
  - File(s): `src/tools/list/list-bank-transactions.tool.ts`
  - What to do: Replace `` `Line Items: ${transaction.lineItems?.map(formatLineItem)}` `` with the same guarded `.join("\n\n")` / `"Line Items: No line items"` pattern as Task 3.1.
  - Given: a bank transaction with an inter-account transfer line (no tracking). When: rendered. Then: `Tracking: No tracking` appears (AC 3), and multiple line items are blank-line separated.
  - Depends on: Task 2.1, Task 2.2

- [x] **Task 3.3** — Join fix: `list-tracking-categories.tool.ts` options (fixes A#4)
  - Completed: 2026-07-07
  - File(s): `src/tools/list/list-tracking-categories.tool.ts`
  - What to do: Replace `` `Found ${category.options?.length || 0} tracking options:\n${category.options?.map(formatTrackingOption)}` `` with a guarded `category.options?.length ? \`Tracking Options:\n${category.options.map(formatTrackingOption).join("\n\n")}\` : "No tracking options"`, keeping the existing found-count line separate per design.md.
  - Given: a category with 3 tracking options. When: rendered. Then: each option renders on its own block (no comma-glue across 86 options as in the live bug report), and `Found 3 tracking options:` appears as before.
  - Depends on: (none)

- [x] **Task 3.4** — Join fix: `create-tracking-options.tool.ts` and `update-tracking-options.tool.ts` (fixes A#4)
  - Completed: 2026-07-07
  - File(s): `src/tools/create/create-tracking-options.tool.ts`, `src/tools/update/update-tracking-options.tool.ts`
  - What to do: In both files, add `.join("\n\n")` to `trackingOptions.map(formatTrackingOption)`.
  - Given: creating 2 tracking options. When: the tool responds. Then: the two option blocks are separated by a blank line, not comma-glued.
  - Depends on: (none)

- [x] **Task 3.5** — `list-organisation-details.tool.ts`: payment terms (fixes A#2)
  - Completed: 2026-07-07
  - File(s): `src/tools/list/list-organisation-details.tool.ts`
  - What to do: Replace the `Object.entries(organisation.paymentTerms).map(...)` block with explicit rendering of `paymentTerms.bills` and `paymentTerms.sales` (each a `Bill` with optional `day`/`type`): `Bills: Day <day>, Type: <type>` when present, `"No bills payment term"` when `bills` is absent; same pattern for `Sales:`/`sales`. Keep `"No payment terms available."` as the top-level fallback when `organisation.paymentTerms` itself is absent.
  - Given: `organisation.paymentTerms = {bills: {day: 30, type: "DAYSAFTERBILLDATE"}}` (no `sales`). When: rendered. Then: output contains `"Bills: Day 30, Type: DAYSAFTERBILLDATE"` and `"No sales payment term"` — never `undefined`/`[object Object]`.
  - Depends on: (none)

- [x] **Task 3.6** — `list-organisation-details.tool.ts`: scalar fallbacks (fixes A#3)
  - Completed: 2026-07-07
  - File(s): `src/tools/list/list-organisation-details.tool.ts`
  - What to do: Move the `|| "No … available."` fallback inside the template-literal interpolation for each of the ~15 affected lines (`name`, `legalName`, `shortCode`, `organisationID`, `version`, `baseCurrency`, `countryCode`, `timezone`, `financialYearEndDay`, `financialYearEndMonth`, `salesTaxBasis`, `salesTaxPeriod`, `edition`, `_class`), e.g. `` `Name: ${organisation.name || "No name available."}` ``.
  - Given: `organisation.name = "Old School Brand (Pty) Ltd"`. When: rendered. Then: output contains `"Name: Old School Brand (Pty) Ltd"` with no trailing literal `|| "..."`.
  - Depends on: (none)

- [x] **Task 3.7** — `list-organisation-details.tool.ts`: external links (fixes A#5) and delete `get-external-link.ts`
  - Completed: 2026-07-07
  - File(s): `src/tools/list/list-organisation-details.tool.ts`, `src/helpers/get-external-link.ts` (delete)
  - What to do: Replace `link.url ? getExternalLink(link.url) : link.url` with `link.url ?? "No URL"`; remove the `getExternalLink` import. Delete `src/helpers/get-external-link.ts` (single-use, no other importers).
  - Given: `link.url = "http://www.oldschool.co.za"`. When: rendered. Then: output contains `"http://www.oldschool.co.za"` verbatim (not `%3A%2F%2F`-encoded).
  - Acceptance: `grep -rn "getExternalLink\|get-external-link" src/` returns no matches.
  - Depends on: (none)

### Phase 4: Date standardisation (Group B) — grouped by file

Each task below adds `import { formatDate } from "../../helpers/format-date.js";` and/or
`import { formatDateTime } from "../../helpers/format-date.js";` (only the function(s)
actually used) and wraps the existing date value expression, preserving each site's current
guard/fallback shape exactly. Consult Task 0.1's `reference.md` mapping before assuming
`formatDate` vs `formatDateTime` per field.

- [x] **Task 4.1** — Dates: `list-organisation-details.tool.ts`
  - Completed: 2026-07-07
  - File(s): `src/tools/list/list-organisation-details.tool.ts`
  - What to do: `periodLockDate` → wrap with `formatDate`. `createdDateUTC` → wrap with `formatDateTime` (this also completes the A#3 scalar-fallback fix for that line from Task 3.6 — the `|| "No created date available."` now applies to the `formatDateTime` result).
  - Given: `organisation.periodLockDate = new Date("2026-06-30T00:00:00.000Z")`. When: rendered. Then: `"Period Lock Date: 2026-06-30"` (not the raw `Date` toString).
  - Depends on: Task 1.4, Task 3.6

- [x] **Task 4.2** — Dates: `list-invoices.tool.ts`
  - Completed: 2026-07-07
  - File(s): `src/tools/list/list-invoices.tool.ts`
  - What to do: Wrap `invoice.date`, `invoice.dueDate`, `invoice.fullyPaidOnDate` with `formatDate`; wrap `invoice.updatedDateUTC` with `formatDateTime`.
  - Given: an invoice with `date`, `dueDate`, `updatedDateUTC` all set. When: rendered. Then: `Date:`/`Due Date:` show `YYYY-MM-DD`, `Last Updated:` shows full ISO 8601.
  - Depends on: Task 1.4, Task 3.1

- [x] **Task 4.3** — Dates: `list-bank-transactions.tool.ts`
  - Completed: 2026-07-07
  - File(s): `src/tools/list/list-bank-transactions.tool.ts`
  - What to do: Wrap `transaction.date` with `formatDate`.
  - Given: `transaction.date` set. When: rendered. Then: `Date: YYYY-MM-DD`.
  - Depends on: Task 1.1, Task 3.2

- [x] **Task 4.4** — Dates: `list-manual-journals.tool.ts`
  - Completed: 2026-07-07
  - File(s): `src/tools/list/list-manual-journals.tool.ts`
  - What to do: Wrap `journal.date` with `formatDate`. Replace `journal.updatedDateUTC.toLocaleDateString()` with `formatDateTime(journal.updatedDateUTC)`.
  - Given: `journal.updatedDateUTC` set. When: rendered. Then: `Last Updated:` shows ISO 8601, not a locale-formatted date (fixes the `.toLocaleDateString()` inconsistency called out in requirements.md).
  - Depends on: Task 1.4

- [x] **Task 4.5** — Dates: `list-quotes.tool.ts`
  - Completed: 2026-07-07
  - File(s): `src/tools/list/list-quotes.tool.ts`
  - What to do: Wrap `quote.dateString` and `quote.expiryDateString` with `formatDate`; wrap `quote.updatedDateUTC` with `formatDateTime`.
  - Given: `quote.dateString = "2022-07-22T00:00:00"`, `quote.updatedDateUTC = new Date("2022-07-22T14:30:00.000Z")`. When: `list-quotes` renders. Then: `Quote Date: 2022-07-22` and `Last Updated: 2022-07-22T14:30:00.000Z` — both standard, no mixed styles (proves AC 12 / Example 14, the incoherence called out by name in requirements.md).
  - Depends on: Task 1.4

- [x] **Task 4.6** — Dates: `list-credit-notes.tool.ts`
  - Completed: 2026-07-07
  - File(s): `src/tools/list/list-credit-notes.tool.ts`
  - What to do: Wrap `creditNote.date` with `formatDate`; wrap `creditNote.updatedDateUTC` with `formatDateTime`.
  - Given: both fields set. When: rendered. Then: `Date:` is `YYYY-MM-DD`, `Last Updated:` is ISO 8601.
  - Depends on: Task 1.4

- [x] **Task 4.7** — Dates: `list-payments.tool.ts`
  - Completed: 2026-07-07
  - File(s): `src/tools/list/list-payments.tool.ts`
  - What to do: In `paymentFormatter`, wrap `payment.date` with `formatDate` (keep the `|| "Unknown date"` fallback outside, since `formatDate` returns `undefined` on absence); wrap `payment.updatedDateUTC` with `formatDateTime`.
  - Given: `payment.date` set. When: rendered. Then: `Date: YYYY-MM-DD`.
  - Depends on: Task 1.4

- [x] **Task 4.8** — Dates: `list-items.tool.ts`
  - Completed: 2026-07-07
  - File(s): `src/tools/list/list-items.tool.ts`
  - What to do: Wrap `item.updatedDateUTC` with `formatDateTime`.
  - Given: `item.updatedDateUTC` set. When: rendered. Then: `Last Updated:` is ISO 8601.
  - Depends on: Task 1.4

- [x] **Task 4.9** — Dates: `list-profit-and-loss.tool.ts` and `list-trial-balance.tool.ts`
  - Completed: 2026-07-07
  - File(s): `src/tools/list/list-profit-and-loss.tool.ts`, `src/tools/list/list-trial-balance.tool.ts`
  - What to do: Replace the existing `updatedDateUTC ? updatedDateUTC.toISOString() : "Unknown"` inline calls with `formatDateTime(updatedDateUTC) ?? "Unknown"` in both files (already-correct output, standardised on the shared helper per design.md). Wrap `reportDate` with `formatDate` in both files (`reportDate` is report metadata text, not necessarily `YYYY-MM-DD` prefixed — relies on Task 1.3's parse branch).
  - Given: `profitAndLossReport.updatedDateUTC` set. When: rendered. Then: output is unchanged in value (still full ISO 8601) but now sourced from `formatDateTime`.
  - Depends on: Task 1.4, Task 1.3

- [x] **Task 4.10** — Dates: `list-aged-payables-by-contact.tool.ts` and `list-aged-receivables-by-contact.tool.ts`
  - Completed: 2026-07-07
  - File(s): `src/tools/list/list-aged-payables-by-contact.tool.ts`, `src/tools/list/list-aged-receivables-by-contact.tool.ts`
  - What to do: Wrap `reportDate` with `formatDate` in both files, keeping the existing `|| "Not specified"` fallback outside.
  - Given: `agedPayablesReport.reportDate` set. When: rendered. Then: `Report Date:` shows a normalised calendar date.
  - Depends on: Task 1.3

- [x] **Task 4.11** — Dates: `create-invoice.tool.ts`, `create-bank-transaction.tool.ts`, `create-manual-journal.tool.ts`
  - Completed: 2026-07-07
  - File(s): `src/tools/create/create-invoice.tool.ts`, `src/tools/create/create-bank-transaction.tool.ts`, `src/tools/create/create-manual-journal.tool.ts`
  - What to do: Wrap `invoice?.date`, `bankTransaction?.date`, `manualJournal.date` with `formatDate` respectively.
  - Given: a newly created invoice with `date` set. When: the create-tool response renders. Then: `Date: YYYY-MM-DD`.
  - Depends on: Task 1.1

- [x] **Task 4.12** — Dates: `update-bank-transaction.tool.ts`, `update-payroll-timesheet-add-line.tool.ts`, `update-payroll-timesheet-update-line.tool.ts`
  - Completed: 2026-07-07
  - File(s): `src/tools/update/update-bank-transaction.tool.ts`, `src/tools/update/update-payroll-timesheet-add-line.tool.ts`, `src/tools/update/update-payroll-timesheet-update-line.tool.ts`
  - What to do: Wrap `bankTransaction?.date`, `newLine?.date`, `updatedLine?.date` with `formatDate` respectively.
  - Given: an updated bank transaction with `date` set. When: rendered. Then: `Date: YYYY-MM-DD`.
  - Depends on: Task 1.1

- [x] **Task 4.13** — Dates: `list-contacts.tool.ts`
  - Completed: 2026-07-07
  - File(s): `src/tools/list/list-contacts.tool.ts`
  - What to do: Wrap `contact.updatedDateUTC` with `formatDateTime`.
  - Given: `contact.updatedDateUTC` set. When: rendered. Then: `Last Updated:` is ISO 8601.
  - Depends on: Task 1.4

- [x] **Task 4.14** — Dates: `get-payroll-timesheet.tool.ts`
  - Completed: 2026-07-07
  - File(s): `src/tools/get/get-payroll-timesheet.tool.ts`
  - What to do: Wrap `timesheet.startDate` and `timesheet.endDate` with `formatDate`; wrap `timesheet.updatedDateUTC` with `formatDateTime`.
  - Given: a timesheet with all three fields set. When: rendered. Then: `Start Date:`/`End Date:` are `YYYY-MM-DD`, `Last Updated:` is ISO 8601.
  - Depends on: Task 1.4

- [x] **Task 4.15** — Dates: `list-payroll-timesheets.tool.ts`
  - Completed: 2026-07-07
  - File(s): `src/tools/list/list-payroll-timesheets.tool.ts`
  - What to do: Wrap `timesheet.startDate` and `timesheet.endDate` with `formatDate`; wrap `timesheet.updatedDateUTC` with `formatDateTime`.
  - Given: same as Task 4.14, list variant. When: rendered. Then: same result.
  - Depends on: Task 1.4

- [x] **Task 4.16** — Dates: `list-payroll-employees.tool.ts`
  - Completed: 2026-07-07
  - File(s): `src/tools/list/list-payroll-employees.tool.ts`
  - What to do: Wrap `employee.startDate` with `formatDate`; wrap `employee.updatedDateUTC` with `formatDateTime`.
  - Given: an employee with both fields set. When: rendered. Then: `Start Date:` is `YYYY-MM-DD`, `Last Updated:` is ISO 8601.
  - Depends on: Task 1.4

- [x] **Task 4.17** — Dates: `list-payroll-employee-leave.tool.ts`
  - Completed: 2026-07-07
  - File(s): `src/tools/list/list-payroll-employee-leave.tool.ts`
  - What to do: Wrap `leaveItem.startDate` and `leaveItem.endDate` with `formatDate`; wrap `leaveItem.updatedDateUTC` with `formatDateTime`.
  - Given: a leave item with all three fields set. When: rendered. Then: dates render per field type.
  - Depends on: Task 1.4

- [x] **Task 4.18** — Dates: `list-payroll-employee-leave-types.tool.ts` and `list-payroll-leave-types.tool.ts`
  - Completed: 2026-07-07
  - File(s): `src/tools/list/list-payroll-employee-leave-types.tool.ts`, `src/tools/list/list-payroll-leave-types.tool.ts`
  - What to do: Wrap `leaveType.scheduleOfAccrualDate` with `formatDate` in `list-payroll-employee-leave-types.tool.ts`; wrap `leaveType.updatedDateUTC` with `formatDateTime` in `list-payroll-leave-types.tool.ts`.
  - Given: `leaveType.scheduleOfAccrualDate` set. When: rendered. Then: `Accrual Date:` is `YYYY-MM-DD`. Given `leaveType.updatedDateUTC` set in the other file, `Last Updated:` is ISO 8601.
  - Depends on: Task 1.1, Task 1.4

- [x] **Task 4.19** — Dates: `list-payroll-leave-periods.tool.ts`
  - Completed: 2026-07-07
  - File(s): `src/tools/list/list-payroll-leave-periods.tool.ts`
  - What to do: Wrap `period.periodStartDate` and `period.periodEndDate` with `formatDate`.
  - Given: a leave period with both fields set. When: rendered. Then: `Start Date:`/`End Date:` are `YYYY-MM-DD`.
  - Depends on: Task 1.1

### Phase 5: Verification

- [x] **Task 5.1** — Full verification pass
  - Completed: 2026-07-07
  - File(s): (none — verification only)
  - What to do: Run, in order: `npm run build` (tsc must pass with `strict: true`, `dist/` regenerated and committed), `npm run lint` (zero errors), `npm run test` (all Vitest suites green, including the two new helper test files). Then run these greps against every file touched in Phases 2-4 and confirm zero matches:
    - `grep -rn "\[object Object\]" src/tools src/helpers` (should never appear in source — this greps for any literal string that would indicate a leftover bug marker)
    - `grep -rnE '\$\{[^}]*\}\s*\|\|\s*"' src/tools/list/list-organisation-details.tool.ts` (the literal-`||`-outside-interpolation bug — should return nothing after Task 3.6)
    - `grep -rn "encodeURIComponent" src/tools src/helpers` (should return nothing after Task 3.7's deletion of `get-external-link.ts`)
    - `grep -rn "getExternalLink" src/` (should return nothing)
    - `grep -rnE '\$\{[a-zA-Z.?]*\.(date|Date|startDate|endDate|dueDate|updatedDateUTC|createdDateUTC|dateString|expiryDateString|reportDate|periodLockDate|fullyPaidOnDate|scheduleOfAccrualDate|periodStartDate|periodEndDate)\}' src/tools` (raw un-formatted date interpolations — should return nothing outside of already-wrapped `formatDate(...)`/`formatDateTime(...)` calls; manually eyeball any hits)
    - `grep -rn "toLocaleDateString" src/tools` (should return nothing after Task 4.4)
  - Acceptance: All three commands exit 0; all six greps return no unexpected matches (or each match is manually confirmed to already be wrapped in `formatDate`/`formatDateTime`).
  - Depends on: Task 1.4, Task 2.2, Task 3.1, Task 3.2, Task 3.3, Task 3.4, Task 3.5, Task 3.6, Task 3.7, Task 4.1 through Task 4.19

### Phase 6: Cleanup & Docs

- [x] **Task 6.1** — Update `.specs/004-response-formatting-fixes/backend/requirements.md` and `design.md` acceptance checklist
  - Completed: 2026-07-07
  - File(s): `.specs/004-response-formatting-fixes/backend/requirements.md`
  - What to do: Check off the three unchecked items under "Acceptance Criteria" (`npm run build`/`lint`/`test` green; Vitest coverage for `formatLineItem` and the date helper; librarian citations) once Phase 5 passes and the librarian's `reference.md` exists.
  - Acceptance: Checkboxes reflect actual completion state.
  - Depends on: Task 5.1

## Out of Scope

- **Response size / pagination and intermittent 502s** — deferred to backlog feature 005 per requirements.md Non-Goals.
- **Upstream PR of these fixes** — owner-approved local-only fork patch; no upstream contribution task.
- **New tools, fields, or Xero API coverage** — none introduced; all changes are rendering-only on existing tool outputs.
- **`format-tracking-option.ts` changes** — unchanged per design.md; it already renders `TrackingOption` (category-list scalar fields) correctly and is a distinct type from `LineItemTracking`.
- **Xero-internal reference markup passthrough** (e.g. payments `Reference: [:[…]:]`) — explicitly out of scope per requirements.md Non-Goals; that is stored Xero data, not a rendering bug.
- **Handler, type, or `tool-factory.ts` changes** — design.md confirms no handler logic, zod schema, or registration changes are needed; all fixes are confined to `src/helpers/` and `src/tools/*.tool.ts` files.

