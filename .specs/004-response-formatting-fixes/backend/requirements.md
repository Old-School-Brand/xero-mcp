# Requirements: Response Formatting Fixes
**Layer:** backend
**Status:** Confirmed
**Last updated:** 2026-07-05

## Problem Statement

Tool response formatters render data for an MCP Client (and the model behind it) as plain text. Several
formatters interpolate objects, arrays, or broken expressions directly, and date rendering is
inconsistent across the tool surface. Because the client only ever sees the rendered string, these
defects corrupt, hide, or muddy the data. All were reproduced live against the deployed `Xero MCP`
server by exercising the tool surface broadly.

**A. Object / fallback defects (the reported cluster — 5 findings, now confirmed fully bounded):**
1. **`Tracking: [object Object]`** — `list-bank-transactions` and `list-invoices` via shared helper
   `format-line-item.ts`. `LineItem.tracking` is an array of tracking objects, interpolated raw. The
   model cannot tell which tracking category/option a line was allocated to. **Highest impact — data loss.**
2. **`bills: undefined / sales: undefined`** — `list-organisation-details` payment terms (nested
   `PaymentTerm` objects interpolated).
3. **`Name: … || "No name available."`** — `list-organisation-details`; the `|| "fallback"` sits
   *inside* the template literal (~15 lines), printing literally.
4. **Comma-glued blocks / literal `undefined`** — five sites interpolate `.map(fmt)` (a `string[]`)
   without joining. Live proof: `list-tracking-categories` renders 86 options as
   `…Status: ACTIVE,Option ID: …`.
5. **`http%3A%2F%2F…`** — `list-organisation-details` external links double URL-encoded by
   `get-external-link.ts`.

A full sweep (598 accounts, 19,789 items, contacts, credit notes, quotes, payments, manual journals,
tax rates) found **no other** `[object Object]` / `undefined` / `|| "…"` / `%3A` occurrences — the
object/fallback class is exactly these 5.

**B. Date rendering inconsistency (the pervasive cross-cutting defect):** three different styles appear
across ~40 sites, sometimes within one tool:
- Raw JS `Date` → `Sun Jul 05 2026 00:00:00 GMT+0000 (Coordinated Universal Time)` (most tools).
- `.toLocaleDateString()` → `7/5/2026` (locale-ambiguous) — `list-manual-journals`.
- `.toISOString()` → clean ISO — already used by `list-profit-and-loss` and `list-trial-balance`.
- Raw Xero date-strings → `2022-07-22T00:00:00` — e.g. `list-quotes` `dateString`.
`list-quotes` shows the incoherence: `Quote Date: 2022-07-22T00:00:00` vs
`Last Updated: Fri Jul 22 2022 … GMT+0000`.

These are bugs in upstream-owned files, fixed **locally** per an explicit owner decision (accepting the
upstream-merge cost). Response rendering only — no Tool parameter schema changes.

## Goals

- No Tool renders `[object Object]`, literal `undefined`, literal `|| "…"`, or double-encoded URLs.
- `Tracking` shows the actual category/option allocation.
- **All dates render in one consistent format across every Tool:** calendar dates as `YYYY-MM-DD`,
  timestamps as ISO 8601 — via a single shared helper (DRY), replacing the four ad-hoc styles.
- All fixes match existing repo formatting precedents; the only genuinely new element (a date helper) is
  justified by an existing partial precedent (`.toISOString()` already in two tools).
- Output stays consistent and homogeneous across the tool surface. Public MCP tool contract unchanged.

## Non-Goals

- **Response size / pagination** (e.g. `list-items` returns all 19,789 items ≈ 8.3 MB; `list-accounts`
  116 KB, unpaginated because Xero's endpoints don't paginate these) and **intermittent origin 502s** —
  moved to a **separate feature (005)**; they span backend+infra and need live pod logs to root-cause.
  See `.specs/backlog/005-response-size-and-502-stability.md`.
- Any upstream PR of these fixes (owner chose local-only for now).
- New tools, new fields, new Xero API coverage, or handler/transport changes.
- Xero-internal reference markup passthrough (e.g. payments `Reference: [:[…]:]`) — that is Xero's stored
  data, not a rendering bug.

## Repo formatting precedents to match (adopted verbatim)

| Concern | Precedent (canonical) | Source |
|---|---|---|
| Optional field, keep line with fallback | `x ? \`Label: ${x}\` : "No <field>"` | `list-manual-journals.tool.ts:66-72` |
| Optional scalar inline fallback | `${x \|\| "Unknown"}` | `list-contacts.tool.ts:67` |
| Nested sub-object list (blocks) | `arr.map(fmt).join("\n\n")`, else `"No <items>"` | `list-manual-journals.tool.ts:77-78` |
| Inline array-of-objects → one field | `arr.map(x => …).join(", ")`, guarded by `arr?.length` | `list-contacts.tool.ts:68-69` |
| ISO timestamp rendering | `date.toISOString()` | `list-profit-and-loss.tool.ts:51`, `list-trial-balance.tool.ts:39` |
| Key/value line; whole-block assembly | `Label: value`; `[…].filter(Boolean).join("\n")` | universal |

**Tracking render (composition of existing idioms):** each `LineItemTracking` renders as `name: option`
(colon key/value) with entries joined by `, ` (contacts inline-array idiom) → `Tracking: Region: South,
Channel: Online`. `No tracking` when absent.

## Functional Requirements

