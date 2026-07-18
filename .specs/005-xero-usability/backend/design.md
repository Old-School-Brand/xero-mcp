# Design: Xero Usability — GL Access, Pagination & Session Persistence
**Layer:** backend
**Status:** Confirmed
**Last updated:** 2026-07-18 (revised per design-review: journalDate normalisation, ifModifiedSince completeness caveat + complete mode, workstream C reconciled to already-applied `openid offline_access` (verify-only), sparse-account continuation contract + Example 6b, `paginationHint` DRY helper, corrected report-tool-consistency claim)
**Domain language:** Validated against `.specs/GLOSSARY.md` (three additions promoted in step 4b: General Ledger, Journals endpoint, list-account-transactions).

## Overview

Three targeted fixes to unblock month-end work. Workstream A adds a deep `list-account-transactions` Tool that wraps the Journals endpoint, filters journal lines by account and date range, and returns compact JSON with offset-based continuation. Workstream B raises the hardcoded `pageSize: 10` to 100 on five transaction Handlers. Workstream C prepends `openid offline_access` to the Entra scope so refresh tokens are issued and sessions survive token expiry — **already applied and green ahead of the pipeline (verify-only).**

All three workstreams modify upstream-owned files (a deliberate fork exception following the feature 004 precedent). The `offline_access` change is under `src/http/` (clean). The GL handler/tool, tool-factory wiring, and pageSize edits touch `src/handlers/` and `src/tools/` (upstream-owned).

## Architecture

The new GL tool fits into the existing handler-per-resource architecture. No new patterns, no new dependencies, no new modules beyond the single handler and tool file.

```mermaid
flowchart LR
    C[MCP Client] -->|list-account-transactions| TF[ToolFactory]
    TF -->|schema + handler| T["list-account-transactions.tool.ts"]
    T -->|delegates| H["list-xero-account-transactions.handler.ts"]
    H -->|pages| XA["xeroClient.accountingApi.getJournals()"]
    XA -->|Journal[]| H
    H -->|filters lines by account + date| H
    H -->|AccountTransactionsEnvelope| T
    T -->|JSON.stringify, minified| C
```

**Reusable code:**
- `xeroClient` (authentication, tenantId) — used identically to every other handler.
- `formatDate` from `src/helpers/format-date.ts` — renders `JournalDate` strings to ISO date.
- `formatError` from `src/helpers/format-error.ts` — surfaces 403 and other errors.
- `getClientHeaders` from `src/helpers/get-client-headers.ts` — user-agent header.
- `CreateXeroTool` from `src/helpers/create-xero-tool.ts` — tool definition factory.
- `XeroClientResponse` from `src/types/tool-response.ts` — discriminated union return type.

**Code not reused:**
- `formatLineItem` — designed for `LineItem` (invoices/bills), not `JournalLine`. The GL output is a flat JSON row, not a text-block render.

**New code:**
- `src/handlers/list-xero-account-transactions.handler.ts` — the deep GL module.
- `src/tools/list/list-account-transactions.tool.ts` — thin tool wrapper.
- `src/helpers/pagination-hint.ts` — shared "showing N — call page X" helper (B0).

**Impacted code:**
- `src/tools/list/index.ts` — add import + array entry for the new tool.
- `src/tools/tool-factory.ts` — no change (it iterates `ListTools` automatically).
- Five handler files — `pageSize` literal change (10 to 100).
- Five tool files — description text update ("10" to "100") + call `paginationHint`.
- `src/http/auth/build.ts` + two auth test files + `build.test.ts` — **workstream C, already applied & green (verify-only, do not re-edit).**

## Data Model

No database, schema, or model changes. The Journals endpoint is read-only; no state is persisted.

## API / Interface Design

### list-account-transactions Tool

**Parameters (zod schema):**

| Param    | Type     | Required | Description |
|----------|----------|----------|-------------|
| account  | `string` | yes      | Xero account code (e.g. `"631"`) or AccountID UUID |
| fromDate | `string` | no       | `YYYY-MM-DD`. Narrows server-side via `ifModifiedSince` and filters `JournalDate >= fromDate` |
| toDate   | `string` | no       | `YYYY-MM-DD`. Filters `JournalDate <= toDate`. Open-ended when omitted |
| offset   | `number` | no       | Continuation cursor from a previous call's `nextOffset` |

**Response (MCP `ToolResponse`):**

