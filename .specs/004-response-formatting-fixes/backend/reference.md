# Reference: Response Formatting Fixes
**Layer:** backend
**Status:** Confirmed — Xero web docs cross-checked against `xero-node` v13.3.0 types
**Last updated:** 2026-07-06
**Source:** developer.xero.com (Accounting API, Payroll NZ API docs) + `node_modules/xero-node/dist/gen/model/**/*.d.ts` (v13.3.0, as installed) + `node_modules/xero-node/dist/gen/model/accounting/models.js` (`ObjectSerializer`)

## Overview

This feature (rendering-only date/object formatting fixes) touches ~45 date interpolation
sites and 5 object/fallback bugs. Because none of these fields are re-validated at the API
boundary (the SDK's declared TypeScript types are trusted as-is), an incorrect `formatDate`
vs `formatDateTime` choice — or an incorrect assumption about a field's *runtime* shape —
would silently corrupt what the LLM reads back. Every field below was checked against the
live Xero developer docs and reconciled against the exact `.d.ts` declarations shipped in
this repo's `node_modules/xero-node`. The single most important finding (see "How the build
agent should use this") is that **the TypeScript-declared type of a date field is not a
reliable guide to its runtime type** — `xero-node`'s deserializer silently upgrades many
`string`-typed fields to real `Date` objects depending on which Xero API produced the value.
`formatDate`/`formatDateTime` must discriminate at runtime (`typeof value === "string"`),
never trust the `.d.ts` annotation.

## LineItem Tracking

### Key APIs
- `LineItem.tracking?: Array<LineItemTracking>` — confirmed **array**, not a single object. `Tracking: ${lineItem.tracking}` (the current bug) stringifies the array, which for an array of objects renders `[object Object],[object Object]` — this is the A#1 defect design.md fixes.
- `LineItemTracking` fields (xero-node, camelCase): `trackingCategoryID?: string`, `trackingOptionID?: string`, `name?: string`, `option?: string`.

### Code Examples
Xero wire JSON (PascalCase) for a line item's `Tracking` array, confirmed via the Quotes and Purchase Orders API docs:
```json
"Tracking": [
  {
    "Name": "Region",
    "Option": "North",
    "TrackingCategoryID": "...",
    "TrackingOptionID": "..."
  }
]
```
`xero-node` deserializes this into `Array<LineItemTracking>` with camelCase keys (`name`, `option`, `trackingCategoryID`, `trackingOptionID`) — a direct, unsurprising PascalCase→camelCase mapping. **No shape mismatch.** `design.md`'s render (`` `${t.name}: ${t.option}` ``) uses the correct field names.

### Configuration
Not applicable (no config — pure rendering).

### Gotchas
- `TrackingOptionID` has historically been inconsistently populated across endpoints (some endpoints omitted it; a Feb 2026 Xero platform fix improved this for the single-invoice GET). This does not affect this feature — design.md only renders `name`/`option`, never the ID fields.
- Per xero-node's doc comment on `LineItem.tracking`: "Any LineItem can have a maximum of 2 `<TrackingCategory>` elements" — confirms the array is small/bounded, consistent with design's `.join(", ")` approach (no truncation needed).

**Doc URLs:**
- https://developer.xero.com/documentation/api/accounting/quotes (Tracking array example: `TrackingCategoryID`, `TrackingOptionID`, `Name`, `Option`)
- https://developer.xero.com/documentation/api/accounting/purchaseorders (Tracking array example)
- https://developer.xero.com/documentation/api/accounting/trackingcategories

## Organisation: PaymentTerms

### Key APIs
- `Organisation.paymentTerms?: PaymentTerm`
- `PaymentTerm { bills?: Bill; sales?: Bill }`
- `Bill { day?: number; type?: PaymentTermType }`
- `enum PaymentTermType { DAYSAFTERBILLDATE, DAYSAFTERBILLMONTH, OFCURRENTMONTH, OFFOLLOWINGMONTH }`

Confirmed verbatim against the Xero Organisation endpoint field reference (mirrored from developer.xero.com's own field descriptions):

> **PaymentTerms** — "A record field provides further information for payment terms for sales and purchases."
> **PaymentTerms.Bills** — "A record field provides further information for payment terms for purchases." → **Day**: "A whole number field that indicates the day of the month." → **Type**: "A text field that indicates how the day field is applied."
> **PaymentTermType values:**
> - `DAYSAFTERBILLDATE` — x days after bill date
> - `DAYSAFTERBILLMONTH` — x days after bill month
> - `OFCURRENTMONTH` — on a specific day of the current month
> - `OFFOLLOWINGMONTH` — on a specific day of the following month
> **PaymentTerms.Sales** — same shape (`Day`, `Type`) for sales.

This is an **exact match** with `xero-node`'s `PaymentTerm`/`Bill`/`PaymentTermType` — all 4 enum values, no extras, no omissions.

### Code Examples
design.md's fix:
```ts
organisation.paymentTerms?.bills
  ? `Bills: Day ${organisation.paymentTerms.bills.day}, Type: ${organisation.paymentTerms.bills.type}`
  : "No bills payment term"
```
This is correct per the confirmed shape — `bills`/`sales` are each a single `Bill` object (not an array), so no `.map()`/`.join()` is needed here (unlike the A#4 join-fix sites elsewhere).

### Configuration
Not applicable.

### Gotchas
- `Bill.day` is a plain `number` (0-31 per the "day of month" semantics) — never format it as a date; it is not a calendar date, it is a day-of-month integer. Do not route it through `formatDate`.
- `bills`/`sales` are each independently optional — an org can have one, both, or neither set. design's fallback strings ("No bills payment term" / "No sales payment term") independently guard each side, which is correct.

**Doc URL:** https://developer.xero.com/documentation/api/accounting/organisation

## Organisation: ExternalLinks

### Key APIs
- `Organisation.externalLinks?: Array<ExternalLink>`
- `ExternalLink { linkType?: ExternalLink.LinkTypeEnum; url?: string; description?: string }`
- `enum LinkTypeEnum { Facebook, GooglePlus, LinkedIn, Twitter, Website }`

Confirmed against the Organisation endpoint docs:
> **ExternalLinks** — "A table field provides further information for populate external links such as facebook, twitter, etc."
> **LinkType** — "A text field that indicates the type of link it is." (Facebook, GooglePlus, LinkedIn, Twitter, Website)
> **Url** — "A text field that provides the URL for the link." — example given elsewhere in Xero docs: `http://twitter.com/xeroapi` (a plain, unencoded URL).

### Code Examples
```ts
link.url ?? "No URL"   // correct — url is already a plain URL string
```
The current bug (`getExternalLink(link.url)` → `encodeURIComponent(url)`) double-encodes an already-plain URL, corrupting it (e.g. `http://` becomes `http%3A%2F%2F`). **Confirmed as a genuine bug**, not a spec-compliance requirement — Xero does not expect or require percent-encoded values back in the ExternalLinks display, and there is no re-submission of this field (`externalLinks` is read-only display data). Design's fix (render `link.url` verbatim) is correct.

### Gotchas
None beyond the encoding bug already identified.

**Doc URL:** https://developer.xero.com/documentation/api/accounting/organisation

## Date vs Timestamp Classification (CRITICAL)

### The wire-format finding that governs everything below

Xero's **core Accounting API** (Invoices, Bank Transactions, Credit Notes, Payments, Manual
Journals, Organisation, Contacts, Items) serialises **every** `Date`-typed field — including
ones `xero-node` declares as TypeScript `string` — using the legacy Microsoft .NET JSON date
wire format: `"/Date(1419937200000+0000)/"` (a millisecond Unix timestamp, optionally with a
`+0000` UTC offset suffix). Xero's own docs state this directly:

> "Xero uses the Microsoft .NET JSON date format from the time of original development... An
> example date/time in JSON is returned like `/Date(1439434356790)/` or
> `/Date(1419937200000+0000)/`." — https://developer.xero.com/documentation/api/accounting/requests-and-responses

Critically, `xero-node`'s deserializer (`ObjectSerializer.deserialize` in
`node_modules/xero-node/dist/gen/model/accounting/models.js`) special-cases this:

```js
else if (primitives.indexOf(type.toLowerCase()) !== -1) {
    if (type === "string" && data.toString().substring(0, 6) === "/Date(") {
        return this.deserializeDateFormats(type, data); // For MS dates that are of type 'string'
    }
    ...
}
```

**This means: any field `xero-node`'s `.d.ts` declares as `string` (e.g. `Invoice.date`,
`Invoice.dueDate`, `Organisation.periodLockDate`) is silently converted into a real
JavaScript `Date` object at runtime if the wire value starts with `/Date(`.** The `.d.ts`
`string` annotation is TypeScript-compile-time-only and does not reflect the object you
actually get back. `formatDate`/`formatDateTime` must discriminate with `typeof value ===
"string"` at runtime — never assume a field's `.d.ts` type predicts its runtime shape.

