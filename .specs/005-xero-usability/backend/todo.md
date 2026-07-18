# Todo: Xero Usability — GL Access, Pagination & Session Persistence
**Layer:** backend
**Status:** In Progress
**Last updated:** 2026-07-18

## Implementation Tasks

Tasks are ordered. Do not start a task until its dependencies are complete.

Testing mode is **full-tdd** (per design.md). Each task below is a single
Define→Specify→Build unit — the build agent writes the test and the
implementation together for that unit, then runs `npm run test` before
moving to the next task. No separate "write tests for X" tasks are listed;
the `Examples:` field tells the build agent which design.md Examples that
task's test(s) must cover.

### Phase 1: Foundation

- [x] **Task 1.1** — `paginationHint` shared helper (B0)
  - File(s): `src/helpers/pagination-hint.ts` (new), `src/__tests__/helpers/pagination-hint.test.ts` (new)
  - What to do: Export `paginationHint(count: number, page: number, pageSize = 100): string | null`. Returns `` `Showing ${count} — call with page ${page + 1} for more` `` when `count === pageSize`, otherwise `null`. This is the single source of truth consumed by all five Workstream B tool edits (Phase 3) — no inline count/page/pageSize logic may live in the tool files.
  - Acceptance: Given `count=100, page=1` the helper returns `"Showing 100 — call with page 2 for more"`. Given `count=42, page=1` it returns `null`. `npm run test` passes for the new test file.
  - Depends on: (none)
  - Examples: feeds Examples 12, 13 (consumed by the Phase 3 resource tasks; the helper itself has no dedicated numbered Example)
  - Completed: 2026-07-18
  - Tests: `src/__tests__/helpers/pagination-hint.test.ts`

- [x] **Task 1.2** — GL handler scaffolding: types, constant, error shell
  - File(s): `src/handlers/list-xero-account-transactions.handler.ts` (new), `src/__tests__/handlers/list-xero-account-transactions.test.ts` (new)
  - What to do: Create the handler file with: (a) the `AccountTransactionRow` and `AccountTransactionsEnvelope` interfaces from design.md A1.8 (defined locally in this file — not a shared type, per YAGNI); (b) a `MAX_PAGES_PER_CALL` named numeric constant at the top of the file, set to `10` (design.md's Open Question target; do not gold-plate a config knob for it — it's a single literal); (c) an exported `async function listXeroAccountTransactions(account: string, fromDate?: string, toDate?: string, offset?: number): Promise<XeroClientResponse<AccountTransactionsEnvelope>>` whose body is `await xeroClient.authenticate()` wrapped in try/catch, with the catch block returning `{ result: null, isError: true, error: formatError(error) }` identically to every other handler. The try body may `throw new Error("not implemented")` as a placeholder — Tasks 2.1–2.6 replace it incrementally. Mock `xeroClient.accountingApi.getJournals` to reject with a 403-shaped error object for this task's test.
  - Acceptance: Given `getJournals` throws a 403-shaped error, When `listXeroAccountTransactions("631", "2026-06-01")` is called, Then the response is `{ result: null, isError: true, error: "You don't have permission to access this resource in Xero." }`.
  - Depends on: (none)
  - Examples: Example 7
  - Completed: 2026-07-18
  - Tests: `src/__tests__/handlers/list-xero-account-transactions.test.ts`

### Phase 2: Core Logic

- [x] **Task 2.1** — Account identifier detection (code vs UUID)
  - File(s): `src/handlers/list-xero-account-transactions.handler.ts`, `src/__tests__/handlers/list-xero-account-transactions.test.ts`
  - What to do: Inside the try body, add the UUID regex test (`/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`) against the `account` parameter to derive an `isUUID` boolean, determining whether matching is done against `AccountID` or `AccountCode`. No filtering logic yet — just the detection value, exercised via a small extracted check (or asserted through a call that stubs `getJournals` to return an empty page and inspecting which field the loop *would* filter on in Task 2.5 — for this task, a direct unit assertion on the detection logic is sufficient).
  - Acceptance: Given `account = "631"`, detection yields "match by AccountCode". Given `account = "A1B2C3D4-E5F6-7890-ABCD-EF1234567890"` (uppercase), detection yields "match by AccountID" (case-insensitive).
  - Depends on: Task 1.2
  - Examples: Example 3
  - Completed: 2026-07-18
  - Tests: `src/__tests__/handlers/list-xero-account-transactions.test.ts`