1. **Line-item tracking (fixes A#1).** Given a `LineItem` with non-empty `tracking`, When `formatLineItem`
   renders, Then `Tracking:` lists each entry `name: option` joined by `, `; When absent, `Tracking: No
   tracking`. Reaches `list-bank-transactions` and `list-invoices` via the shared helper.

2. **Line-item empty fields (fixes A#1 noise).** Given absent `LineItem` fields, Then each line keeps a
   `"No <field>"` fallback (manual-journals precedent); no literal `undefined`.

3. **Nested-list joins (fixes A#4).** Given multiple line items / tracking options, Then blocks join with
   `\n\n`; When none, `No line items` / `No tracking options`. Applies to `list-invoices`,
   `list-bank-transactions`, `list-tracking-categories`, `create-tracking-options`,
   `update-tracking-options`.

4. **Organisation payment terms (fixes A#2).** Given `organisation.paymentTerms`, Then `Bills:` and
   `Sales:` lines always show, rendering `PaymentTerm` fields or `"No <side> payment term"`; no
   `[object Object]`/`undefined`.

5. **Organisation scalar fallbacks (fixes A#3).** Given any org scalar, Then the fallback is applied
   inside the interpolation (`${x || "No … available."}`); the literal `|| "…"` never appears.

6. **External links (fixes A#5).** Given an external link URL, Then the raw URL is rendered; the
   single-use `getExternalLink` helper is removed and `link.url` used directly.

7. **Date standardization (fixes B).** A new shared helper formats dates consistently and is applied at
   every date-rendering site (~40, enumerated in design). Given a **calendar date** field (e.g.
   `date`, `dueDate`, `expiryDateString`, `reportDate`, payroll `startDate`/`endDate`), Then it renders
   `YYYY-MM-DD`. Given a **timestamp** field (`updatedDateUTC`, `createdDateUTC`), Then it renders ISO
   8601. The helper accepts `Date | string | undefined` and returns a `"No <field>"`/`"Unknown"`
   fallback when absent, matching each call site's existing fallback. (Which xero-node fields are `Date`
   vs `string`, and which are date-vs-datetime, is verified against live Xero docs at the librarian stage.)

## Acceptance Criteria

- **AC 1 — Tracking renders category/option**
  - Given a line with `tracking = [{name:"Region",option:"South"}]`; When `list-bank-transactions`
    renders; Then `Tracking: Region: South` (never `[object Object]`).
- **AC 2 — Multiple tracking entries**
  - Given two tracking entries; Then `Tracking: Region: South, Channel: Online`.
- **AC 3 — Absent tracking**
  - Given a line with no tracking (e.g. inter-account transfer lines); Then `Tracking: No tracking`.
- **AC 4 — Invoices share the fix**
  - Given `list-invoices` with an `invoiceNumbers` filter on a tracked invoice; Then tracking renders per
    AC 1/2 (proves the shared-helper fix reaches invoices).
- **AC 5 — No literal `undefined` in line items**
  - Given a line missing `itemCode`/`taxType`; Then `Item Code: No item code` / `Tax Type: No tax type`.
- **AC 6 — List separation & empty state**
  - Given two line items / none; Then blank-line separation / `Line Items: No line items`. And
    `list-tracking-categories` renders one option per block (no comma-glue).
- **AC 7 — Payment terms** — Given an org with no payment terms; Then `Bills:`/`Sales:` show a
  `"No … payment term"` fallback, never `undefined`/`[object Object]`.
- **AC 8 — Scalar fallbacks** — Given `name = "Old School Brand (Pty) Ltd"`; Then `Name: Old School
  Brand (Pty) Ltd` with no trailing `|| "…"`.
- **AC 9 — External links** — Given `url = "http://www.oldschool.co.za"`; Then output contains
  `http://www.oldschool.co.za` (not `http%3A%2F%2F…`).
- **AC 10 — Calendar date** — Given `invoice.date` = 2026-07-04 (any source type); When rendered; Then
  `Date: 2026-07-04` (never `Sat Jul 04 2026 … GMT+0000`).
- **AC 11 — Timestamp** — Given `updatedDateUTC`; Then `Last Updated: 2026-07-05T15:07:49.000Z` (ISO).
- **AC 12 — Date consistency within a tool** — Given `list-quotes`; Then `Quote Date` and `Last Updated`
  both use the standard format (no mixed styles).

- [x] `npm run build`, `npm run lint`, `npm run test` all green; `dist/` regenerated and committed.
- [x] Vitest unit coverage for `formatLineItem` (tracking present/multiple/absent; empty-field fallbacks)
      and for the date helper (Date input, string input, undefined, date vs datetime).
- [x] Librarian cites live Xero API doc URLs for `LineItem.Tracking`/`LineItemTracking`,
      `Organisation.PaymentTerms` (`Bills`/`Sales`), organisation `ExternalLinks`, and the date/datetime
      field types across the affected resources.

## Dependencies

- `xero-node` SDK types (`LineItem`, `LineItemTracking`, `Organisation`, `PaymentTerm`, `Bill`, and the
  date-typed fields).
- Live Xero API documentation (verified at librarian stage) — authoritative for field shapes/types.

## Open Questions

None blocking. Tracking `name: option` rendering was resolved by composing existing repo idioms; the date
format was chosen as ISO (owner decision), backed by the existing `.toISOString()` precedent.

## Glossary additions

- **Formatter** — a helper under `src/helpers/` that turns a Xero SDK object/field into its human-readable
  Tool-response string (e.g. `format-line-item.ts`, and the new date helper). Aliases to avoid: serializer.
