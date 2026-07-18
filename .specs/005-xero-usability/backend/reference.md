# Reference: Xero Usability — GL Access, Pagination & Session Persistence
**Layer:** backend
**Last updated:** 2026-07-18
**Source:** Installed `xero-node` ^13.3.0 type declarations + compiled source (`node_modules/xero-node/dist/gen/`), existing repo code (`src/tools/list/list-manual-journals.tool.ts`, `src/handlers/`), and official Xero developer docs (web, for endpoint semantics not present in the SDK's JSDoc).

## Overview

The only genuinely new integration in this feature is the Xero **Journals** endpoint (`accountingApi.getJournals`), consumed by the new `list-xero-account-transactions.handler.ts` (design.md A1). Everything else — the `pageSize` bump on five existing handlers and the `zod` schema for the new tool — follows patterns already present verbatim in this codebase, so those sections point at the exact installed signatures and the exact existing file to copy the idiom from, rather than generic library docs. One runtime behaviour is load-bearing for correctness: `xero-node`'s `ObjectSerializer.deserialize` silently upgrades certain `"string"`-typed fields (including `Journal.journalDate`) into real JS `Date` objects when the wire value is Xero's `/Date(...)/` format — confirmed directly in the installed source below. This is why design.md/todo.md mandate `formatDate()` before any date comparison.

## xero-node — Journals Endpoint

### Key APIs

- `accountingApi.getJournals(xeroTenantId: string, ifModifiedSince?: Date, offset?: number, paymentsOnly?: boolean, options?: { headers: {...} }): Promise<{ response: AxiosResponse; body: Journals }>`
  Confirmed signature and parameter order from `node_modules/xero-node/dist/gen/api/accountingApi.d.ts:2138`. Note there is **no `where`/`order`/`page`/`pageSize` parameter** — Journals has a fundamentally different pagination model than every other list endpoint in this codebase.

  Installed JSDoc (same file, lines 2130-2137), verbatim:
  ```
  @summary Retrieves journals
  @param xeroTenantId Xero identifier for Tenant
  @param ifModifiedSince Only records created or modified since this timestamp will be returned
  @param offset Offset by a specified journal number. e.g. journals with a JournalNumber greater than the offset will be returned
  @param paymentsOnly Filter to retrieve journals on a cash basis. Journals are returned on an accrual basis by default.
  ```
  This directly confirms design.md's two load-bearing claims: (a) `ifModifiedSince` filters by **creation/modification** timestamp, not `JournalDate`; (b) `offset` is a `JournalNumber` cursor — "greater than" (exclusive), not an index.

- `Journals` — response body wrapper. `{ warnings？: ValidationError[]; journals?: Journal[] }` (`node_modules/xero-node/dist/gen/model/accounting/journals.d.ts`).

- `Journal` fields relevant to this feature (`node_modules/xero-node/dist/gen/model/accounting/journal.d.ts`):
  | Field | Declared type | Notes |
  |---|---|---|
  | `journalID` | `string` | |
  | `journalDate` | `string` | **Declared `string` but see Gotchas — runtime value is often a JS `Date`.** |
  | `journalNumber` | `number` | The offset cursor value |
  | `sourceType` | `Journal.SourceTypeEnum` | String enum (`"ACCREC"`, `"ACCPAY"`, `"MANJOURNAL"`, etc.) — deserializes as a plain string at runtime |
  | `journalLines` | `Array<JournalLine>` | |

- `JournalLine` fields relevant to this feature (`node_modules/xero-node/dist/gen/model/accounting/journalLine.d.ts`):
  | Field | Declared type | Notes |
  |---|---|---|
  | `accountID` | `string` | UUID — match target when `account` param is a UUID |
  | `accountCode` | `string` | e.g. `"631"` — match target when `account` param is not a UUID |
  | `accountName` | `string` | |
  | `description` | `string` | "Only returned if populated" per SDK doc comment |
  | `netAmount` | `number` | Positive = debit, negative = credit |
  | `grossAmount` | `number` | `netAmount + taxAmount` |
  | `taxAmount` | `number` | |
  | `taxType` | `string` | |

### Code Examples

Paging loop shape (matches design.md A1.3 / todo.md Task 2.3), using the confirmed positional signature:

```typescript
let currentOffset = offset ?? 0;
const journals: Journal[] = [];

for (let page = 0; page < MAX_PAGES_PER_CALL; page++) {
  const response = await xeroClient.accountingApi.getJournals(
    xeroClient.tenantId,
    ifModifiedSince,       // Date | undefined — see derivation below
    currentOffset,
    false,                 // paymentsOnly — accrual basis (design.md's assumption)
    getClientHeaders(),
  );

  const page_ = response.body.journals ?? [];
  journals.push(...page_);
  if (page_.length > 0) {
    currentOffset = Math.max(...page_.map((j) => j.journalNumber ?? currentOffset));
  }
  if (page_.length < 100) break; // Xero's last page — see offset semantics above
}
```

`ifModifiedSince` derivation (todo.md Task 2.2) — `Date` argument, not a string:

```typescript
const ifModifiedSince = fromDate ? new Date(fromDate) : undefined;
```

### Configuration

No client configuration beyond what `xeroClient` already provides (`xeroClient.tenantId`, `xeroClient.authenticate()`, `getClientHeaders()`). No new env vars.

### Gotchas

1. **The `/Date(...)/` wire format silently upgrades declared-`string` fields to real `Date` objects.** Confirmed directly in `node_modules/xero-node/dist/gen/model/accounting/models.js` (the shared `ObjectSerializer`):

   ```javascript
   // ObjectSerializer.deserialize, primitives branch:
   if (type === "string" && data.toString().substring(0, 6) === "/Date(") {
     return this.deserializeDateFormats(type, data); // returns a real Date
   }

   static deserializeDateFormats(type, data) {
     const isDate = new Date(data);
     if (isNaN(isDate.getTime())) {
       const re = /-?\d+/;
       const m = re.exec(data);
       return new Date(parseInt(m[0], 10)); // parses the /Date(1749087600000+0000)/ epoch-ms literal
     }
     return isDate;
   }
   ```

   `Journal.journalDate` is declared `"type": "string"` in `Journal.attributeTypeMap` (`journal.js`), but Xero's wire value for a date field is `"/Date(1749087600000+0000)/"`, which trips the `substring(0, 6) === "/Date("` check above regardless of the declared type. **At runtime `journal.journalDate` is a `Date` instance, not a string**, even though `tsc` believes the field is `string`. A raw `.slice(0, 10)` or string-prefix compare on `journal.journalDate` will throw or silently misbehave. This is exactly why `formatDate()` (`src/helpers/format-date.ts`) — which branches on `value instanceof Date` — must run before any comparison, per design.md step 5 / todo.md Task 2.4.

2. **`ifModifiedSince` ≠ `JournalDate` filter.** Confirmed by the SDK's own JSDoc ("created or modified since this timestamp"). A journal dated inside the requested window but posted/modified before it (back-dated entries, bulk imports, future-dated entries) is excluded server-side and cannot be recovered client-side. Already disclosed in design.md's tool description — no action needed beyond following the spec, but worth knowing this isn't an SDK bug, it's documented endpoint behaviour.

3. **100 journals per call, offset is exclusive.** Confirmed via Xero developer docs (`developer.xero.com/documentation/api/accounting/journals`): journals are always returned in batches of 100 (no `page`/`pageSize` param exists for this endpoint — unlike every other list endpoint in this codebase), ordered ascending by `JournalNumber`, and `offset` returns journals with `JournalNumber` **strictly greater than** the given value. A batch smaller than 100 is Xero's genuine last page — this is the sole valid stop condition distinguishing "exhausted" from "budget exhausted" (design.md A1.7 / todo.md Task 2.6).

4. **Scope + tier gating (operational, not code).** The endpoint requires the `accounting.journals.read` OAuth scope. Per Xero's current scope migration, this scope is only available to Xero app connections created before the cutover to granular scopes, and Xero has recently gated `/Journals` behind its Advanced pricing tier plus an explicit use-case approval for newer connections. This doesn't change any code in this feature, but if the tool starts 403'ing in a way `formatError`'s existing 403 mapping surfaces correctly, the fix is a Xero-side app/connection reauthorization or tier check, not a code change.

5. **`sourceType` deserializes as a plain string.** `Journal.SourceTypeEnum` is a TypeScript string enum (`ACCREC = 'ACCREC'`, etc.); `ObjectSerializer.deserialize`'s enum branch returns the raw string unchanged. `journal.sourceType` can be assigned straight into the row's `sourceType: string` field with no conversion.

## xero-node — pageSize bump (five existing handlers)

### Key APIs

Exact signatures confirmed from `node_modules/xero-node/dist/gen/api/accountingApi.d.ts`, with `pageSize`'s positional index called out (0-indexed after `xeroTenantId`):

| Method | Signature (positions) | `pageSize` position | Current call-site value |
|---|---|---|---|
| `getInvoices` | `(xeroTenantId, ifModifiedSince?, where?, order?, iDs?, invoiceNumbers?, contactIDs?, statuses?, page?, includeArchived?, createdByMyApp?, unitdp?, summaryOnly?, pageSize?, searchTerm?, options?)` | 14th (index 13) | `list-xero-invoices.handler.ts:28` — `10, // pageSize` |
| `getManualJournals` | `(xeroTenantId, ifModifiedSince?, where?, order?, page?, pageSize?, options?)` | 6th (index 5) | `list-xero-manual-journals.handler.ts:30` — `10, // pageSize` |
| `getBankTransactions` | `(xeroTenantId, ifModifiedSince?, where?, order?, page?, unitdp?, pageSize?, options?)` | 7th (index 6) | `list-xero-bank-transactions.handler.ts:19` — `10, // pagesize` |
| `getCreditNotes` | `(xeroTenantId, ifModifiedSince?, where?, order?, page?, unitdp?, pageSize?, options?)` | 7th (index 6) | `list-xero-credit-notes.handler.ts:20` — `10, // pageSize` |
| `getPayments` | `(xeroTenantId, ifModifiedSince?, where?, order?, page?, pageSize?, options?)` | 6th (index 5) | `list-xero-payments.handler.ts:49` — `10, // pageSize` |

Each is a single positional literal — the edit is `10` → `100` at the exact position shown, with no signature or argument-count change. Verified against the currently checked-in call sites (line numbers above match design.md's table exactly).

### Gotchas

- `getBankTransactions` and `getCreditNotes` share an identical parameter shape (`unitdp` before `pageSize`) — easy to mis-order if typed from memory; both are already correctly ordered in the existing code, so the task is a literal swap only, not a re-ordering.
- `getInvoices` has by far the longest signature (16 params); `pageSize` is second-to-last, immediately before `searchTerm`. The existing call site already comments each argument (`// pageSize`), so the literal to change is unambiguous.

## zod 3.25 — schema idiom (house style)

### Key APIs

This repo does not use generic `zod` idioms beyond what's already established in `src/tools/list/*.tool.ts`. The canonical pattern to copy for the new `list-account-transactions` tool's schema (todo.md Task 2.7) is `list-manual-journals.tool.ts`:

```typescript
{
  manualJournalId: z
    .string()
    .optional()
    .describe("Optional ID of the manual journal to retrieve"),
  modifiedAfter: z
    .string()
    .optional()
    .describe("Optional date YYYY-MM-DD to filter journals modified after this date"),
  page: z.number().optional().describe("Optional page number for pagination"),
}
```

Applied to this feature's four parameters (per design.md's API/Interface Design table):

```typescript
{
  account: z.string().describe("Xero account code (e.g. \"631\") or AccountID UUID"),
  fromDate: z.string().optional().describe("YYYY-MM-DD. Narrows server-side via ifModifiedSince and filters JournalDate >= fromDate"),
  toDate: z.string().optional().describe("YYYY-MM-DD. Filters JournalDate <= toDate. Open-ended when omitted"),
  offset: z.number().optional().describe("Continuation cursor from a previous call's nextOffset"),
}
```

### Configuration

No `zod` config beyond the raw shape object passed to `CreateXeroTool` (`src/helpers/create-xero-tool.ts`) — it forwards the shape directly to the MCP SDK's `ToolCallback<Args>` typing (`ZodRawShapeCompat`). No `.strict()`, `.refine()`, or custom error maps are used anywhere in the existing tool files; match that — do not introduce new zod idioms for this feature.

### Gotchas

- `account` is required (no `.optional()`) — every other field in this schema is optional. Don't copy-paste the `.optional()` suffix onto `account` by habit.
- Every existing tool's `.describe()` text is written for the *end user* reading the MCP tool list (plain language, not JSDoc-style) — keep the new schema's descriptions in that voice, matching the design.md-mandated completeness caveat wording for the tool's own top-level description (that caveat lives in `CreateXeroTool`'s `description` argument, not in the per-field `.describe()` calls).