- [x] **Task 2.2** — `ifModifiedSince` derivation from `fromDate`
  - File(s): `src/handlers/list-xero-account-transactions.handler.ts`, `src/__tests__/handlers/list-xero-account-transactions.test.ts`
  - What to do: Derive the `ifModifiedSince` argument passed to `getJournals`: `new Date(fromDate)` when `fromDate` is provided, `undefined` when omitted. Wire this into the (still-stubbed) `getJournals` call so the mock's call arguments can be asserted directly.
  - Acceptance: Given `fromDate = "2026-06-01"`, the mock `getJournals` is called with `ifModifiedSince` equal to `new Date("2026-06-01")`. Given `fromDate` omitted, `getJournals` is called with `ifModifiedSince = undefined`.
  - Depends on: Task 2.1
  - Examples: Example 8
  - Completed: 2026-07-18
  - Tests: `src/__tests__/handlers/list-xero-account-transactions.test.ts`

- [x] **Task 2.3** — Bounded paging loop
  - File(s): `src/handlers/list-xero-account-transactions.handler.ts`, `src/__tests__/handlers/list-xero-account-transactions.test.ts`
  - What to do: Implement the loop calling `accountingApi.getJournals(tenantId, ifModifiedSince, currentOffset, false, getClientHeaders())`, starting `currentOffset` at the caller's `offset` (default `0`). After each call, update `currentOffset` to the highest `JournalNumber` seen in that page. Stop when either (a) the page returned fewer than 100 journals (Xero's last page), or (b) `MAX_PAGES_PER_CALL` calls have been made. Accumulate all journals seen across pages into a single array for the next tasks to filter. Do not compute `nextOffset` yet — that is Task 2.6.
  - Acceptance: Given a mock `getJournals` that returns 100 journals on every call, after `MAX_PAGES_PER_CALL` calls the loop stops having made exactly `MAX_PAGES_PER_CALL` calls, with `currentOffset` equal to the highest `JournalNumber` seen on the final call. Given a mock that returns fewer than 100 journals on the first call, the loop stops after exactly one call.
  - Depends on: Task 2.2
  - Examples: Example 4, Example 5
  - Completed: 2026-07-18
  - Tests: `src/__tests__/handlers/list-xero-account-transactions.test.ts`

- [x] **Task 2.4** — Journal-date normalisation + range filtering
  - File(s): `src/handlers/list-xero-account-transactions.handler.ts`, `src/__tests__/handlers/list-xero-account-transactions.test.ts`
  - What to do: For each journal accumulated by the loop, compute `const journalDay = formatDate(journal.journalDate)` **before** any comparison (xero-node deserialises Xero's wire date into a JS `Date` despite the SDK's declared `string` type on `Journal.journalDate` — a raw string-prefix compare would silently misfilter). Skip the journal entirely unless `(!fromDate || journalDay >= fromDate) && (!toDate || journalDay <= toDate)` — both bounds are optional per design.md FR3/step 5 (the literal expression in design.md omits the `!fromDate ||` guard, but "both bounds optional" is the stated intent — implement the guarded form so an omitted `fromDate` does not exclude every journal). Retain `journalDay` per surviving journal for reuse in row assembly (Task 2.5) — normalise once per journal, not per line.
  - Acceptance: Given journals with `JournalDate` values `"2026-05-31"` (before `fromDate`) and `"2026-07-01"` (after `toDate`) alongside in-range journals, When filtered with `fromDate: "2026-06-01", toDate: "2026-06-30"`, Then only the in-range journals survive.
  - Depends on: Task 2.3
  - Examples: Example 9
  - Completed: 2026-07-18
  - Tests: `src/__tests__/handlers/list-xero-account-transactions.test.ts`

