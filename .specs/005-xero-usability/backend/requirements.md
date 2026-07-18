# Requirements: Xero MCP Usability — GL Access, Pagination & Session Persistence

**Layer:** backend
**Status:** Confirmed
**Last updated:** 2026-07-18

## Problem Statement

Xero users of the deployed MCP hit two confirmed blockers to real month-end work:

1. **Results are capped / cut off.** There is no way to pull a general-ledger (GL) listing per
   account (users need often >1000 lines per account), the transaction list tools return only 10
   rows per page, and a couple of tools (`list-items`, `list-accounts`) return enormous unpaginated
   responses that blow most MCP clients' context.
2. **The connector forces a full re-login every new session.**

Both were verified against the live `xero-dev` MCP and the code (see the approved plan). This
feature fixes all three facets in the backend layer.

## Goals

- Expose GL-per-account through a new `list-account-transactions` tool that wraps Xero's Journals
  feed, narrows server-side by modification date, filters lines by account + journal date, and
  returns compact, resumable, JSON output.
- Fix the users' "only pulls ten/a hundred at a time" complaint by raising the hardcoded
  `pageSize: 10` to 100 (Xero's per-call max) on the transaction handlers, with "more available —
  call page X" messaging. Deliberately do **not** force small pages or cap large responses: modern
  MCP clients (Claude Code / Desktop / claude.ai) spill big tool results to a file and filter them
  with `jq`/`grep`, so forcing pagination would trade a non-problem (spillable size) for a real one
  (tedious, rate-hungry round-trips against the 60 req/min Xero bucket).
- Fix per-session re-login by requesting `offline_access` on the Entra login so a refresh token is
  issued and claude.ai can refresh silently.

## Non-Goals

- **Valkey response cache** (shared cross-user cache, per-resource TTL, `invalidate_cache` tool,
  Redis persistence) — deferred to **feature 006-response-cache**. It will accelerate GL and every
  read tool but is not required for this feature to deliver value.
- **Converting the ~24 existing list tools to JSON** (uniform read contract) — deferred to
  **feature 007-json-everywhere**. This feature's new GL tool emits JSON, consistent with the 5
  existing report tools; the list tools keep their text-block format for now.
- **Forced small-page pagination and an artificial response-size ceiling** — explicitly rejected.
  Clients spill + filter, so `list-items` and `list-accounts` keep returning their full sets
  unchanged, and no shared size-guard helper is built.
- **Origin memory / 502-on-large-response (e.g. the 8.3 MB `list-items` payload), pod memory limits,
  replica count, Redis persistence** — deferred to a later **infra feature (008)** that needs live
  `kubectl` diagnostics. Consciously accepted: leaving `list-items` unbounded means those large
  responses (and their 502 risk) persist until 008 lands.
- **Running balance** in GL output — Xero's Journals endpoint does not return one, and bounded /
  resumable paging cannot compute it reliably.
- **Reconstructing GL by unioning per-resource endpoints** (Invoices/BankTransactions/…) — rejected
  as complex and not guaranteed to match Xero's true GL.

## Functional Requirements

1. **New tool `list-account-transactions`.** Registered as a list tool (always available, like other
   list tools). Parameters: `account` (required), `fromDate?` (YYYY-MM-DD), `toDate?` (YYYY-MM-DD),
   `offset?` (number, continuation cursor).

2. **Account identifier accepts code or UUID.** Given an `account` value, When it matches the UUID
   shape, Then journal lines are filtered by `AccountID`; otherwise by `AccountCode`.

3. **Server-side narrowing + client-side filtering.** When `fromDate` is provided, Then the handler
   calls `accountingApi.getJournals(tenantId, ifModifiedSince = fromDate, offset, paymentsOnly=false)`
   to narrow the working set server-side, pages journals by `offset`, and returns only lines whose
   account matches (FR2) **and** whose `JournalDate` is within `[fromDate, toDate]` (toDate defaults
   to open-ended). When `fromDate` is omitted, Then no `ifModifiedSince` narrowing is applied and the
   handler pages from `offset` (default 0) under the same per-call bound (documented as slower; the
   tool description guides the user to supply a date for month-end pulls).

4. **Bounded per-call scan + continuation.** The handler scans at most a fixed budget of `getJournals`
   pages (constant measured during build; target ~10 pages / ~1000 journals) — the bound exists to
   cap **scan cost / API-call rate**, not response size. It returns **all** matching lines found
   within that scan (no row cap; the client spills + filters if large). Given more journals remain
   beyond the bound, When the call returns, Then it includes a non-null `nextOffset` (the highest
   `JournalNumber` scanned) so the caller resumes; otherwise `nextOffset` is null.

5. **Compact JSON output.** The tool returns a single JSON text block:
   `{ "account": <input>, "showing": <lineCount>, "nextOffset": <number|null>, "rows": [ ... ] }`,
   where each row is a flat journal-line object: `date`, `journalNumber`, `accountCode`,
   `accountName`, `description`, `netAmount`, `grossAmount`, `taxAmount`, `taxType`, `sourceType`.
   Minified (not pretty-printed). Dates rendered via `src/helpers/format-date.ts`.

6. **Empty result is not an error.** Given an account/period with no matching lines, When called,
   Then the tool returns `{ ..., "showing": 0, "nextOffset": null, "rows": [] }` and `isError: false`.

7. **Missing scope fails loud.** Given the Xero connection lacks `accounting.journals.read`, When
   `getJournals` returns 403, Then the tool surfaces a clear error via `formatError` (`isError: true`).

8. **Raise transaction page size 10 → 100.** The hardcoded `pageSize` becomes 100 in
   `list-xero-invoices`, `list-xero-manual-journals`, `list-xero-bank-transactions`,
   `list-xero-credit-notes`, and `list-xero-payments` handlers. Tool responses state
   "showing N — call with page X for more" when a full page (100) is returned. `list-items` and
   `list-accounts` are **left unchanged** — they return their full sets and the client filters.

9. **`offline_access` on the Entra login.** Prepend `offline_access` to the Entra scope built in
   `src/http/auth/build.ts` (feeds both the authorize redirect and the refresh leg). Given the
   access token expires, When claude.ai attempts a refresh, Then it succeeds silently using the
   issued refresh token — no full re-login.

10. **Auth tests updated.** Tests asserting the old scope string are updated to the new value:
    `src/__tests__/http/auth/bridge-provider.test.ts` and `callback-handler.test.ts`.

## Acceptance Criteria

- **AC 1 — GL month-end happy path**
  - Given: account `631` exists and has journal lines dated in June 2026
  - When: `list-account-transactions({ account: "631", fromDate: "2026-06-01", toDate: "2026-06-30" })`
  - Then: response is `{ account:"631", showing:N>0, nextOffset:<num|null>, rows:[…] }`, every row
    is on account `631` with `date` within June 2026, minified JSON, `isError:false`

- **AC 2 — Account by UUID**
  - Given: the same account's Xero `AccountID` UUID
  - When: `list-account-transactions({ account: "<uuid>", fromDate: "2026-06-01" })`
  - Then: lines are filtered by `AccountID` and returned identically to AC 1

- **AC 3 — Continuation cursor**
  - Given: an account/period whose matching journals exceed one call's page budget
  - When: the first call returns `nextOffset: X` (non-null)
  - Then: calling again with `offset: X` returns the next slice with no overlap, and the final slice
    returns `nextOffset: null`

- **AC 4 — Empty period**
  - Given: account with no activity in the window
  - When: called
  - Then: `{ showing: 0, nextOffset: null, rows: [] }`, `isError: false`

- **AC 5 — Missing journals scope**
  - Given: the Xero connection lacks `accounting.journals.read`
  - When: called
  - Then: `isError: true` with a clear formatted error (no silent empty result)

- **AC 6 — Transaction page size is 100**
  - Given: >100 invoices exist
  - When: `list-invoices({ page: 1 })`
  - Then: up to 100 invoices are returned (not 10), with "call page 2" messaging

- **AC 7 — Large list tools are left unbounded**
  - Given: `list-items` (~19.8k) / `list-accounts` (598)
  - When: called
  - Then: the full set is returned unchanged (no forced 100-row cap) for the client to spill + filter

- **AC 8 — offline_access issues a refresh token**
  - Given: the Entra scope now includes `offline_access`
  - When: the OAuth code is exchanged (bridge/callback)
  - Then: the built scope string contains `offline_access`, the refresh leg is reachable, and the
    updated auth tests pass

- [ ] `.specs/REPO.md` upstream-isolation note records the deliberate fork exception for the new
      handler/tool files and the modified upstream-owned list handlers (as feature 004 did)
- [ ] `.specs/backlog/general-ledger-and-session-persistence.md` deleted (folded entirely into 005)
- [ ] `.specs/backlog/response-size-and-502-stability.md` retained (its infra half seeds a later
      feature); its uncommitted OOM-evidence edit committed
- [ ] `.specs/backlog/_next-session-kickoff.md` deleted

## Dependencies

- **Xero scope `accounting.journals.read`** must be carried by the seeded refresh token, else
  `getJournals` 403s. Verify early in the build; if absent, the Xero app connection must be
  re-authorised with the added scope (operational, outside code).
- Feature **006-response-cache** (future) will make GL and other reads fast and relieve the 60 req/min
  bucket, but this feature must stand on its own without it.

## Open Questions

- **Per-call page budget constant** (FR4) — exact value to be measured empirically during the build
  once `getJournals` is callable (real journals-per-account-per-month counts). Target ~10 pages.
- **`fromDate` omitted behaviour** (FR3) — confirmed default: no server-side narrowing, page from
  `offset` under the same bound. Revisit if this proves too slow in practice.

## Glossary additions

- **General Ledger (GL)** — the complete record of an organisation's financial transactions per
  account; in Xero, sourced via the Journals feed (there is no GL report in the Accounting API).
  Aliases to avoid: "ledger listing", "account statement".
- **Journals endpoint** — Xero's `accountingApi.getJournals(tenantId, ifModifiedSince?, offset?,
  paymentsOnly?)`; the canonical bulk-GL feed, 100 journals per call, cursor-paginated by
  `offset` (returns journals with `JournalNumber > offset`), narrowable by modification date via
  `ifModifiedSince`. Distinct from **Manual Journals** (`getManualJournals`). Aliases to avoid:
  "journal list" (ambiguous with manual journals).
- **list-account-transactions** — the new Tool exposing GL-per-account over the Journals endpoint.
  Aliases to avoid: "list-journals", "list-gl".