## Cross-Boundary Reference Map

| Source | Output | Format | Consumed By | Input | Expected Format | Match? |
|---|---|---|---|---|---|---|
| `xero-node` `ObjectSerializer.deserialize` (Journal.journalDate) | `journal.journalDate` | Declared `string`; **actual runtime value is a `Date` instance** when wire value matches `/Date(...)/ ` | Handler's date-range filter (todo.md Task 2.4) | `journalDay` comparison (`>= fromDate`, `<= toDate`) | `YYYY-MM-DD` string, lexicographically comparable | NO as raw passthrough — fix: call `formatDate(journal.journalDate)` first (handles both `Date` and `string` inputs, per `src/helpers/format-date.ts`), then compare the normalised string |
| Tool schema `account: z.string()` | `account` param (e.g. `"631"` or a UUID) | Plain string | Handler's UUID regex test (todo.md Task 2.1) | `line.accountID` (UUID) or `line.accountCode` (code) | Both are plain `string` fields on `JournalLine` | YES — no transformation needed, only field selection based on the regex result |
| `getJournals`'s `journal.journalNumber` | `journalNumber: number` | Plain number | Continuation cursor (`nextOffset`) returned to the MCP client, then supplied back as the tool's `offset` param on the next call | `getJournals(..., offset, ...)` | `number \| undefined`, "greater than" cursor (exclusive) | YES — same type both directions, but note the **exclusive** semantics confirmed in the SDK JSDoc: the next call must NOT re-request the journal at `nextOffset` itself, it starts strictly after it |
| `Journal.sourceType` (`Journal.SourceTypeEnum`) | Raw string (e.g. `"ACCREC"`) — `ObjectSerializer` returns enums unchanged | Plain string at runtime despite the enum type annotation | Row assembly (`sourceType: journal.sourceType`) in the JSON envelope | `AccountTransactionRow.sourceType` | Plain string in the JSON output | YES — direct assignment, no cast or `.toString()` needed |

## Not Found

None. All library surfaces needed for this feature were resolved directly from the installed `xero-node` type declarations/compiled source and existing repo code; the two web lookups (100-per-call batch size, scope/tier gating) were confirmatory only, for numeric/operational claims not present in the SDK's own JSDoc comments.
