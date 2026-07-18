# Zero-Value Numeric Rendering

## Idea

Several list-tool formatters guard optional numeric fields with a truthy check
(`field ? \`Label: ${field}\` : null`). Because `0` is falsy in JS, a legitimate
zero value is silently dropped from the response instead of being rendered. We want
numeric fields to render `0` when the value really is `0`, and only be omitted when
the field is genuinely absent.

Flagged by an external reviewer of PR #8 (feature 004) as **adjacent to** the
formatting work but **pre-existing and out of scope** — feature 004 did not
introduce or touch these lines, so this is a separate cleanup, not a 004 regression.

## Notes

- **Pattern:** `x ? \`Label: ${x}\` : null` (or `... : "fallback"`) where `x` is a
  number. `0` → falsy → line omitted. Correct guard is presence, not truthiness:
  `x != null ? ... : null` (covers both `null` and `undefined`, keeps `0`), or an
  explicit `x !== undefined ? ...`.
- **Impact:** low but real information loss. Examples:
  - `list-bank-transactions.tool.ts` — `subTotal`, `totalTax` (e.g. `Total Tax: 0`
    on every no-VAT transaction is dropped).
  - `list-invoices.tool.ts` — `subTotal`, `totalTax`, `totalDiscount`, `amountDue`,
    `amountPaid`, `amountCredited` (a fully-paid invoice's `Amount Due: 0` is dropped,
    making "paid" indistinguishable from "field missing").
  - Likely similar in other list/create/update tools — audit for the
    `<numericField> ? ... : null|"..."` shape across `src/tools/`.
- **Not a rendering-string bug** like feature 004's cluster — the string is correct
  when it renders; the issue is the conditional deciding *whether* to render.
- **Scope note:** this spans many untouched tools and is likely inherited from
  upstream. Decide upstream-PR vs fork-local per PRD §8 when picking this up. A
  clean approach: a tiny shared helper or a consistent `!= null` guard applied
  across the numeric fields, verified by a grep that no `numericField ? ... :`
  truthy guards remain.
- **Verification when done:** unit-render a record with `0`-valued numeric fields and
  assert the `Label: 0` lines are present; grep the tool tree for the truthy-guard
  pattern and confirm none remain on numeric fields.

## Layers
backend
