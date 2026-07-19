# Design: 006-json-everywhere

**Layer:** backend · **Status:** Confirmed (revised per design-review) · **Last updated:** 2026-07-19

## Overview
Replace the read tools' bespoke text formatters with raw-JSON passthrough. Net *deletion* of code
(per-tool text builders, `pagination-hint.ts`, `format-line-item.ts`), lower maintenance (no curated
field lists; new Xero / upstream fields flow through untouched), and the `0`-value truthy-guard bug
disappears for free.

## Components

### 1. New helper — `src/helpers/json-response.ts`
Two small functions; `jsonResponse` is the single place that wraps a JSON value in a content block.
```ts
export function jsonResponse(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}

// list envelope: { showing, [hasMore], rows }. hasMore is the server-computed
// "another page likely exists" signal (preserves feature 005's paginationHint),
// emitted only when the caller knows its page size.
export function listResponse<T>(rows: T[] | null, pageSize?: number) {
  const list = rows ?? [];
  return jsonResponse({
    showing: list.length,
    ...(pageSize != null ? { hasMore: list.length === pageSize } : {}),
    rows: list,
  });
}
```

### 2. Per-tool conversion
- **20 text list tools** — success branch becomes `return listResponse(response.result)`. The **5
  transaction tools** (invoices, manual-journals, bank-transactions, credit-notes, payments) pass their
  page size: `return listResponse(response.result, 1000)` so `hasMore` is computed. Delete the
  `Found N:` header, the record `.map(...)` text builder, and now-unused imports.
- **`list-organisation-details` — SPECIAL CASE.** Its handler returns a single `Organisation`, not an
  array. Do **not** use `listResponse`. Use `jsonResponse(response.result)` (raw object).
- **`get-payroll-timesheet` — SPECIAL CASE.** Handler returns `Timesheet | null` on the success path.
  **Keep the null check:** if `response.result` is null, return the current "No timesheet found with
  ID: …" text message; otherwise `jsonResponse(response.result)`.

### 3. Removed (dead after conversion)
- `src/helpers/pagination-hint.ts` + `src/__tests__/helpers/pagination-hint.test.ts`; all
  `paginationHint(...)` call sites (5 transaction tools) — replaced by `hasMore`.
- `src/helpers/format-line-item.ts` — after converting invoices + bank-transactions (its only two
  callers), it is orphaned. Delete it (and any test).

### 4. Unchanged
- 5 report tools (already `JSON.stringify(..., null, 2)`) — left as-is; residual pretty-vs-minified
  inconsistency **explicitly accepted** (converting them adds risk for no real gain). create/update/
  delete tools. Error branches keep the `formatError` text message.

## Edge cases
- **Dates:** `xero-node` deserialises Xero's `/Date(…)/` → JS `Date`; `JSON.stringify(Date)` → ISO.
  **Load-bearing — VERIFY ON DEV** for a real invoice before shipping (some date fields are typed
  `string`; relies on the serializer upgrading them). If any surface as raw `/Date(…)/`, revisit.
- **PII — accepted (owner decision, internal-only).** Raw passthrough surfaces fields the curated text
  omitted, notably `dateOfBirth` + home `address` on `list-payroll-employees`. Accepted: the server is
  Entra-gated internal-only and users already have Xero payroll access. Documented here so it's a
  conscious decision; revisit if the server is ever exposed more broadly. (Contacts already uses
  `summaryOnly`, so bank/tax details stay excluded.)
- **Enums** serialise to their underlying string value (spot-check `sourceType`, `status`, `type`).
- **`0`/null/undefined:** `0` renders; `undefined` keys dropped; `null` → `null`. Fixes the zero bug.
- **Circular refs** would make `JSON.stringify` throw — `xero-node` results are plain DTOs; verify on
  dev across one tool per shape.

## Impact / Risk
- **Public output-contract change** across 21 tools (text → JSON). Consumers that string-matched the
  old text see JSON. Owner-approved; recorded in **ADR-0005** and shipped as **minor v0.3.0**.
- **Verbosity** (raw > curated). Accepted trade (extractability + spill-to-file).
- **Low correctness blast radius** — serialisation swap, no business logic. Per-tool diff still
  eyeballed for anything the raw object lacks (grounding check found no deep-links/derived fields lost;
  line items are present as nested objects).

## Testing Strategy
**Mode:** full-tdd (light). **Commands:** `npm run test` / `npm run build` / `npm run lint`.
- `json-response.test.ts` — `jsonResponse` wraps any value; `listResponse` envelope shape, `showing`
  count, empty case, a `0`-valued field survives, `hasMore` true when `rows.length === pageSize` and
  false/absent otherwise.
- Rewrite `list-invoices.tool.test.ts` — assert the tool returns one content block that `JSON.parse`s
  to `{showing, hasMore, rows}` with the mocked objects intact.
- Auth/http suites stay green.
- **Live (dev):** `list-invoices` returns valid JSON (`jq '.rows|length'`); **confirm dates are ISO**;
  spot-check a nested-object tool (no circular crash).

## ADR / upstream
- **Write ADR-0005** — "read tools emit raw JSON passthrough"; clarify the PRD §2 "never modify the
  public MCP tool contract" governs tool **names/parameters/coverage**, not output **format** (which is
  fork-owned, per the 004 precedent). Update PRD §2 with a one-line clarification.
- Fork-local, touching upstream-owned `src/tools/**` + `src/helpers/**` — extends the 004 exception;
  add a REPO.md line.
