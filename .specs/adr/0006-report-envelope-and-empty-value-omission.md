# 0006. Report envelope and empty-value omission

| Field       | Value                                                                    |
|-------------|--------------------------------------------------------------------------|
| Status      | Draft                                                                    |
| Date        | 2026-07-20                                                               |
| Decided by  | Llewellyn Strydom (CTO)                                                  |
| Source      | `.specs/007-response-shape/backend/requirements.md`, `design.md`         |
| Supersedes  | --                                                                       |

## Context

ADR-0005 established raw-JSON passthrough for list/get tools but **deferred** the 5 report tools
(trial balance, P&L, balance sheet, aged receivables, aged payables). Those tools continued to emit
3-4 prose text blocks plus pretty-printed `ReportWithRow.rows` -- an inconsistent surface that was
hard for agents to consume. Post-v0.3.1 testing measured concrete problems: the raw Xero report
tree repeats per-cell `attributes` (64.4% of trial-balance payload), 40% of cells are empty-string
padding, and the tree structure (`rowType`/`cells`/`attributes`) is opaque to consumers.

Separately, all read tools serialized `""` and `null` values, wasting space on unpopulated fields
(measured ~40% of trial-balance payload, significant on the 265 KB accounts and 9 MB items
responses).

## Decision

### Report envelope

Report tools return a **structured lossless envelope** instead of raw `ReportWithRow` passthrough:

```json
{
  "report": "Trial Balance",
  "date": "2026-07-20",
  "updatedAt": "2026-07-20T...",
  "columns": ["Account", "Debit", "Credit"],
  "sections": [
    {
      "title": "Revenue",
      "rows": [
        { "Account": "Sales (200)", "Credit": "5000.00",
          "attributes": { "account": "4ba97ded-..." } }
      ],
      "total": { "Account": "Total Revenue", "Credit": "5000.00" }
    }
  ]
}
```

Key rules: cells are keyed by column title (empty title -> `"label"`); per-row attributes are
hoisted and deduplicated (first-wins on id collision); `SummaryRow` becomes `total`; cell values
are verbatim strings (no numeric parsing); section order preserved.

This is **not** raw passthrough (unlike ADR-0005's list tools) because the raw `ReportWithRow`
tree is structurally wasteful and unreadable. The envelope is lossless: every non-empty cell value
and every distinct attribute id/value pair is preserved.

### Empty-value omission

The `JSON.stringify` replacer in `jsonResponse` drops keys whose values are `""` or `null`.
Values `0` and `false` are always emitted. This applies globally to every tool that flows through
`jsonResponse` (all read tools, all report tools). Empty objects (`{}`) that result from child
filtering are accepted as-is (no recursive pre-pass).

### Relationship to ADR-0005

ADR-0005 remains `Accepted` and is not superseded. This ADR **extends** it:
- List/get tools continue to use raw-JSON passthrough per ADR-0005.
- Report tools get the structured envelope defined here (filling ADR-0005's explicit deferral).
- Empty-value omission is a refinement of the `jsonResponse` serialization choke point ADR-0005
  established.

## Consequences

**Positive:**
- One consistent surface: every read tool returns a single minified JSON content block.
- Report payloads shrink ~70-80% (attribute dedup + empty-value omission + minification).
- All tools benefit from empty-value omission (items, accounts, etc.).
- Agents can parse report data structurally (column-keyed rows) instead of walking opaque trees.

**Negative:**
- **Breaking output change** for report tools and any consumer relying on empty-string fields
  (shipped as minor v0.4.0).
- Report envelope is a designed transform, not raw passthrough -- it has its own maintenance
  surface (the `transformReport` function). Mitigated: it is generic across all 5 reports and
  operates on the stable `ReportWithRow` SDK type.

## Alternatives Considered

- **Raw passthrough for reports (like list tools)** -- rejected: the `ReportWithRow` tree is
  structurally wasteful (per-cell attributes, `rowType` enum noise) and unreadable. Passthrough
  would deliver the measured 441 KB trial balance as-is.
- **Per-report custom transformers** -- rejected: YAGNI/KISS. The 5 reports share the same
  `ReportWithRow` model; one generic transformer handles all of them.
- **Recursive pre-pass to remove empty objects** -- rejected: adds complexity for cosmetic gain.
  `{}` survival is harmless.
