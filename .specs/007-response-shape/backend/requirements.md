# Requirements: Response Shape — reports envelope, empty-value omission, activeOnly accounts
**Layer:** backend
**Status:** Confirmed
**Last updated:** 2026-07-20

## Problem Statement

Post-v0.3.1 production testing (first-user re-test, 2026-07-20) confirmed the read-tool surface is
hard for agents to consume: the 5 report tools bypass the 006 JSON envelope entirely (3 prose text
blocks + a pretty-printed raw Xero report tree), per-cell `attributes` blocks repeat the same
account GUID 5× per row (64.4% of the trial balance's 441 KB), 40% of trial-balance cells are
empty-string padding, and `list-accounts` mixes 35 archived accounts into every response (the
source of the tester's 608-vs-609 confusion). The owner's design principle for this work:
**responses should be short or deliberately file-spill-large — never lossy.** Keep all information;
drop only provable junk (empty values, duplicated GUID placements, pretty-print whitespace).

Measured baseline (dev instance, 2026-07-20): trial balance 441 KB (193 KB minified; 69 KB
minified + hoisted), balance sheet 126 KB, P&L ~48 KB, accounts 265 KB / 609 rows (574 ACTIVE + 35
ARCHIVED), items 9.0 MB / 21,240 rows.

## Goals

- Every read tool returns exactly **one minified JSON text block** — no prose lines, no
  pretty-printing.
- Reports become a structured, lossless **report envelope** (sections one level deep, matching
  Xero's actual depth-1 trees) instead of the raw `rowType/cells/attributes` tree.
- Empty values (`""`, `null`) are omitted everywhere; `0` and `false` always survive.
- `list-accounts` returns the working chart of accounts by default (`activeOnly=true`), with
  archived rows one parameter away.
- No information loss anywhere: every non-empty value in today's payloads remains retrievable.

## Non-Goals

- **No verbosity flag** (`detail`/`fields`): trimmed-of-junk responses are THE response. If a
  future need surfaces, the flag can be added backwards-compatibly then.
- **No curated per-tool field lists** (accounts and items keep all populated fields — the ADR-0005
  maintenance objection stands).
- **No hard response-size guard/truncation** — file-spill-large responses are acceptable by design.
- **No items `description`-dedup** (75.8% duplicate `name`, ~0.9 MB) — conditional per-row omission
  is a surprising contract for a payload that stays file-spill anyway.
- **No pagination changes**; single-object tools (`list-organisation-details`,
  `get-payroll-timesheet`) keep their bare-object shape.
- **No fix for the aged-receivables/payables live failure** (every call currently errors against
  Xero with an unrecognized SDK error shape — filed as its own backlog item
  `aged-reports-live-failure.md`; the report envelope still covers these tools code-wise via
  fixture-based tests, and the tools stay advertised).
- No numeric parsing of report cell values — verbatim strings from Xero (an account *named* "123"
  must never become a number).

## Functional Requirements

1. **Single minified JSON block.** Given any read tool (list, get, report), when it succeeds, then
   its MCP response contains exactly one `text` content block whose text is minified JSON
   (`JSON.stringify`, no indentation). Report tools' current prose lines (report name, date,
   updated-at) move into JSON fields.

2. **Empty-value omission (global).** Given any value serialized through the json-response helper,
   when a key's value is `""` or `null` (at any depth), then the key is omitted; values `0` and
   `false` are always emitted. Implemented in the same `JSON.stringify` replacer that applies
   `REDACTED_KEYS` — no per-tool logic.

3. **Report envelope (all 5 report tools).** Given a report tool
   (`list-trial-balance`, `list-profit-and-loss`, `list-report-balance-sheet`,
   `list-aged-receivables-by-contact`, `list-aged-payables-by-contact`), when it succeeds, then it
   returns:
   ```json
   {
     "report": "Trial Balance",
     "date": "2026-07-19",
     "updatedAt": "2026-07-19T…",
     "columns": ["Account", "Debit", "Credit", "YTD Debit", "YTD Credit"],
     "sections": [
       {
         "title": "Revenue",
         "rows": [
           { "Account": "B2B - Bulk Sales (422)", "Credit": "129450.50",
             "YTD Credit": "812003.10", "attributes": { "account": "4ba97ded-…" } }
         ],
         "total": { "Account": "Total", "Debit": "77312936.58", … }
       }
     ]
   }
   ```
   Rules:
   - `columns` come verbatim from the report's Header row; a row's cells are keyed by their
     column title (an empty column title keys as `"label"`).
   - Cell `attributes` are **hoisted and deduplicated per row** into one `attributes` object
     (`{id: value}`), preserving every distinct id/value pair (`account`, `fromDate`, `toDate`,
     `groupID`, …). Cell-level placement is the only thing discarded.
   - `SummaryRow` becomes the owning section's `total` object (same column-keyed shape).
   - Sections appear in Xero's order with their verbatim `title` (including `""`); label-only
     sections (e.g. balance sheet "Assets") appear with no `rows` key after empty-omission;
     computed rows (Gross Profit, Net Profit, Net Assets) stay as ordinary rows in their sections.
   - Cell values are verbatim strings; report header fields (`report`, `date`, `updatedAt`) come
     from the current prose lines / report metadata.

4. **`activeOnly` on list-accounts.** Given `list-accounts` is called with no arguments, when it
   succeeds, then only `status == "ACTIVE"` accounts are returned (filtered server-side via the
   Xero `where` clause) and `showing` equals the active count. Given `activeOnly: false`, then all
   accounts including ARCHIVED are returned. All account fields remain (no field trimming beyond
   FR 2's empty-value omission).

5. **List envelope unchanged.** Given any list tool, the `{showing, [hasMore,] rows}` envelope and
   raw-model rows from 006 are unchanged apart from FR 1–2. Given single-object tools, the bare
   object shape is unchanged apart from FR 2.

6. **Tool descriptions document the shape.** Given the affected tools, their MCP descriptions state
   the response envelope (and for `list-accounts`, the `activeOnly` default) so agents know what
   they will receive.

## Acceptance Criteria

- **AC 1 — Report is one minified block**
  - Given: the dev instance trial balance
  - When: `list-trial-balance` is called
  - Then: the response has exactly 1 text content block; the text starts with `{"report":"Trial Balance"` and contains no newline characters

- **AC 2 — Empty padding cells vanish, falsy data survives**
  - Given: a trial-balance row with `Debit: ""` and a `Credit` value, and an account row with `hasAttachments: false`
  - When: serialized
  - Then: the row object has no `Debit` key; the account row still contains `"hasAttachments":false`; a `0` amount anywhere is emitted as `0`

- **AC 3 — Attributes hoisted once per row, losslessly**
  - Given: the TB "Retained Earnings (960)" row (account GUID on all 5 cells; `toDate: "2/28/2026"` on cells 2–5)
  - When: transformed
  - Then: the row has exactly one `attributes` object equal to `{"account":"0aa0e7a2-…","toDate":"2/28/2026"}` (fromDate omitted as empty), and no other GUID appears in the row

- **AC 4 — Section totals and computed rows preserved**
  - Given: the balance sheet
  - When: transformed
  - Then: the "Bank" section has `total` with `"label":"Total Bank"`; "Net Assets" appears as a row in its empty-title section; label-only sections "Assets"/"Liabilities" appear as `{"title":"Assets"}` entries preserving order

- **AC 5 — activeOnly default**
  - Given: 574 ACTIVE + 35 ARCHIVED accounts in the org
  - When: `list-accounts` is called with no args / with `activeOnly: false`
  - Then: `showing` is 574 with zero `"status":"ARCHIVED"` rows / `showing` is 609 including archived rows

- **AC 6 — No information loss on reports**
  - Given: the raw Xero trial-balance tree and the transformed envelope
  - When: every non-empty cell value and every distinct attribute id/value pair in the raw tree is looked up in the envelope
  - Then: each one is present (order of sections and of rows within sections preserved)

- **AC 7 — Items cleaned by empty-omission only, falsy fields intact**
  - Given: an items row with `quantityOnHand: null`, an empty-string `purchaseDescription`, and `isTrackedAsInventory: false`
  - When: serialized
  - Then: `quantityOnHand` and `purchaseDescription` keys are absent; `"isTrackedAsInventory":false` is present; every populated field is unchanged

- [ ] ADR-0006 records the report envelope + empty-omission as the successor/refinement of
      ADR-0005's raw-passthrough contract (raw passthrough stays for list rows; reports get a
      lossless structured envelope).
- [ ] REPO.md upstream-isolation section gains the feature-007 exception note (report tool files +
      accounts handler/tool are upstream-owned).
- [ ] `.specs/backlog/aged-reports-live-failure.md` created with the 2026-07-20 evidence (all
      contacts error; `formatError` fallback = unrecognized SDK error shape; not a 403/plan gate).
- [ ] `.specs/backlog/response-size-and-502-stability.md` updated: items 2–4 delivered by 007;
      remaining scope (infra 502s, list-items 9 MB pagination strategy) stays.
- [ ] Shipped as a minor version bump (output contract change, like 006 → v0.3.0).

## Dependencies

- xero-node report models (`ReportWithRow`) — already in use; no new dependencies.
- Feature 006's `json-response.ts` helper (fork-owned) is the implementation seam for FR 1–2.

## Open Questions

- Whether AC 7's empty-`{}` omission (empty objects, not just `""`/`null`) is in scope for the
  replacer — recommend yes for `salesDetails: {}` cleanliness, foundry to confirm the replacer can
  do it cheaply (replacers see objects before children are filtered; may need a post-pass or
  accept `{}` remaining). Not load-bearing either way.

## Glossary additions

- **Report envelope** — the structured JSON shape report tools return: `{report, date, updatedAt,
  columns, sections: [{title, rows, total}]}` with cells keyed by column title and per-row
  deduplicated `attributes`. Aliases to avoid: report tree (that is Xero's raw shape).
- **Empty-value omission** — the global serialization rule dropping `""`/`null` keys while always
  emitting `0` and `false`. Aliases to avoid: field trimming (that implies dropping populated fields).
