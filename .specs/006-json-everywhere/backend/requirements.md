# Requirements: 006-json-everywhere

**Layer:** backend · **Status:** Confirmed · **Target release:** v0.3.0 · **Last updated:** 2026-07-19

## Problem
Read tools return human-readable **text blocks**, awkward to extract from — especially now that
`pageSize` is 1000 (large responses that clients spill to file and filter with `jq`). The 5 report
tools already emit JSON, so the surface is inconsistent. Separately, the text formatters use
`x ? … : null` truthy guards that **silently drop numeric `0`** (a paid invoice's `Amount Due: 0`
disappears, indistinguishable from a missing field).

## Goal
One consistent, machine-extractable JSON contract across the read tools, achieved with the **lowest
possible ongoing maintenance** (owner priority) — i.e. raw passthrough of what the handlers already
return, not per-tool curated field lists.

## Functional requirements
1. Each converted **list** tool returns a single minified-JSON content block:
   `{ "showing": <row count>, "rows": [ …raw handler result objects… ] }`.
2. The single **get** tool returns the raw result object as minified JSON.
3. Output is **raw passthrough** — whatever the handler's `xero-node` result contains — so new Xero
   fields and upstream handler changes flow through with no per-tool edits.
4. Numeric `0` values are present in the output (closes `zero-value-numeric-rendering.md`).
5. Dates appear as ISO strings; nested objects (line items, tracking) appear as nested JSON.
6. The `paginationHint` helper is **removed**; replaced by a server-computed **`hasMore`** boolean in
   the list envelope (`rows.length === pageSize`, emitted for the tools with a known page size — the 5
   transaction tools). Preserves feature 005's "another page likely exists" signal in JSON form.

## Scope
- **In:** the ~20 read tools that currently return text (the `list-*` tools that are not reports) +
  the 1 `get-*` tool.
- **Out:** the 5 report tools (`aged-payables`, `aged-receivables`, `profit-and-loss`,
  `balance-sheet`, `trial-balance`) — already JSON, left as-is. The `create/update/delete` tools —
  mutations returning status confirmations, not data to extract, left as-is. Error branches stay as
  the `formatError` text message.

## Acceptance criteria
- **AC1** — Given >0 invoices, When `list-invoices({page:1})`, Then the response is one content block
  of minified JSON `{"showing":N,"rows":[…]}`, `jq '.rows | length'` works, a paid invoice shows
  `"amountDue":0`, dates are ISO strings, and line items appear as nested JSON when requested.
- **AC2** — Given the conversion, Then `src/helpers/pagination-hint.ts` and its test are deleted and
  no `paginationHint` reference remains.
- **AC3** — The 5 report tools and all create/update/delete tools are unchanged.
- **AC4** — `npm run build` / `npm run test` / `npm run lint` green; live dev check: `list-invoices`
  returns valid parseable JSON.

## Known impact & decisions (see design.md · ADR-0005)
- **Public output-contract change** for every read tool (text → JSON); consumers parsing the old text
  format see JSON. Deliberate, owner-approved, recorded in **ADR-0005** (which clarifies PRD §2:
  "contract" = names/params/coverage, not output format).
- **PII accepted (internal-only):** raw passthrough surfaces `dateOfBirth`/home `address` on
  `list-payroll-employees` that the text tools omitted. Accepted given Entra-gated internal use.
