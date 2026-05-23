# Architecture Decision Records

This directory holds Architecture Decision Records (ADRs) for this repo. Each ADR captures one architecturally significant choice — what was decided, why, what alternatives were rejected, and what consequences follow.

## Scope

ADRs record decisions that are:

1. **Already implemented in code** — aspirational entries from `PRD.md` or `NORTHSTAR.md` (v1+ plans) are not ADRs; they live in those documents until the work ships.
2. **Cross-feature or load-bearing across the codebase** — single-feature implementation patterns belong in that feature's `design.md`, not here. An ADR exists when the decision's blast radius exceeds one feature.
3. **Genuinely deliberated** — if no real comparison or trade-off was made, do not invent one. Operator preferences and template defaults belong in `REPO.md`, not here.

## SDLC integration

ADRs are first-class artefacts in the spec-driven pipeline:

- **foundry** reads this index before writing every `design.md`, and the design must contain a `## ADR Alignment` section answering: adopt / extend / supersede / introduce.
- **build** surfaces any divergence between implementation and ADR (or `design.md`) in its end-of-feature summary.
- **staff-reviewer** treats ADR contradiction as a first-class concern — either the ADR is being superseded (and a new one written) or the spec is wrong (and being fixed).

Supersession is first-class: an ADR can only be superseded by another ADR, never by a `design.md` or a code change. When superseding, mark the old ADR `Superseded by NNNN` and write a new one.

## Conventions

- One file per decision: `NNNN-kebab-case-title.md` (4-digit prefix, monotonically increasing).
- Use `template.md` as the starting point.
- Status values: `Accepted`, `Superseded by NNNN`, `Deprecated`.
- Never edit a `Superseded` ADR's content (other than its status header).

## Index

_No ADRs yet. Use `template.md` as the starting point when the first architectural decision in this fork warrants one._
