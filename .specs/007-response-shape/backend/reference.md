# Reference: 007-response-shape
**Layer:** backend
**Last updated:** 2026-07-20
**Source:** Vendored `node_modules/xero-node/dist` typings (ground truth) + MDN (verified via WebFetch) + zod v3.25 vendored source (`node_modules/zod/src/v3/types.ts`) + web search (Xero Accounting API docs) + existing repo test patterns.

## Overview

This feature touches three small surfaces: the `JSON.stringify` replacer in
`json-response.ts`, a new `transformReport` walking `xero-node`'s report row
tree, and an optional `where` clause on `getAccounts`. Documentation was
gathered to nail exact JS/TS semantics the build agent must get right on the
first pass: `JSON.stringify` replacer visit order and array-vs-object
undefined handling, zod's `.optional().default()` parse order, and — most
important — the **runtime vs. compile-time shape of `xero-node`'s `RowType`
enum**, which surfaces a real contradiction with design.md/todo.md's
pseudocode. See the Gotcha below before writing `report-envelope.ts`.

---

## GOTCHA (read first): `RowType` is a TypeScript enum, not a string-literal union — comparing with raw string literals will fail `tsc --strict`

design.md and todo.md write the row-walking logic as `rowType === "Header"` /
`"Section"` / `"Row"` / `"SummaryRow"`. **Do not write it that way.**
`ReportRows.rowType` and `ReportRow.rowType` are typed `RowType | undefined`,
where `RowType` is a real TypeScript enum exported from `xero-node`:

```ts
// node_modules/xero-node/dist/gen/model/accounting/rowType.d.ts
export declare enum RowType {
    Header,
    Section,
    Row,
    SummaryRow
}
```

The compiled JS confirms it is a **string enum at runtime** (values are the
literal strings "Header"/"Section"/"Row"/"SummaryRow", matching what Xero's
JSON actually sends):

```js
// node_modules/xero-node/dist/gen/model/accounting/rowType.js
RowType[RowType["Header"] = 'Header'] = "Header";
RowType[RowType["Section"] = 'Section'] = "Section";
RowType[RowType["Row"] = 'Row'] = "Row";
RowType[RowType["SummaryRow"] = 'SummaryRow'] = "SummaryRow";
```

TypeScript string enums are **nominally typed**: a plain string literal is not
assignable to (and not comparable against) the enum type, even when its text
matches an enum member's value. Writing `row.rowType === "Header"` against a
`RowType`-typed value triggers:

```
TS2367: This comparison appears to be unintentional because the types
'RowType' and '"Header"' have no overlap.
```

`npm run build` runs `tsc` with `strict: true`, so this is a **hard build
failure**, not a lint nit. (The related ESLint rule
`@typescript-eslint/no-unsafe-enum-comparison` documents the same footgun,
though it isn't enabled in this repo's `recommended` config — the raw
compiler still catches it.)

**Fix:** import `RowType` from `xero-node` and compare against its members:

```ts
import { RowType, type ReportWithRow, type ReportRows, type ReportRow,
         type ReportCell, type ReportAttribute } from "xero-node";

for (const row of report.rows ?? []) {
  switch (row.rowType) {
    case RowType.Header:   /* ... */ break;
    case RowType.Section:  /* ... */ break;
    case RowType.SummaryRow: /* top-level SummaryRow, per design.md */ break;
    default:
      console.warn(`Unknown top-level rowType: ${String(row.rowType)}`);
  }
}
```

This applies everywhere design.md's pseudocode says `rowType === "Header"` /
`"Section"` / `"Row"` / `"SummaryRow"` — Tasks 2.1, 2.2, 2.5, 2.6, 2.8 all
need `RowType.*` members, not string literals. No other code change is
implied; `RowType` is exported from the package root
(`xero-node/dist/index.d.ts` → `export * from './gen/model/accounting/models'`
→ `export * from './rowType'`), so a normal named import works.

---

## JSON.stringify replacer semantics (MDN)

### Key facts