- [x] **Task 2.5** — Line filtering by account + row assembly
  - File(s): `src/handlers/list-xero-account-transactions.handler.ts`, `src/__tests__/handlers/list-xero-account-transactions.test.ts`
  - What to do: For each journal that survived Task 2.4's date filter, iterate its `journalLines`. Keep a line if `line.accountID === account` (UUID mode, per Task 2.1's detection) or `line.accountCode === account` (code mode). Map each matching line to the flat row shape: `{ date: journalDay, journalNumber: journal.journalNumber, accountCode: line.accountCode, accountName: line.accountName, description: line.description, netAmount: line.netAmount, grossAmount: line.grossAmount, taxAmount: line.taxAmount, taxType: line.taxType, sourceType: journal.sourceType }`. Collect all matching rows into an array.
  - Acceptance: Given a journal line with `accountCode: "631"` and all other fields populated (per design.md Example 10's fixture), the assembled row matches the exact shape in Example 10. Given the same data addressed by `AccountID` instead (Example 2), the same lines are matched via the UUID field.
  - Depends on: Task 2.1, Task 2.4
  - Examples: Example 1, Example 2, Example 10
  - Completed: 2026-07-18
  - Tests: `src/__tests__/handlers/list-xero-account-transactions.test.ts`

- [x] **Task 2.6** — Continuation cursor + envelope assembly
  - File(s): `src/handlers/list-xero-account-transactions.handler.ts`, `src/__tests__/handlers/list-xero-account-transactions.test.ts`
  - What to do: After the loop (Task 2.3) and row collection (Task 2.5) complete, compute `nextOffset`: `null` if the loop stopped because Xero returned a partial (<100) page (the scan is exhausted); otherwise the highest `JournalNumber` seen (the loop stopped because the page budget was exhausted, and more journals may remain — **regardless of whether any rows were collected**). Assemble and return `{ result: { account, showing: rows.length, nextOffset, rows }, isError: false, error: null }`. This is the task that must not conflate "no matching rows" with "scan is done" — a sparse account with `showing: 0` can still have a non-null `nextOffset`.
  - Acceptance: Example 4 (budget exhausted, matches found) → `nextOffset` is the highest `JournalNumber` seen, not `null`. Example 5 (final slice) → `nextOffset` is `null`. Example 6 (empty period, scan exhausted) → `{ showing: 0, nextOffset: null, rows: [] }`. Example 6b (sparse account, budget exhausted) → `{ showing: 0, nextOffset: <non-null>, rows: [] }` — a test asserting `nextOffset === null` whenever `showing === 0` must fail.
  - Depends on: Task 2.3, Task 2.5
  - Examples: Example 4, Example 5, Example 6, Example 6b
  - Completed: 2026-07-18
  - Tests: `src/__tests__/handlers/list-xero-account-transactions.test.ts`

- [x] **Task 2.7** — New tool: `list-account-transactions.tool.ts`
  - File(s): `src/tools/list/list-account-transactions.tool.ts` (new)
  - What to do: Use `CreateXeroTool` with a zod schema of `{ account: z.string(), fromDate: z.string().optional(), toDate: z.string().optional(), offset: z.number().optional() }`. The description must disclose the completeness caveat verbatim from design.md A2 (fast-path-via-`ifModifiedSince` vs complete-path-via-omitted-`fromDate`, and that `showing: 0` with a non-null `nextOffset` means "keep going", not "done"). On success, return a single `content` block: `{ type: "text", text: JSON.stringify(envelope) }` — minified, no pretty-print (a deliberately different JSON shape from the existing report-tool convention; do not reuse their multi-block pattern). On error, return `{ type: "text", text: \`Error listing account transactions: ${response.error}\` }`. This is a thin wrapper — no filtering/paging logic belongs here, only schema + response shaping delegating to `listXeroAccountTransactions` from Task 2.6.
  - Acceptance: Calling the tool with a mocked handler response produces exactly one text content block containing the minified JSON envelope on success, or the error-prefixed string on failure.
  - Depends on: Task 2.6
  - Examples: integration point for Examples 1–10, 6b (no dedicated wrapper-only Example — the envelope shape is verified end-to-end through the handler tests)
  - Completed: 2026-07-18

- [x] **Task 2.8** — Wire into `src/tools/list/index.ts`
  - File(s): `src/tools/list/index.ts`
  - What to do: Add `import ListAccountTransactionsTool from "./list-account-transactions.tool.js";` and add `ListAccountTransactionsTool` to the exported `ListTools` array (`ToolFactory` iterates this array automatically — no change needed to `tool-factory.ts` itself, per design.md).
  - Acceptance: Given `ToolFactory` runs with `XERO_READONLY` unset, When the registered tool names are collected (same pattern as `src/__tests__/tools/tool-factory.test.ts`), Then `"list-account-transactions"` is present in the list.
  - Depends on: Task 2.7
  - Examples: Example 17
  - Completed: 2026-07-18

### Phase 3: Integration & Verification

- [x] **Task 3.1** — Invoices: pageSize 100 + pagination hint
  - File(s): `src/handlers/list-xero-invoices.handler.ts`, `src/tools/list/list-invoices.tool.ts`
  - What to do: In the handler, change the `pageSize` literal argument to `getInvoices` from `10` to `100`. In the tool, update the description text "if 10 invoices are returned" to "if 100 invoices are returned", and after building the existing response `content` array, compute `paginationHint(invoices?.length ?? 0, page)` and — if non-null — append it as an additional `{ type: "text", text: hint }` block. No inline count/page/pageSize logic in the tool file; the helper (Task 1.1) owns it.
  - Acceptance: Given the mock `getInvoices` is called, it receives `pageSize: 100`. Given 100 invoices are returned for `page: 1`, the tool response includes a text block "Showing 100 — call with page 2 for more". Given 42 invoices are returned, no such block is present.
  - Depends on: Task 1.1
  - Examples: Example 11, Example 12, Example 13
  - Completed: 2026-07-18

- [x] **Task 3.2** — Manual Journals: pageSize 100 + pagination hint
  - File(s): `src/handlers/list-xero-manual-journals.handler.ts`, `src/tools/list/list-manual-journals.tool.ts`
  - What to do: Same shape as Task 3.1: `pageSize` literal `10` → `100` in `getManualJournals`; tool description "10" → "100"; append `paginationHint(manualJournals?.length ?? 0, args?.page ?? 1)` to the response content when non-null (note: `page` is optional on this tool's schema, unlike invoices — default to `1` to match the handler's own default).
  - Acceptance: Same pattern as Task 3.1, applied to manual journals.
  - Depends on: Task 1.1
  - Examples: Example 11, Example 12, Example 13 (applied to manual journals)
  - Completed: 2026-07-18

- [x] **Task 3.3** — Bank Transactions: pageSize 100 + pagination hint
  - File(s): `src/handlers/list-xero-bank-transactions.handler.ts`, `src/tools/list/list-bank-transactions.tool.ts`
  - What to do: Same shape as Task 3.1: `pageSize` literal `10` → `100` in `getBankTransactions`; tool description "10" → "100"; append `paginationHint(bankTransactions?.length ?? 0, page)` to the response content when non-null.
  - Acceptance: Same pattern as Task 3.1, applied to bank transactions.
  - Depends on: Task 1.1
  - Examples: Example 11, Example 12, Example 13 (applied to bank transactions)
  - Completed: 2026-07-18

- [x] **Task 3.4** — Credit Notes: pageSize 100 + pagination hint
  - File(s): `src/handlers/list-xero-credit-notes.handler.ts`, `src/tools/list/list-credit-notes.tool.ts`
  - What to do: Same shape as Task 3.1: `pageSize` literal `10` → `100` in `getCreditNotes`; tool description "10" → "100"; append `paginationHint(creditNotes?.length ?? 0, page)` to the response content when non-null.
  - Acceptance: Same pattern as Task 3.1, applied to credit notes.
  - Depends on: Task 1.1
  - Examples: Example 11, Example 12, Example 13 (applied to credit notes)
  - Completed: 2026-07-18

- [x] **Task 3.5** — Payments: pageSize 100 + pagination hint
  - File(s): `src/handlers/list-xero-payments.handler.ts`, `src/tools/list/list-payments.tool.ts`
  - What to do: Same shape as Task 3.1: `pageSize` literal `10` → `100` in `getPayments`; tool description references generic "many payments" text already — no numeric literal to change there, but confirm and update if a "10" reference exists at build time. Append `paginationHint(payments?.length ?? 0, page)` to the response content when non-null.
  - Acceptance: Same pattern as Task 3.1, applied to payments.
  - Depends on: Task 1.1
  - Examples: Example 11, Example 12, Example 13 (applied to payments)
  - Completed: 2026-07-18

- [x] **Task 3.6** — Verify Workstream C (`offline_access`) is already applied and green
  - File(s): none edited — read-only verification of `src/http/auth/build.ts`, `src/__tests__/http/auth/bridge-provider.test.ts`, `src/__tests__/http/auth/callback-handler.test.ts`, `src/__tests__/http/auth/build.test.ts`
  - What to do: Confirm (do not edit) that `build.ts` line ~77 builds the scope as `` `openid offline_access api://${ENTRA_CLIENT_ID}/${requiredScopes[0] ?? "mcp"}` ``, and that the three test files assert against `"openid offline_access api://entra-client-id/mcp"` (or `client-456` in `build.test.ts`). Run `npm run test` and confirm all auth suites pass. **Do not modify any of these four files** — they are already correct; re-editing risks breaking green tests.
  - Acceptance: `npm run test` passes with no changes to these four files; the scope string in `build.ts` and all three test fixtures already read `openid offline_access …`.
  - Depends on: (none — independent verification, can run any time)
  - Examples: Example 14, Example 15, Example 16
  - Completed: 2026-07-18

- [ ] **Task 3.7** — Full regression run
  - File(s): none (verification only)
  - What to do: Run `npm run build && npm run lint && npm run test`. Confirm zero regressions: the pre-existing 141 tests plus the new GL handler tests (Tasks 1.2, 2.1–2.6) and the new `pagination-hint` tests (Task 1.1) are all green. Confirm `"list-account-transactions"` appears in the `ToolFactory`-registered tool list (cross-check of Task 2.8 / Example 17 at the full-suite level).
  - Acceptance: `npm run build`, `npm run lint`, and `npm run test` all exit zero. No test file outside this feature's scope changed or regressed.
  - Depends on: Task 2.8, Task 3.1, Task 3.2, Task 3.3, Task 3.4, Task 3.5, Task 3.6

### Phase 4: Cleanup & Docs

- [ ] **Task 4.1** — Record the upstream-isolation exception in `.specs/REPO.md`
  - File(s): `.specs/REPO.md`
  - What to do: Append a new paragraph after the existing "Known exception (feature 004-response-formatting-fixes)" note (under "Upstream Sync"), following the same pattern: name feature 005-xero-usability as a **second** deliberate deviation, listing the new GL files (`src/handlers/list-xero-account-transactions.handler.ts`, `src/tools/list/list-account-transactions.tool.ts`), the wiring edit (`src/tools/list/index.ts`), and the five pageSize handler/tool edits (invoices, manual journals, bank transactions, credit notes, payments) as touching upstream-owned `src/handlers/` and `src/tools/`. Note that the `offline_access` change (workstream C) stayed entirely within `src/http/` and required no exception. State that `git diff upstream/main -- src/ ':!src/http'` is non-empty for this additional, named reason.
  - Acceptance: `.specs/REPO.md`'s Upstream Sync section documents feature 005 as a second upstream-isolation exception, listing the exact files affected, mirroring the existing feature-004 entry's structure.
  - Depends on: Task 2.8, Task 3.5

## Out of Scope

- **New automated tests for the five existing pageSize handlers/tools** (Tasks 3.1–3.5) — design.md's Testing Strategy scopes full-tdd explicitly to the new GL handler and the new `pagination-hint` helper (`Test location:` lists only those two paths). These five handler/tool files have no pre-existing test suite, and design.md does not request adding one; Examples 11–13 are verified via the task's own Given/When/Then reasoning and the Phase 3.7 regression run, not new spec files.
- **Valkey response cache** (deferred to feature 006-response-cache per requirements.md Non-Goals).
- **Converting existing list tools to a uniform JSON contract** (deferred to feature 007-json-everywhere).
- **Forced small-page pagination / artificial response-size ceiling** on `list-items` / `list-accounts` — explicitly rejected in requirements.md; left unchanged.
- **Running balance in GL output** — Xero's Journals endpoint has no such field; not attempted.
- **Reconstructing GL by unioning per-resource endpoints** — rejected in requirements.md as complex and unreliable.
- **Infra-level 502/OOM fixes** (deferred to a later infra feature per requirements.md Non-Goals).
- **Backlog file deletion** (`.specs/backlog/general-ledger-and-session-persistence.md`, `_next-session-kickoff.md`) — handled by the standard post-mill pipeline convention (CLAUDE.md), not a backend implementation task.
- **Any edit to `src/http/auth/build.ts` or its three test files** — already applied and green; Task 3.6 is verify-only.
