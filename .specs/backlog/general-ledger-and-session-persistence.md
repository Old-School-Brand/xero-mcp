# General Ledger Access & Connector Session Persistence

## Idea

First-user feedback (2026-07-12) on the deployed Xero MCP surfaced two blockers to real-world use:
(1) pulling GL listings per account is capped and slow, and (2) the connector forces a re-login
every new session. Fix both in one backend feature so the MCP is actually usable for month-end work.

Verbatim feedback:

> It only seems to pull a hundred line items at a time when we need to pull the GL listings for
> each account. They often have well over a thousand lines. I'm not sure if there's a more
> efficient or better way that we can pull these as it seems to struggle.
>
> It also seems to disconnect every time you have a new session. I always seem to have to go and
> re-login and load the connector.

Upstream check (2026-07-12): `HEAD..upstream/main` is empty — neither issue is fixed upstream.
Decision: fork-only, no upstream PR (accepted deviation from the upstream-isolation convention).

## Notes

### A. General ledger access

- Root cause: the server exposes **no GL tool at all**. Xero's Journals endpoint — the canonical
  bulk-GL feed — is never wrapped, and the existing list tools (`list-invoices`,
  `list-bank-transactions`, `list-manual-journals`, …) hard-code `pageSize: 10`, so clients grind
  through tiny pages of the wrong resources.
- `xero-node` exposes `accountingApi.getJournals(tenantId, ifModifiedSince?, offset?, paymentsOnly?)`
  — up to **100 journals per call**, cursor-paginated by `offset` (returns journals with
  `JournalNumber > offset`). No server-side per-account filter exists at Xero; account filtering
  happens on journal lines.
- Design question for foundry: thin `list-journals` passthrough vs. a purpose-built deep module
  (e.g. `list-account-transactions(accountId, fromDate?, offset?)`) that pages journals internally
  and returns only matching, compactly-formatted lines. Deep module fits our principles, but must
  respect Xero's rate limit (60 req/min) and the response-size concerns in the *Response Size & 502
  Stability* backlog item — no unbounded looping inside one tool call.
- Response formatting must be compact; reuse `src/helpers/format-date.ts` and `format-line-item.ts`
  (feature 004's standardised date/line-item rendering, merged in PR #8).
- **Operational precondition:** the seeded Xero refresh token must carry the
  `accounting.journals.read` scope, else the Xero app connection must be re-authorised. Verify early.
- Optional secondary scope (refinery to decide): raise `pageSize` 10 → ~100 on existing paginated
  list handlers, balanced against the *Response Size & 502 Stability* item's concerns (that item covers
  the opposite failure mode — responses too big — so the two should share one pagination strategy).
- New files land in upstream-owned dirs (`src/handlers/`, `src/tools/list/`, `tool-factory.ts`
  wiring). Update `.specs/REPO.md`'s upstream-isolation note to record the deliberate exception.

### B. Connector session persistence

- Root cause: the Entra OAuth bridge requests scope `api://{ENTRA_CLIENT_ID}/mcp` **without
  `offline_access`** (`src/http/auth/build.ts:77`), so Entra never issues a refresh token. When the
  access token expires (~60–90 min), claude.ai has nothing to refresh with → full re-auth +
  connector reload each session.
- Fix: prepend `offline_access` to `entraConfig.scope`. The same value feeds both the authorize
  redirect (`bridge-provider.ts:62`) and the refresh leg (`bridge-provider.ts:99`), so one change
  covers both. The callback handler already passes through whatever tokens Entra returns
  (`OAuthTokensSchema` has optional `refresh_token`), and `exchangeRefreshToken` already implements
  the refresh grant — only the scope request is missing.
- Bridge exchanges as a confidential client (client secret) → ~90-day sliding refresh-token lifetime.
- Tests asserting the old scope string: `src/__tests__/http/auth/bridge-provider.test.ts`
  (fixture line 35, assertions 115/209), `callback-handler.test.ts:35`.
- No ADR deliberately excluded `offline_access` — it was missed in ADR-0004's implementation.
- Secondary diagnostic (overlaps the *Response Size & 502 Stability* item, not a blocker here): if
  production Redis/Valkey is not persistent, restarts wipe DCR client registrations (`oauth:clients:*`,
  no TTL) and the Redis-stored Xero refresh token — independently forcing reconnects. Confirm
  persistence when that item runs.
- **Symptom mapping (from first-user feedback):** the "have to re-login / reload the connector every new
  session" complaint is **this** item (part B — missing `offline_access`). A separate "keeps
  disconnecting mid-use" complaint is more likely the **502s** tracked in the *Response Size & 502
  Stability* item. Two different root causes behind superficially similar "it disconnects" reports.

## Layers

backend
