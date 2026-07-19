# 0005. Read tools emit raw JSON passthrough

| Field       | Value                                                                 |
|-------------|-----------------------------------------------------------------------|
| Status      | Accepted                                                              |
| Date        | 2026-07-19                                                            |
| Decided by  | Llewellyn Strydom (CTO)                                               |
| Source      | `.specs/006-json-everywhere/backend/requirements.md`, `design.md`     |
| Supersedes  | —                                                                     |

## Context

The read tools (`list-*`, `get-*`) historically returned bespoke human-readable **text blocks**, while
the 5 report tools already emitted JSON — an inconsistent surface. The text formatters also guarded
numeric fields with `x ? … : null`, silently dropping legitimate `0` values (a paid invoice's
`Amount Due: 0` vanished). Since raising `pageSize` to 1000 (v0.2.1), responses are large and consumers
spill them to a file and filter with `jq`, where structured JSON is far more extractable than text.

PRD §2 states *"Never modify the public MCP tool contract. Tools, parameter schemas, and Xero API
resource coverage are upstream's job."* Read literally, that could forbid changing output rendering —
so a decision (and this record) is needed to remove the contradiction between that principle and the
change.

## Decision

Read tools emit **raw JSON passthrough**:
- **List** tools return a minified envelope `{ "showing": <count>, ["hasMore": <bool>,] "rows": [ … ] }`
  where `rows` is the untouched `xero-node` handler result. `hasMore` is server-computed
  (`rows.length === pageSize`) and emitted only for tools with a known page size (the 5 transaction
  tools), preserving the pagination signal introduced in feature 005.
- **Single-object** tools (`list-organisation-details`, `get-payroll-timesheet`) return the raw object
  as minified JSON (the get tool keeps its explicit not-found handling).
- Passthrough is **raw**, not curated per-tool fields — the lowest-maintenance choice: new Xero fields
  and upstream handler changes flow through with no per-tool edits.

The PRD §2 "contract" governs tool **names, parameters, and Xero resource coverage** (upstream's job) —
**not output rendering format**, which is fork-owned (already established by feature 004's local
formatting fixes). The 5 report tools keep their existing pretty-printed JSON; create/update/delete
tools are unchanged.

## Consequences

**Positive:**
- One machine-extractable JSON surface across read tools; `jq`-friendly for the large (up-to-1000-row)
  responses the spill-and-filter workflow produces.
- The zero-value truthy-guard bug is fixed inherently (`JSON.stringify` renders `0`).
- Net code deletion — removes ~20 bespoke text formatters, `pagination-hint.ts`, and
  `format-line-item.ts`; self-adapts to Xero/upstream changes.

**Negative:**
- **Breaking output change** for any consumer that string-matched the old text format (shipped as minor
  v0.3.0 with a release note).
- **Verbosity** — raw objects are larger than curated text (accepted; offset by spill + `jq`).
- **PII** — raw passthrough surfaces fields the text tools omitted (`dateOfBirth`, home `address` on
  `list-payroll-employees`). Accepted: the server is Entra-gated internal-only and users already have
  Xero payroll access. Revisit if ever exposed more broadly.
- Residual inconsistency: report tools remain pretty-printed bare arrays rather than the `{showing,rows}`
  envelope.

## Amendment — credential passthrough regression (2026-07-19)

Raw passthrough leaked a credential the old text formatter never emitted:
`Organisation.aPIKey` — the org's **Xero-to-Xero network key** — appeared in
`list-organisation-details` output and reached LLM transcripts (first-user report; key rotated
by the owner). Fix: `jsonResponse` now applies a sensitive-key deny-list (`REDACTED_KEYS` in
`src/helpers/json-response.ts`) via a `JSON.stringify` replacer, covering every read tool at the
single serialization choke point. The deny-list is the standing home for any future
credential-bearing Xero fields; broader field-trimming/PII decisions stay with the
response-size backlog item.

## Alternatives Considered

- **Curated flat rows per tool** — rejected: every tool carries a hand-maintained field list, the exact
  recurring maintenance the owner wants to avoid; new Xero fields require edits.
- **Keep text blocks** — rejected: not machine-extractable, keeps the surface inconsistent with the
  report tools, and leaves the zero-value bug.
- **Also convert the 5 report tools into the envelope** — deferred: risk/churn for no real gain; they're
  already JSON.