- **Visit order is pre-order (parent before children).** The replacer is
  first called on the root value with `key === ""`, then on each property/
  element of that value, recursing depth-first. This is *why* design.md's
  empty-object pruning is out of scope: by the time a parent object's own
  replacer call happens, its children haven't been visited/pruned yet, so you
  cannot know from inside the parent's call whether it will end up empty.
  Making that work would require a separate pre-pass over the tree before
  `JSON.stringify` runs — explicitly rejected in design.md as unnecessary
  complexity for cosmetic gain.
- **Returning `undefined` omits the key — for object properties only.**
- **Arrays never lose elements/indices.** If the replacer returns `undefined`
  for an array element, that element serializes as `null`, not omitted. This
  is a real MDN-documented distinction between object keys and array indices.

### Verified example (own calculation, not just source text)

```js
const replacer = (key, v) => (v === "" || v === null) ? undefined : v;

JSON.stringify(["a", "", 0, null, "b"], replacer);
// => '["a",null,0,null,"b"]'
//     index 1 ("") and index 3 (null) become `null` in the array — NOT removed,
//     array length/index alignment is preserved. Index 2 (0) survives untouched.

JSON.stringify({ a: "a", b: "", c: 0, d: null, e: "b" }, replacer);
// => '{"a":"a","c":0,"e":"b"}'
//     b and d are omitted entirely — object-property semantics differ from array semantics.
```

### Why this is safe for this feature

`jsonResponse`'s replacer (`v === "" || v === null ? undefined : v`) only
matters for **arrays of objects** in this codebase (`rows: ReportDataRow[]`,
`sections: ReportSection[]`, list-tool `rows: T[]`) — never arrays of bare
scalars. So the "elements become `null`" caveat never actually fires in
practice: a `ReportDataRow` or list row that would've been `""`/`null` is a
whole *object*, not a scalar array element, so it still gets its keys pruned
normally. No guard on `typeof key` is needed. Flag this in code review only if
a future feature ever serializes a raw array of strings/numbers through
`jsonResponse` — then an empty string inside that array would silently become
`null` instead of vanishing.

### Attribution
MDN Web Docs, `JSON.stringify()` reference — replacer function behavior,
verified via WebFetch 2026-07-20.

---

## zod 3.25 — `.optional().default(true)` semantics

### Vendored source (ground truth)

```ts
// node_modules/zod/src/v3/types.ts (ZodDefault._parse)
_parse(input: ParseInput): ParseReturnType<this["_output"]> {
  const { ctx } = this._processInputParams(input);
  let data = ctx.data;
  if (ctx.parsedType === ZodParsedType.undefined) {
    data = this._def.defaultValue();
  }
  return this._def.innerType._parse({ data, path: ctx.path, parent: ctx });
}
```

`z.boolean().optional().default(true)` builds `ZodDefault<ZodOptional<ZodBoolean>>`.
`ZodDefault._parse` checks **only** whether the *input to this parser* is
`undefined` — it does not care that the inner type is `ZodOptional`. Chaining
`.optional()` before `.default()` is a no-op for parsed output (it only
affects the *input* type signature, allowing `undefined` as a valid input
before defaulting kicks in — which `.default()` already permits on its own).

### Parsed values for `activeOnly: z.boolean().optional().default(true)`

| Client sends | Parsed value | Why |
|---|---|---|
| key omitted entirely | `true` | `ctx.parsedType === undefined` → `defaultValue()` substituted |
| `activeOnly: false` | `false` | input is not `undefined` → passes through untouched |
| `activeOnly: true` | `true` | input is not `undefined` → passes through untouched |

This matches design.md/todo.md's assumption exactly (`activeOnly !== false`
check for the `where` clause is safe): the output type is always `boolean`,
never `undefined`, regardless of ordering. **No gotcha here** — included for
completeness since the task explicitly asked to confirm ordering semantics.

### Code example (tool boundary pattern, matches existing `CreateXeroTool` usage)