**Two exceptions where the wire value genuinely stays a string:**
1. **`Quote.dateString` / `Quote.expiryDateString`** — Xero's Quotes response includes a
   dedicated companion field alongside `Date`/`ExpiryDate` that is a literal ISO-ish string
   with **no timezone designator**, e.g. `"2016-12-16T00:00:00"` (confirmed pattern from the
   CreditNotes/Payments doc examples showing the same `DateString` convention:
   `"DateString": "2016-12-16T00:00:00"`, `"DateString": "1970-01-01T00:00:00"`). This value
   has no `/Date(` prefix, so `xero-node` leaves it as a plain string.
2. **Payroll NZ date fields** (`Employee.startDate`/`endDate`, `Timesheet.startDate`/`endDate`,
   `TimesheetLine.date`, `EmployeeLeave.startDate`/`endDate`,
   `LeavePeriod.periodStartDate`/`periodEndDate`, `EmployeeLeaveType.scheduleOfAccrualDate`) —
   **Payroll NZ does not use the `/Date(.../)/` wire format at all.** It returns genuine
   ISO-ish tz-naive strings directly, e.g. `"1982-11-22T00:00:00"` for `startDate`. (Payroll
   **AU** does still use `/Date(.../)/` for the equivalent fields — this repo only imports
   `payroll-nz` types, confirmed via `src/types/payroll-nz-types.ts` and the tool-file
   imports, so the NZ behaviour is what applies here.)