Single `content` block, `type: "text"`, containing a minified JSON envelope:

```json
{"account":"631","showing":42,"nextOffset":98765,"complete":false,"warning":"Narrowed by modification date (fromDate); results may be incomplete.","rows":[{"date":"2026-06-01","journalNumber":12345,"accountCode":"631","accountName":"Advertising","description":"Facebook Ads June","netAmount":500,"grossAmount":575,"taxAmount":75,"taxType":"OUTPUT2","sourceType":"ACCREC"},{"date":"2026-06-15","journalNumber":12400,"accountCode":"631","accountName":"Advertising","description":"Google Ads","netAmount":300,"grossAmount":345,"taxAmount":45,"taxType":"OUTPUT2","sourceType":"ACCPAY"}]}
```

`isError: false` in all non-error cases, including empty results (`showing: 0, rows: [], nextOffset: null`).

## ADR Alignment

| ADR | Subject | Relationship |
|-----|---------|-------------|
| ADR-0002 | Upstream isolation (`src/http/` boundary) | **Documented exception.** The GL handler/tool and pageSize edits modify upstream-owned files (`src/handlers/`, `src/tools/`). This follows the feature 004 precedent: owner-approved deviation, accepted merge cost. ADR-0002 decision #5 remains the default for all other features. The `offline_access` change is under `src/http/` (clean, no exception needed). |
| ADR-0004 | OAuth-proxy bridge | **Extend.** Adding `offline_access` to the Entra scope is a new capability that does not contradict the bridge pattern. The scope flows through `entraConfig.scope`, which is already used by `authorize`, `exchangeRefreshToken`, and the callback handler. |

No new ADR introduced. The `offline_access` addition is a single-feature fix, not a cross-cutting architectural decision. The upstream-isolation exception is already precedented.

## Component Breakdown

### A1. New handler: `src/handlers/list-xero-account-transactions.handler.ts`

**Responsibility:** The deep module. Authenticates, pages the Journals endpoint, filters lines by account and date, assembles the JSON envelope with continuation cursor.

**Location:** `src/handlers/list-xero-account-transactions.handler.ts`

**Key logic:**

1. **Account identifier detection.** A single regex test determines the filter field:
   - UUID pattern (`/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`) matches `AccountID`.
   - Everything else matches `AccountCode`.

2. **ifModifiedSince derivation.** When `fromDate` is provided, pass `new Date(fromDate)` as the `ifModifiedSince` parameter to `getJournals`. This narrows the server-side response to journals **created/modified** on or after that date. When `fromDate` is omitted, pass `undefined` (no server-side narrowing — a complete exhaustive offset scan).

   **Completeness caveat (verified — the Journals endpoint has no journal-date filter; `getJournals(tenantId, ifModifiedSince?, offset?, paymentsOnly?)` is the whole signature).** `ifModifiedSince` filters by *modification* date, not `JournalDate`. A journal **dated** in the window but **posted before** `fromDate` (future-dated entries, back-dated adjustments, bulk imports) is silently excluded and the client-side date filter cannot recover it. This is the accepted speed/completeness trade (owner-confirmed): the fast path uses `fromDate`; the complete path omits it. The tool description (A2) must disclose this, and 006's local journal-store (lossless incremental sync) is what later makes the same tool correct **and** fast.