```ts
const ListAccountsTool = CreateXeroTool(
  "list-accounts",
  "...",
  {
    activeOnly: z.boolean().optional().default(true)
      .describe("When true (default), returns only ACTIVE accounts."),
  },
  async ({ activeOnly }) => {
    // activeOnly is `boolean` here (never undefined) — safe to compare directly.
    const where = activeOnly !== false ? 'Status=="ACTIVE"' : undefined;
    const response = await listXeroAccounts(where);
    // ...
  },
);
```

---

## xero-node ^13.3 — Report typings and `getAccounts`

### Vendored typings (ground truth — `node_modules/xero-node/dist/gen/model/accounting/`)

```ts
// reportWithRow.d.ts
export declare class ReportWithRow {
    'reportID'?: string;
    'reportName'?: string;
    'reportTitle'?: string;
    'reportType'?: string;
    'reportTitles'?: Array<string>;
    'reportDate'?: string;
    'rows'?: Array<ReportRows>;
    'updatedDateUTC'?: Date;
    'fields'?: Array<ReportFields>;
}

// reportRows.d.ts — TOP-LEVEL rows (Header | Section | SummaryRow)
export declare class ReportRows {
    'rowType'?: RowType;
    'title'?: string;
    'cells'?: Array<ReportCell>;     // populated on Header, SummaryRow
    'rows'?: Array<ReportRow>;       // populated on Section (nested data rows)
}

// reportRow.d.ts — NESTED rows inside a Section (Row | SummaryRow)
// Note: ReportRow has NO further nested `rows` — matches design.md's
// two-level walk (top-level ReportRows -> nested ReportRow, no deeper nesting).
export declare class ReportRow {
    'rowType'?: RowType;
    'title'?: string;
    'cells'?: Array<ReportCell>;
}

// reportCell.d.ts
export declare class ReportCell {
    'value'?: string;
    'attributes'?: Array<ReportAttribute>;
}

// reportAttribute.d.ts
export declare class ReportAttribute {
    'id'?: string;
    'value'?: string;
}
```

`RowType` — see the GOTCHA section above; import it as a value (not
`import type`) since you need the enum members at runtime for the `switch`/
`===` comparisons:

```ts
import { RowType } from "xero-node";
import type { ReportWithRow, ReportRows, ReportRow, ReportCell, ReportAttribute } from "xero-node";
```

### `getAccounts` signature (`accountingApi.d.ts`)

```ts
getAccounts(
  xeroTenantId: string,
  ifModifiedSince?: Date,
  where?: string,
  order?: string,
  options?: { headers: { [name: string]: string } },
): Promise<{ response: AxiosResponse; body: Accounts }>;
```

Confirms design.md's Task 4.1 exactly: `where` is the **3rd** positional
argument, a plain `string`. Current handler code
(`src/handlers/list-xero-accounts.handler.ts`) already calls this with
`undefined` in that slot — the diff is purely threading a `where?: string`
parameter through to that slot, no signature surprises.

### Xero Accounts API `where` clause syntax (web-sourced, since Context7 has no xero-node/Xero API docs entry)

- Syntax: `Status=="ACTIVE"` — double-equals, double-quoted string value, no
  surrounding quotes needed around the whole clause when passed as a plain JS
  string (the SDK URL-encodes it).
- Compound example (not needed for this feature, noted for completeness):
  `Status=="ACTIVE" AND Type=="BANK"`.
- Xero's own guidance: prefer simple `==` filters for performance on large
  orgs — matches this feature's single-condition `Status=="ACTIVE"` default.

---

## Vitest 4.x — hoisted-mock module pattern (from existing repo tests)

Summarized from `src/__tests__/tools/list-invoices.tool.test.ts` and
`src/__tests__/helpers/json-response.test.ts` — this is the pattern the new
`list-trial-balance.tool.test.ts` and `list-accounts.tool.test.ts` (todo Tasks
3.1, 4.2) must follow.