3. **Reports `reportDate`** (`ReportWithRow.reportDate`, used by P&L/TrialBalance/Aged
   Receivables/Aged Payables) — this is a genuinely different, third convention: a
   **human-readable string**, e.g. `"ReportDate": "15 June 2023"`. Not ISO, not `/Date(/`.
   This is the one field where `xero-node`'s `string` TS type *is* an accurate runtime
   description, but the format itself is neither a calendar-date-string nor a timestamp — it
   requires `formatDate`'s "other string, parse via `new Date(value)`" branch (design.md's
   Example 15), which JS's `Date` constructor can parse (`new Date("15 June 2023")` succeeds).

`updatedDateUTC`/`createdDateUTC` fields are declared `Date` in every model checked, and
`ObjectSerializer.deserializeDateFormats` tries `new Date(data)` first (which succeeds for
both ISO datetime strings and fails-over to `/Date(/` regex extraction) — so these reliably
arrive as real `Date` objects regardless of which sub-API produced them. No ambiguity here.

### Definitive Field Table

| Resource | Field | Xero wire format | xero-node `.d.ts` type | Runtime type (actual) | Classify as | Doc URL |
|---|---|---|---|---|---|---|
| Invoice | `date` | `/Date(ms+0000)/` | `string` | `Date` | `formatDate` | [invoices](https://developer.xero.com/documentation/api/accounting/invoices) |
| Invoice | `dueDate` | `/Date(ms+0000)/` | `string` | `Date` | `formatDate` | [invoices](https://developer.xero.com/documentation/api/accounting/invoices) |
| Invoice | `fullyPaidOnDate` | `/Date(ms+0000)/` | `string` | `Date` | `formatDate` | [invoices](https://developer.xero.com/documentation/api/accounting/invoices) |
| Invoice | `updatedDateUTC` | `/Date(ms+0000)/` | `Date` | `Date` | `formatDateTime` | [invoices](https://developer.xero.com/documentation/api/accounting/invoices) |
| BankTransaction | `date` | `/Date(ms+0000)/` | `string` | `Date` | `formatDate` | [banktransactions](https://developer.xero.com/documentation/api/accounting/banktransactions) |
| BankTransaction | `updatedDateUTC` | `/Date(ms+0000)/` | `Date` | `Date` | `formatDateTime` | [banktransactions](https://developer.xero.com/documentation/api/accounting/banktransactions) |
| CreditNote | `date` | `/Date(ms+0000)/` | `string` | `Date` | `formatDate` | [creditnotes](https://developer.xero.com/documentation/api/accounting/creditnotes) |
| CreditNote | `updatedDateUTC` | `/Date(ms+0000)/` | `Date` | `Date` | `formatDateTime` | [creditnotes](https://developer.xero.com/documentation/api/accounting/creditnotes) |
| Quote | `dateString` | plain string, no `/Date(` prefix, tz-naive (e.g. `"2016-12-16T00:00:00"`) | `string` | `string` | `formatDate` (regex/slice fast path) | [quotes](https://developer.xero.com/documentation/api/accounting/quotes) |
| Quote | `expiryDateString` | same as `dateString` | `string` | `string` | `formatDate` (regex/slice fast path) | [quotes](https://developer.xero.com/documentation/api/accounting/quotes) |
| Quote | `updatedDateUTC` | `/Date(ms+0000)/` | `Date` | `Date` | `formatDateTime` | [quotes](https://developer.xero.com/documentation/api/accounting/quotes) |
| Quote | *(not used)* `date`/`expiryDate` | `/Date(ms+0000)/` | `string` | `Date` | n/a — design deliberately uses `dateString`/`expiryDateString` instead | [quotes](https://developer.xero.com/documentation/api/accounting/quotes) |
| Payment | `date` | `/Date(ms+0000)/` | `string` | `Date` | `formatDate` | [payments](https://developer.xero.com/documentation/api/accounting/payments) |
| Payment | `updatedDateUTC` | `/Date(ms+0000)/` | `Date` | `Date` | `formatDateTime` | [payments](https://developer.xero.com/documentation/api/accounting/payments) |
| ManualJournal | `date` | `/Date(ms+0000)/` | `string` | `Date` | `formatDate` | [manualjournals](https://developer.xero.com/documentation/api/accounting/manualjournals) |
| ManualJournal | `updatedDateUTC` | `/Date(ms+0000)/` | `Date` | `Date` | `formatDateTime` | [manualjournals](https://developer.xero.com/documentation/api/accounting/manualjournals) |
| Item | `updatedDateUTC` | `/Date(ms+0000)/` | `Date` | `Date` | `formatDateTime` | [items](https://developer.xero.com/documentation/api/accounting/items) |
| Contact | `updatedDateUTC` | `/Date(ms+0000)/` | `Date` | `Date` | `formatDateTime` | [contacts](https://developer.xero.com/documentation/api/accounting/contacts) |
| Organisation | `periodLockDate` | `/Date(ms+0000)/` ("date time field that indicates the date from which transactions can be entered") | `string` | `Date` | `formatDate` | [organisation](https://developer.xero.com/documentation/api/accounting/organisation) |
| Organisation | `createdDateUTC` | `/Date(ms+0000)/` | `Date` | `Date` | `formatDateTime` | [organisation](https://developer.xero.com/documentation/api/accounting/organisation) |
| Report (P&L/TrialBalance/AgedReceivables/AgedPayables — all `ReportWithRow`) | `reportDate` | human-readable string, e.g. `"15 June 2023"` | `string` | `string` (genuinely) | `formatDate` (non-prefixed parse branch) | [reports](https://developer.xero.com/documentation/api/accounting/reports) |
| Report (`ReportWithRow`) | `updatedDateUTC` | `/Date(ms+0000)/` | `Date` | `Date` | `formatDateTime` | [reports](https://developer.xero.com/documentation/api/accounting/reports) |
| Payroll NZ Employee | `startDate` | plain ISO string, tz-naive, e.g. `"1982-11-22T00:00:00"` | `string` | `string` | `formatDate` (regex/slice fast path) | [payrollnz/employees](https://developer.xero.com/documentation/api/payrollnz/employees/) |
| Payroll NZ EmployeeLeave | `startDate` / `endDate` | plain ISO string, tz-naive | `string` | `string` | `formatDate` (regex/slice fast path) | [payrollnz/employees](https://developer.xero.com/documentation/api/payrollnz/employees/) |
| Payroll NZ EmployeeLeave | `updatedDateUTC` | `/Date(/` or ISO — either way `new Date()` parses it | `Date` | `Date` | `formatDateTime` | [payrollnz/employees](https://developer.xero.com/documentation/api/payrollnz/employees/) |
| Payroll NZ LeavePeriod | `periodStartDate` / `periodEndDate` | plain ISO string, tz-naive | `string` | `string` | `formatDate` (regex/slice fast path) | [payrollnz/employees](https://developer.xero.com/documentation/api/payrollnz/employees/) |
| Payroll NZ EmployeeLeaveType | `scheduleOfAccrualDate` | plain ISO string, tz-naive | `string` | `string` | `formatDate` (regex/slice fast path) | [payrollnz/employees](https://developer.xero.com/documentation/api/payrollnz/employees/) — **note:** this field lives on `EmployeeLeaveType`, not `LeaveType`; confirmed in `src/tools/list/list-payroll-employee-leave-types.tool.ts:55-56`, matching design.md's file assignment |
| Payroll NZ LeaveType | `updatedDateUTC` | ISO/`/Date(/` | `Date` | `Date` | `formatDateTime` | [payrollnz/employees](https://developer.xero.com/documentation/api/payrollnz/employees/) |
| Payroll NZ Timesheet | `startDate` / `endDate` | plain ISO string, tz-naive | `string` (required, non-optional) | `string` | `formatDate` (regex/slice fast path) | [payrollnz/timesheets](https://developer.xero.com/documentation/api/payrollnz/timesheets) |
| Payroll NZ Timesheet | `updatedDateUTC` | ISO/`/Date(/` | `Date` | `Date` | `formatDateTime` | [payrollnz/timesheets](https://developer.xero.com/documentation/api/payrollnz/timesheets) |
| Payroll NZ TimesheetLine | `date` | plain ISO string, tz-naive | `string` (required) | `string` | `formatDate` (regex/slice fast path) | [payrollnz/timesheets](https://developer.xero.com/documentation/api/payrollnz/timesheets) |

## Cross-Boundary Reference Map

| Source | Output | Format | Consumed By | Input | Expected Format | Match? |
|---|---|---|---|---|---|---|
| Xero Accounting API wire JSON | `Invoice.Date`, `.DueDate`, `.FullyPaidOnDate`, `Organisation.PeriodLockDate`, `Payment.Date`, `ManualJournal.Date`, `BankTransaction.Date`, `CreditNote.Date`, `Quote.Date`/`.ExpiryDate` | `/Date(ms+0000)/` string | `xero-node` `ObjectSerializer.deserialize` | field typed `string` in `.d.ts` | plain calendar-date string | **NO** — deserializer silently promotes to a real `Date` object at runtime despite the `.d.ts` `string` annotation. `formatDate` must `typeof`-check at runtime, not trust the type. Handled correctly by design's `formatDate` (Date branch). |
| Xero Payroll NZ wire JSON | `Employee.StartDate`, `Timesheet.StartDate/EndDate`, `TimesheetLine.Date`, `EmployeeLeave.StartDate/EndDate`, `LeavePeriod.PeriodStartDate/EndDate`, `EmployeeLeaveType.ScheduleOfAccrualDate` | tz-naive ISO string, e.g. `"1982-11-22T00:00:00"` | `xero-node` `ObjectSerializer.deserialize` | field typed `string` in `.d.ts` | plain calendar-date string | **YES** — genuinely stays a string. This is exactly the tz-shift-risk case design.md's regex/slice fast path exists for; do not let it fall through to `new Date(value).toISOString()`. |
| Xero Quotes wire JSON | `Quote.DateString`, `.ExpiryDateString` | tz-naive ISO string | `xero-node` `Quote` model | field typed `string` | plain calendar-date string | **YES** — same tz-shift-risk case as above. |
| Xero Reports wire JSON | `ReportWithRow.ReportDate` | human-readable string (`"15 June 2023"`) | `xero-node` `ReportWithRow` model | field typed `string` | plain calendar-date string | **YES**, but format is neither ISO-prefixed nor tz-naive-datetime — routes to `formatDate`'s non-prefixed `new Date(value)` parse branch, not the regex/slice fast path. |
| `formatDate`/`formatDateTime` output | `string \| undefined` | `YYYY-MM-DD` or full ISO 8601 | MCP `ToolResponse` text content | interpolated into template literals | plain text | **YES** — no further consumer downstream; this is the final render. |

## How the build agent should use this

1. **Never assume a field's `.d.ts` type predicts its runtime type.** Core Accounting API
   resources (Invoice, BankTransaction, CreditNote, Payment, ManualJournal, Organisation,
   Contact, Item) serialise calendar-date fields on the wire as `/Date(ms+0000)/`, which
   `xero-node` converts to real `Date` objects even when the `.d.ts` says `string`
   (`Invoice.date`, `Organisation.periodLockDate`, etc.). Route these through `formatDate`
   anyway — the function's `Date` branch handles them correctly. Do not write
   `field.slice(0, 10)` directly against any raw field; always go through the helper.
2. **The regex/slice fast path in `formatDate` exists for two real, not hypothetical, cases:**
   Payroll NZ date fields (`startDate`, `endDate`, `periodStartDate`, `periodEndDate`,
   `scheduleOfAccrualDate`, timesheet `date`) and `Quote.dateString`/`.expiryDateString`. Both
   are genuinely tz-naive ISO strings on the wire — `new Date("1982-11-22T00:00:00")` would
   apply local-timezone parsing and shift the date. This is why design.md's Task 1.2 (the
   fast path) must land before any payroll or quote date site is touched.
3. **`updatedDateUTC` / `createdDateUTC` are always `Date` objects at runtime**, confirmed
   across every resource in this feature (core Accounting, Payroll NZ, Reports) — route
   through `formatDateTime` unconditionally. Because a string never occurs for these fields,
   `formatDateTime`'s signature is deliberately `Date | undefined` (no string branch); any
   accidental string caller is caught at compile time rather than silently handled.
4. **`reportDate` is the one field needing `formatDate`'s "other string" parse branch**
   (`new Date(value)` general parse, not the regex fast path) — it is a human-readable string
   like `"15 June 2023"`, not ISO-prefixed. Design's Example 15 already covers this
   correctly; no change needed.
5. **`Bill.day` (Organisation payment terms) is a day-of-month integer, not a date** — never
   route it through `formatDate`/`formatDateTime`; render it as a plain number as design.md
   already specifies (`Day ${bills.day}`).
6. **`ExternalLink.url` is always a plain, already-decoded URL** — render it verbatim (`link.url
   ?? "No URL"`); do not re-encode.
7. **`LineItem.tracking` is confirmed as `Array<LineItemTracking>`** with `name`/`option` as
   the human-meaningful strings (camelCase in `xero-node`, `Name`/`Option` on the wire) — no
   further reconciliation needed for design.md's tracking render fix.

## Not Found

None. Every field in scope was resolved either via a direct developer.xero.com fetch (Organisation endpoint) or via developer.xero.com-sourced search results/quotes (Invoices, Quotes, Payments, CreditNotes, Reports, Payroll NZ Employees/Timesheets, Requests-and-Responses date-format page) cross-checked against the installed `xero-node` `.d.ts` and `ObjectSerializer` deserialization logic in `node_modules/xero-node/dist/gen/model/accounting/models.js`. Several direct `WebFetch` calls to developer.xero.com timed out (Invoices, Quotes, Trackingcategories, Types, Purchaseorders, Requests-and-Responses pages) — for those, the same page content was independently corroborated via `WebSearch` result snippets (which extract and quote the live page text) rather than a full-page fetch; no claim in this document rests on a single unverified source.
