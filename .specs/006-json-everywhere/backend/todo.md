# Todo: 006-json-everywhere

**Layer:** backend · **Status:** In Progress

Ordered, file-level. TDD-light: helper test first, then the mechanical sweep, verifying green throughout.

## Phase 1 — helper
1. [x] `src/helpers/json-response.ts` — `jsonResponse(value)` + `listResponse(rows, pageSize?)` per design
   (envelope `{showing, [hasMore], rows}`; `hasMore = rows.length === pageSize` when pageSize given).
   - Completed: 2026-07-19
2. [x] `src/__tests__/helpers/json-response.test.ts` — `jsonResponse` wraps any value; `listResponse`
   envelope shape, `showing`, empty case, `0`-value survives, `hasMore` true/false/absent per pageSize.
   - Completed: 2026-07-19
   - Tests: src/__tests__/helpers/json-response.test.ts

## Phase 2 — remove dead helpers
3. [x] Delete `src/helpers/pagination-hint.ts` + `src/__tests__/helpers/pagination-hint.test.ts`; remove
   `paginationHint` import + call in the 5 transaction tools.
   - Completed: 2026-07-19
4. [x] Delete `src/helpers/format-line-item.ts` (+ any test) — orphaned once invoices + bank-transactions
   convert. (Leave `format-tracking-option`; still used by create/update-tracking-options.)
   - Completed: 2026-07-19

## Phase 3 — convert read tools (raw passthrough)
5. [x] Convert the **20 text list tools** → `return listResponse(response.result)`, deleting the text
   `.map(...)` builder, `Found N:` header, and now-unused imports:
   `list-accounts, list-bank-transactions, list-contact-groups, list-contacts, list-credit-notes,`
   `list-invoices, list-items, list-manual-journals, list-payments,`
   `list-payroll-employees, list-payroll-employee-leave, list-payroll-employee-leave-balances,`
   `list-payroll-employee-leave-types, list-payroll-leave-periods, list-payroll-leave-types,`
   `list-payroll-timesheets, list-quotes, list-tax-rates, list-tracking-categories` (19)
   + the **5 transaction tools** pass page size: `listResponse(response.result, 1000)`.
   - Completed: 2026-07-19
6. [x] **`list-organisation-details`** (SPECIAL — single object): `return jsonResponse(response.result)`.
   - Completed: 2026-07-19
7. [x] **`get-payroll-timesheet`** (SPECIAL — nullable): keep the null branch ("No timesheet found…"),
   else `jsonResponse(response.result)`.
   - Completed: 2026-07-19
8. [x] Tool descriptions that referenced text pagination → keep the concrete page size, reword to reference
   `hasMore`/`showing` (e.g. "if `hasMore` is true, call the next page").
   - Completed: 2026-07-19

## Phase 4 — tests, ADR, docs
9. Rewrite `src/__tests__/tools/list-invoices.tool.test.ts` — assert the JSON envelope (parse + shape),
   drop the old text/hint assertions.
10. Write `.specs/adr/0005-*.md` (raw JSON output contract) + one-line PRD §2 clarification.
11. `.specs/REPO.md` — extend the upstream-isolation exception note to 006.

## Out of scope (do NOT touch)
- 5 report tools (already JSON). create/update/delete tools. Error branches (keep `formatError` text).

## Verification
- `npm run build` / `npm run test` / `npm run lint` green.
- Dev live: `list-invoices` returns valid JSON; **confirm dates are ISO** (not `/Date()/`); spot-check
  a nested-object tool (no circular crash).