### Pattern: mock a handler module before importing the tool under test

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted lifts this above the vi.mock call below (which itself is hoisted
// above all imports by Vitest) — required because the mock factory references it.
const { listXeroInvoices } = vi.hoisted(() => ({ listXeroInvoices: vi.fn() }));

vi.mock("../../handlers/list-xero-invoices.handler.js", () => ({ listXeroInvoices }));

// Import the tool AFTER the mock is registered — the tool module's own
// `import { listXeroInvoices } from "..."` will resolve to the mock.
import ListInvoicesTool from "../../tools/list/list-invoices.tool.js";

beforeEach(() => {
  listXeroInvoices.mockReset();
});

it("...", async () => {
  listXeroInvoices.mockResolvedValue({ result: [...], isError: false, error: null });

  const result = await ListInvoicesTool().handler({ page: 1 } as never, {} as never);
  const content = result.content as { type: "text"; text: string }[];
  expect(content).toHaveLength(1);
  const parsed = JSON.parse(content[0].text);
  // assertions on parsed shape
});
```

### Notes for this feature's new test files

- `list-trial-balance.tool.test.ts` mocks `listXeroTrialBalance` the same way
  (module path: `../../handlers/list-xero-trial-balance.handler.js`).
- `list-accounts.tool.test.ts` mocks `listXeroAccounts`, asserting the `where`
  argument the mock was **called with** (`expect(listXeroAccounts).toHaveBeenCalledWith('Status=="ACTIVE"')`
  / `toHaveBeenCalledWith(undefined)`), not the response shape — see design.md
  Examples 10-11.
- `ListXTool()` is called as a **function** (`ListInvoicesTool()`), returning
  an object with `.handler(args, extra)` — match this call shape exactly, it
  is `CreateXeroTool`'s factory convention, not a plain object export.
- Asserting "single minified block, no `\n`": `expect(content[0].text).not.toContain("\n")`
  is the direct way to prove `JSON.stringify` (no `, 2` indentation arg) was
  used, per design.md Example 1.

### Attribution
`src/__tests__/tools/list-invoices.tool.test.ts`,
`src/__tests__/helpers/json-response.test.ts` (this repo, feature
006-json-everywhere).

---

## Cross-Boundary Reference Map

| Source | Output | Format | Consumed By | Input | Expected Format | Match? |
|---|---|---|---|---|---|---|
| `xero-node` `ReportRows.rowType` / `ReportRow.rowType` | `rowType` | `RowType` enum (TS nominal type; runtime value is the string `"Header"`\|`"Section"`\|`"Row"`\|`"SummaryRow"`) | `transformReport` row-walking `switch`/`===` (design.md pseudocode: `rowType === "Header"`) | comparison operand | design.md assumes a plain string literal | **NO — fix: import `RowType` from `xero-node` and compare against `RowType.Header`/`.Section`/`.Row`/`.SummaryRow`, not string literals. Raw string literals fail `tsc --strict` with TS2367.** |
| `list-accounts.tool.ts` `activeOnly` (zod-parsed) | `where` string built from `activeOnly` | `'Status=="ACTIVE"'` (JS string, unescaped) | `xeroClient.accountingApi.getAccounts` | `where` (3rd positional arg) | plain `string`, URL-encoded by the SDK/axios layer | YES — no transformation needed, matches directly |
| `xero-node` `ReportWithRow.updatedDateUTC` | `updatedDateUTC` | `Date` object (already deserialized by the SDK's JSON parsing) | `formatDateTime` (`src/helpers/format-date.ts`) | `value: Date \| undefined` | `Date \| undefined` | YES — matches directly, no transform needed beyond the existing helper |
| `xero-node` `ReportWithRow.reportDate` | `reportDate` | `string` (non-ISO, e.g. `"20 July 2026"`) | `formatDate` (`src/helpers/format-date.ts`) | `value: Date \| string \| undefined` | handles non-ISO date strings via local-midnight parsing (see helper source) | YES — helper already built for this exact non-ISO format; no change needed |

---

## Not Found

- **Context7 has no entry for `xero-node`, the Xero Accounting API, or MCP SDK
  zod-schema conversion internals** — resolved via vendored typings (ground
  truth, preferred over docs per the task) and targeted web search for the
  `where`-clause syntax.