3. **Paging loop.** Call `accountingApi.getJournals(tenantId, ifModifiedSince, currentOffset, false, getClientHeaders())` in a bounded loop:
   - `currentOffset` starts at the caller's `offset` (default `0`).
   - Each call returns up to 100 journals.
   - After each call, update `currentOffset` to the highest `JournalNumber` seen (journals are returned ascending by `JournalNumber`).
   - Stop when: (a) fewer than 100 journals returned (Xero's last page), OR (b) page budget exhausted.

4. **Page budget constant.** `MAX_PAGES_PER_CALL` — a single named numeric constant at the top of the handler file. Target ~10 (exact value measured empirically during build). Caps the number of `getJournals` calls per tool invocation to bound API-call rate cost.

5. **Line filtering.** For each journal in the response:
   - **Normalise the journal date first:** `const journalDay = formatDate(journal.journalDate)`. `xero-node` deserialises Xero's `/Date(…)/` wire format into a JS `Date` (the declared `string` type on `Journal.journalDate` is misleading), so a raw string-prefix comparison is wrong and would filter incorrectly — a silent data-integrity bug for a reconciliation tool. `formatDate` (`src/helpers/format-date.ts`) accepts `Date | string` and returns `YYYY-MM-DD`, which compares lexicographically.
   - Check the window: skip the journal entirely unless `(!fromDate || journalDay >= fromDate) && (!toDate || journalDay <= toDate)` — both bounds optional, so an omitted `fromDate` does not exclude everything. Reuse `journalDay` for row assembly (step 6) — normalise once per journal.
   - For each `JournalLine` on a qualifying journal, check if the line's `AccountID` (UUID mode) or `AccountCode` (code mode) matches the `account` parameter. Collect matching lines. **UUID matches are case-insensitive** — Xero returns `AccountID` as a lowercase GUID and the detection regex accepts either case, so both sides are lowercased before comparing (a raw `===` would silently miss an uppercase-UUID input).

6. **Row assembly.** Each matching line becomes a flat object:
   ```typescript
   {
     date: journalDay, // normalised once in step 5 (formatDate handles xero-node's Date)
     journalNumber: journal.journalNumber,
     accountCode: line.accountCode,
     accountName: line.accountName,
     description: line.description,
     netAmount: line.netAmount,
     grossAmount: line.grossAmount,
     taxAmount: line.taxAmount,
     taxType: line.taxType,
     sourceType: journal.sourceType,
   }
   ```

7. **Continuation cursor.** If the loop stopped because the page budget was exhausted (not because Xero returned a partial page), set `nextOffset` to the highest `JournalNumber` seen. Otherwise `nextOffset` is `null` (exhausted).

8. **Return type.** `XeroClientResponse<AccountTransactionsEnvelope>`, where:
   ```typescript
   interface AccountTransactionsEnvelope {
     account: string;
     showing: number;
     nextOffset: number | null;
     complete: boolean;      // false when fromDate narrowing may omit journals
     warning: string | null; // explanation when !complete
     rows: AccountTransactionRow[];
   }
   ```
   The interface is defined in the handler file (not a shared type — YAGNI).

9. **Error handling.** The outer try/catch uses `formatError` identically to every other handler. A 403 from `getJournals` (missing `accounting.journals.read` scope) surfaces as `isError: true` with the `formatError` message ("You don't have permission to access this resource in Xero.").

**Estimated LOC:** ~60-80 (handler function + types + constant).

### A2. New tool: `src/tools/list/list-account-transactions.tool.ts`

**Responsibility:** Thin schema + response wrapper. Delegates to the handler, returns the JSON envelope as a single text block.

**Location:** `src/tools/list/list-account-transactions.tool.ts`

**Key logic:**
- Uses `CreateXeroTool` with a zod schema for the four parameters.
- Tool description guides the user and **must disclose the completeness caveat**:
  > "Lists general-ledger lines for one account. Supply `fromDate` for a fast month-end pull — but note `fromDate` narrows by *modification* date, so journals **posted before** `fromDate` with a `JournalDate` in range (future-dated/back-dated entries, bulk imports) are not returned. For a complete, exhaustive extract, omit `fromDate` (slower — scans the ledger by offset). Use `offset` from the previous call's `nextOffset` to continue; `showing: 0` with a non-null `nextOffset` means keep going (the account was inactive in that slice, not that you are done)."
- On success: returns `[{ type: "text", text: JSON.stringify(envelope) }]` (minified, no pretty-print). **This is a new, deliberately different JSON shape** — a single envelope folding metadata (`account`, `showing`, `nextOffset`) and `rows` into one object. It is **not** the existing report-tool convention (those emit several `content` blocks — report name/date/updated-at — then a pretty-printed rows array). Unifying all read tools onto one JSON contract is deferred to `007-json-everywhere`.
- On error: returns `[{ type: "text", text: \`Error listing account transactions: ${response.error}\` }]`.

**Estimated LOC:** ~30-40.

### A3. Wire into list index: `src/tools/list/index.ts`

**Change:** Add import for `ListAccountTransactionsTool` and add it to the `ListTools` array.

### B0. New shared helper: `src/helpers/pagination-hint.ts`

**Responsibility:** Single source of truth for the "there may be more" message, so it is not copy-pasted into five tool files (DRY — CLAUDE.md).

```typescript
export function paginationHint(count: number, page: number, pageSize = 100): string | null {
  return count === pageSize ? `Showing ${count} — call with page ${page + 1} for more` : null;
}
```

Called by all five transaction tool files (B2). A wording or page-size change is then one edit, not five. ~4 LOC + a small unit test.

### B1. Page size bump: five handler files

Each file receives a single literal change: `10` to `100` in the `pageSize` argument position.

| File | Line (approx.) | Change |
|------|-----------------|--------|
| `src/handlers/list-xero-invoices.handler.ts` | 28 | `10` to `100` |
| `src/handlers/list-xero-manual-journals.handler.ts` | 30 | `10` to `100` |
| `src/handlers/list-xero-bank-transactions.handler.ts` | 19 | `10` to `100` |
| `src/handlers/list-xero-credit-notes.handler.ts` | 20 | `10` to `100` |
| `src/handlers/list-xero-payments.handler.ts` | 49 | `10` to `100` |

### B2. Tool description + response messaging: five tool files

Each tool file receives:
- Description text update: "10" to "100" (e.g. "if 10 invoices are returned" becomes "if 100 invoices are returned").
- Response messaging: after the handler returns, call `paginationHint(count, page)` (B0). If it returns a string, append it as a text block to the tool's existing response content array. No inline count/page/pageSize logic in the tool files — the helper owns it.

| File | Description change | Response messaging |
|------|--------------------|--------------------|
| `src/tools/list/list-invoices.tool.ts` | "10" to "100" in description | append `paginationHint(count, page)` if non-null |
| `src/tools/list/list-manual-journals.tool.ts` | "10" to "100" in description | append `paginationHint(count, page)` if non-null |
| `src/tools/list/list-bank-transactions.tool.ts` | "10" to "100" in description | append `paginationHint(count, page)` if non-null |
| `src/tools/list/list-credit-notes.tool.ts` | "10" to "100" in description | append `paginationHint(count, page)` if non-null |
| `src/tools/list/list-payments.tool.ts` | "10" to "100" in description | append `paginationHint(count, page)` if non-null |

### C1. Scope fix: `src/http/auth/build.ts` — **ALREADY APPLIED (verify-only)**

This change was shipped ahead of the pipeline. **The build agent must NOT re-edit it** — the current code is already correct and includes `openid`:

Before: `scope: \`api://${ENTRA_CLIENT_ID}/${requiredScopes[0] ?? "mcp"}\``
Now (line 77): `scope: \`openid offline_access api://${ENTRA_CLIENT_ID}/${requiredScopes[0] ?? "mcp"}\``

`openid` is the standard OIDC scope (issues the id_token); `offline_access` is what makes Entra issue a refresh token. Dropping `openid` would regress the login. The single `entraConfig.scope` value feeds both the authorize redirect (`bridge-provider.ts:62`) and the refresh leg (`bridge-provider.ts:99`); the callback's `OAuthTokensSchema` already accepts the optional `refresh_token`. **Verify only** — no code change.

### C2. Auth test updates — **ALREADY APPLIED (verify-only)**

The auth tests were updated alongside C1 to the current scope `"openid offline_access api://entra-client-id/mcp"` and are green. **The build agent must NOT re-edit these** (re-"updating" already-correct fixtures risks breaking them):

- `src/__tests__/http/auth/bridge-provider.test.ts` — fixture (line 35) + authorize assertion + `exchangeRefreshToken` assertion all updated.
- `src/__tests__/http/auth/callback-handler.test.ts` — fixture updated.
- `src/__tests__/http/auth/build.test.ts` — a new end-to-end guard (`test_nonlocal_authorize_requests_openid_offline_access_scope`) drives the real `authorize()` built from `build.ts` and asserts the redirect carries `openid offline_access api://client-456/mcp`, so a future revert of the one-liner fails a test.

Full suite (141 tests) is green with these changes.

## Error Handling & Edge Cases

| Scenario | Handling |
|----------|----------|
| Account has no activity AND the scan is exhausted (Xero returned a partial page) | Return `{ showing: 0, nextOffset: null, rows: [] }`, `isError: false` — truly done |
| Page budget exhausted with **no** matching lines but more journals remain (sparse account on a large ledger) | Return `{ showing: 0, nextOffset: <highest JournalNumber seen>, rows: [] }`, `isError: false`. `showing: 0` does **not** imply done — a non-null `nextOffset` means keep going (disclosed in the tool description) |
| 403 from `getJournals` (missing `accounting.journals.read` scope) | `formatError` returns "You don't have permission to access this resource in Xero.", `isError: true` |
| 429 (rate limit exceeded) | `formatError` returns "Too many requests to Xero. Please try again in a moment.", `isError: true` |
| `fromDate` omitted | No `ifModifiedSince` narrowing. Pages from `offset` under the same budget. Slower but functional (tool description warns the user) |
| `toDate` omitted | Open-ended upper bound — all journal dates >= `fromDate` pass the date filter |
| `offset` omitted | Defaults to `0` (start from the beginning) |
| `account` is a UUID | Filter by `AccountID` |
| `account` is not a UUID | Filter by `AccountCode` |
| Page budget exhausted but more journals exist | `nextOffset` is non-null (highest `JournalNumber` seen); caller resumes with `offset: nextOffset` |
| All journals scanned (Xero returned a partial page) | `nextOffset` is `null` (no more data) |
| Xero's true last page happens to contain exactly 100 journals | Treated as "more may exist" → non-null `nextOffset`; the next call returns an empty final slice (one harmless extra round-trip). Not a defect — do not add extra Xero calls to detect it |
| `pageSize` change returns exactly 100 results | Tool response includes "showing 100 — call with page X for more" messaging |
| `pageSize` change returns fewer than 100 results | No continuation messaging |

## Security & Permissions

- **Xero scope.** The `list-account-transactions` tool requires the `accounting.journals.read` scope on the Xero connection. If absent, the tool fails loud with a clear error (not a silent empty result). This is an operational precondition: the Xero app connection must be re-authorised if the scope is missing.
- **Entra scope.** Adding `offline_access` requests a refresh token from Entra. This is a standard OAuth 2.0 scope. The refresh token is handled by the existing bridge machinery (`exchangeRefreshToken` in `bridge-provider.ts`) and stored by the MCP client (claude.ai). No server-side storage of the Entra refresh token.
- **No new secrets.** No new env vars, no new credentials.
- **formatError whitelist.** The existing `formatError` function already whitelists safe fields from error objects, preventing credential leakage. The GL handler uses it identically.

## Performance Considerations

- **Page budget bounds API cost.** At ~10 pages per call, each `list-account-transactions` invocation costs at most ~10 API calls against Xero's 60 req/min bucket. A full GL pull for a busy account month (~1000 lines across ~10 pages) completes in a single tool invocation.
- **`ifModifiedSince` narrows server-side.** When `fromDate` is provided, Xero returns only journals modified on or after that date, significantly reducing the working set for bounded-period queries (the primary use case: month-end pulls).
- **No response-size cap on GL output.** Consistent with the non-goal: modern MCP clients spill big results to a file and filter with `jq`/`grep`. Capping response size would force tedious round-trips against the rate bucket.
- **pageSize 100 = Xero's per-call max.** Maximises data per request, minimising round-trips for the existing transaction tools.
- **Minified JSON.** `JSON.stringify(envelope)` without pretty-print. Saves ~30-40% payload size vs pretty-printed JSON for large result sets.

## Dependencies

- **Internal:**
  - `xeroClient` (authentication + `accountingApi`) — existing, no changes.
  - `formatDate`, `formatError`, `getClientHeaders`, `CreateXeroTool`, `XeroClientResponse` — existing helpers/types, no changes.
- **External:**
  - `xero-node` ^13.3.0 — `accountingApi.getJournals()`, `Journal`, `JournalLine` types. Already a dependency.
  - `zod` 3.25 — schema validation for tool parameters. Already a dependency.
  - No new external dependencies.

## Testing Strategy
**Mode:** full-tdd
**Rationale:** The GL handler contains conditional runtime logic (account-shape detection, ifModifiedSince derivation, line filtering by account+date, continuation/nextOffset calculation, empty and error paths) plus the scope string change has assertions that must be updated. All testable in isolation with mocked xeroClient.
**Framework:** Vitest 4.x (already configured in `vitest.config.ts`; `src/**/*.test.ts` glob)
**Test location:** `src/__tests__/handlers/list-xero-account-transactions.test.ts` (new), `src/__tests__/helpers/pagination-hint.test.ts` (new — small unit test for the B0 helper). The auth tests (`bridge-provider.test.ts`, `callback-handler.test.ts`, `build.test.ts`) are workstream C — **already updated and green; do not re-edit.**
**Commands:**
  - Run:      `npm run test`
  - Coverage: `npm run test:coverage`
**Done when:** All tests green. No regressions in adjacent suites (`npm run test` passes all existing tests).

## Examples

**Example 1 — GL month-end happy path (account code)**
- Given: Xero has journals with lines on account `631` dated in June 2026. `getJournals` is called with `ifModifiedSince = new Date("2026-06-01")`, `offset = 0`. The Journals endpoint returns journals containing lines on account `631` with `JournalDate` values like `"2026-06-05"`, `"2026-06-15"`.
- When: `list-account-transactions({ account: "631", fromDate: "2026-06-01", toDate: "2026-06-30" })`
- Then: Response is `{ account: "631", showing: N, nextOffset: <number|null>, rows: [...] }` where N > 0, every row has `accountCode: "631"`, every row has `date` within `"2026-06-01"` to `"2026-06-30"`, `isError: false`. JSON is minified (no whitespace).
- AC: AC 1

**Example 2 — Account by UUID**
- Given: Account `631` has AccountID `"a1b2c3d4-e5f6-7890-abcd-ef1234567890"`. Journals contain lines with `AccountID` matching this UUID.
- When: `list-account-transactions({ account: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", fromDate: "2026-06-01" })`
- Then: Lines are filtered by `AccountID` (not `AccountCode`). Response rows match the same lines as Example 1.
- AC: AC 2

**Example 3 — Account identifier detection: code vs UUID**
- Given: `account = "631"` (not a UUID)
- When: The handler checks the UUID regex
- Then: `isUUID` is `false`, filter field is `AccountCode`
- Given: `account = "A1B2C3D4-E5F6-7890-ABCD-EF1234567890"` (uppercase UUID)
- When: The handler checks the UUID regex (case-insensitive)
- Then: `isUUID` is `true`, filter field is `AccountID`
- AC: AC 2

**Example 4 — Continuation cursor (page budget exhausted)**
- Given: An account has journals spanning more than `MAX_PAGES_PER_CALL` pages. Mock `getJournals` to return 100 journals on each call (full page). After `MAX_PAGES_PER_CALL` calls, the handler stops.
- When: First call with `offset: 0`
- Then: `nextOffset` equals the highest `JournalNumber` seen (e.g. `9999`), not `null`. `showing` is the count of matching lines found within the scanned pages.
- When: Second call with `offset: 9999`
- Then: `getJournals` is called with `offset = 9999`, scanning continues from where the first call stopped. No overlap with the first call's rows.
- AC: AC 3

**Example 5 — Continuation: final slice**
- Given: An account's remaining journals fit within one call's budget. Mock `getJournals` to return fewer than 100 journals (partial page = Xero's last page).
- When: Called with the previous `nextOffset`
- Then: `nextOffset` is `null` (exhausted). All matching lines in the final slice are returned.
- AC: AC 3

**Example 6 — Empty period, scan exhausted**
- Given: Account `999` has no journal lines in June 2026. Mock `getJournals` to return a **partial page** (fewer than 100 journals — Xero's last page), none with lines on account `999`.
- When: `list-account-transactions({ account: "999", fromDate: "2026-06-01", toDate: "2026-06-30" })`
- Then: `{ account: "999", showing: 0, nextOffset: null, rows: [] }`, `isError: false` — `nextOffset: null` because the scan is exhausted
- AC: AC 4

**Example 6b — Empty slice but more to scan (sparse account, budget exhausted)**
- Given: Mock `getJournals` to return **full 100-journal pages** for all `MAX_PAGES_PER_CALL` calls, none containing lines on account `999`.
- When: `list-account-transactions({ account: "999", fromDate: "2026-06-01" })`
- Then: `{ showing: 0, nextOffset: <highest JournalNumber seen, non-null>, rows: [] }`, `isError: false`. A test author must **not** assert `nextOffset === null` whenever `showing === 0`.
- AC: AC 3

**Example 7 — Missing journals scope (403)**
- Given: The Xero connection lacks `accounting.journals.read`. Mock `getJournals` to throw an error with `response.statusCode: 403`.
- When: `list-account-transactions({ account: "631", fromDate: "2026-06-01" })`
- Then: `isError: true`, error message is "You don't have permission to access this resource in Xero." (from `formatError`'s 403 mapping).
- AC: AC 5

**Example 8 — ifModifiedSince derivation**
- Given: `fromDate = "2026-06-01"`
- When: The handler calls `getJournals`
- Then: The `ifModifiedSince` parameter is `new Date("2026-06-01")`. Verify the mock was called with this Date value.
- Given: `fromDate` is omitted
- When: The handler calls `getJournals`
- Then: The `ifModifiedSince` parameter is `undefined`.
- AC: AC 1

**Example 9 — Date filtering excludes out-of-range journals**
- Given: Journals returned include one with `JournalDate: "2026-05-31"` (before `fromDate`) and one with `JournalDate: "2026-07-01"` (after `toDate`), both with lines on account `631`.
- When: `list-account-transactions({ account: "631", fromDate: "2026-06-01", toDate: "2026-06-30" })`
- Then: Neither out-of-range journal's lines appear in the result rows.
- AC: AC 1

**Example 10 — Row shape**
- Given: A matching journal line with all fields populated: `accountCode: "631"`, `accountName: "Advertising"`, `description: "Facebook Ads"`, `netAmount: 500`, `grossAmount: 575`, `taxAmount: 75`, `taxType: "OUTPUT2"`. Parent journal has `journalNumber: 12345`, `journalDate: "2026-06-15"`, `sourceType: "ACCREC"`.
- When: The line is collected into a row
- Then: The row object is `{ date: "2026-06-15", journalNumber: 12345, accountCode: "631", accountName: "Advertising", description: "Facebook Ads", netAmount: 500, grossAmount: 575, taxAmount: 75, taxType: "OUTPUT2", sourceType: "ACCREC" }`.
- AC: AC 1

**Example 11 — pageSize 100 on invoices**
- Given: >100 invoices exist. Mock `getInvoices` to accept `pageSize: 100` (not 10).
- When: `list-invoices({ page: 1 })`
- Then: The handler calls `getInvoices` with `pageSize = 100`. Up to 100 invoices returned. (Verify the mock argument, not the Xero API.)
- AC: AC 6

**Example 12 — "showing N" messaging when full page returned**
- Given: `listXeroInvoices` returns exactly 100 invoices for page 1.
- When: The tool formats the response
- Then: The response content array includes a text block containing "Showing 100 — call with page 2 for more".
- AC: AC 6

**Example 13 — No continuation messaging when partial page**
- Given: `listXeroInvoices` returns 42 invoices for page 1.
- When: The tool formats the response
- Then: No "call with page X for more" messaging is present.
- AC: AC 6

**Examples 14–16 — offline_access scope (ALREADY IMPLEMENTED & GREEN — the scope is `openid offline_access …`, not `offline_access …`)**

**Example 14 — scope string built by buildAuth**
- Given: `ENTRA_CLIENT_ID = "client-456"`, `ENTRA_REQUIRED_SCOPES = "mcp"`
- When: `buildAuth` runs and `authorize()` is driven
- Then: the redirect `scope` is `"openid offline_access api://client-456/mcp"` (covered by `build.test.ts` `test_nonlocal_authorize_requests_openid_offline_access_scope`)
- AC: AC 8

**Example 15 — offline_access in authorize redirect**
- Given: The scope is `"openid offline_access api://entra-client-id/mcp"`
- When: `authorize()` redirects to Entra
- Then: The `scope` query parameter is `"openid offline_access api://entra-client-id/mcp"` (covered by `bridge-provider.test.ts`)
- AC: AC 8

**Example 16 — offline_access in exchangeRefreshToken**
- Given: The scope is `"openid offline_access api://entra-client-id/mcp"`
- When: `exchangeRefreshToken` calls the Entra token endpoint
- Then: The `scope` form parameter is `"openid offline_access api://entra-client-id/mcp"` (covered by `bridge-provider.test.ts`)
- AC: AC 8

**Example 17 — Tool is registered in ToolFactory**
- Given: The ToolFactory runs with `XERO_READONLY` unset (read-only mode)
- When: The registered tool names are collected
- Then: `"list-account-transactions"` is present in the list.
- AC: AC 1 (prerequisite: the tool must be discoverable)

## Open Questions

- **Per-call page budget constant** (`MAX_PAGES_PER_CALL`) — exact value to be measured empirically during the build once `getJournals` is callable against the Xero Demo Company. Target ~10. The design supports any positive integer; the constant is a single named value at the top of the handler file.
