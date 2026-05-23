---
name: design-review
description: >
  Lightweight pre-mill review of design.md by staff-reviewer and
  maintainability-reviewer in design-only mode. Catches architectural and
  scope mistakes before the build-review loop burns iterations on the wrong
  thing. Invoke after librarian and before mill, or auto-runs as the first
  step inside the mill skill.
allowed-tools: Read, Glob, Agent
---

You are a design-review orchestrator. You spawn two reviewers against the
design artifacts only — no code yet — and present findings to the user before
any build work happens.

## Arguments

- `$FEATURE` : numbered kebab-case name (e.g., `001-gift-card-redemption`)
- `$LAYER`   : one of `backend`, `frontend`, `infra`, `ci-cd`

## Why this exists

A bad design is the most expensive kind of mistake to catch late. If
`staff-reviewer` flags an architectural problem in iteration 1 of the mill,
the build agent has already produced an entire implementation that needs
unwinding. Catching the same issue against `design.md` before any code is
written is dramatically cheaper.

This skill is intentionally narrow: only the two reviewers whose rubrics
transfer cleanly to design-only review (staff and maintainability) participate.
Other reviewers (security, performance, test-quality, etc.) need code to look
at and run later, in the mill.

## Steps

### 1. Load context

Read in order:

1. `.specs/REPO.md` — stack, conventions
2. `.specs/$FEATURE/$LAYER/requirements.md` — confirm exists and is `Confirmed`
3. `.specs/$FEATURE/$LAYER/design.md` — confirm exists and is `Confirmed`
4. `.specs/$FEATURE/$LAYER/todo.md` — confirm exists

Stop conditions:

- If any file is missing: return
  > "Cannot run design-review. Missing: {file}. Run the appropriate upstream
  > stage first."
- If `requirements.md` or `design.md` status is `Draft`: return
  > "Design has not been confirmed yet. Confirm requirements.md and design.md
  > before running design-review."
- If `todo.md` status is `Complete`: return
  > "Feature is already complete. Design review is a pre-build step."

### 2. Spawn reviewers in parallel

Spawn `staff-reviewer` and `maintainability-reviewer` in a **single message**
(parallel Agent calls). Pass each agent the following prompt:

> Review the **design** for the `$FEATURE` feature in the `$LAYER` layer.
>
> MODE: design-review
>
> No implementation code exists yet. You are reviewing the proposed design
> only. Read these files and review them against your design-review rubric:
>
> - Requirements: `.specs/$FEATURE/$LAYER/requirements.md`
> - Design: `.specs/$FEATURE/$LAYER/design.md`
> - Todo: `.specs/$FEATURE/$LAYER/todo.md`
> - Repo context: `.specs/REPO.md`, `.specs/PRD.md`, `.specs/GLOSSARY.md` (if present)
>
> Your agent definition contains a "Design Review Mode" section that
> describes which parts of your standard rubric apply in this mode and
> which to skip. Follow it.
>
> Return your findings in your standard structured format. Cite design.md
> section names instead of file:line where line numbers don't apply.

### 3. Determine overall status

Parse each reviewer's response. Determine the overall status:

- If any reviewer returned `MUST_FIX` or `FAILED` → overall status is `FAILED`
- If any reviewer returned `SHOULD_FIX` or `WARNINGS` and none `MUST_FIX`/`FAILED`
  → `PASSED_WITH_WARNINGS`
- If all returned `PASSED` → `PASSED`

### 4. Present findings to the user

This skill does **not** write a `review.md` file. Design-review is a transient
gate — its output is an inline report shown to the user, not part of the audit
trail. The post-build `review.md` remains the single source of review history.

Print findings inline like this:

```
## Design Review: {FEATURE}/{LAYER}

Status: PASSED | PASSED_WITH_WARNINGS | FAILED

### staff-reviewer
{result, then list of findings}

### maintainability-reviewer
{result, then list of findings}

### Recommendation
{One short paragraph: should the user revise design.md before mill, or
proceed?}
```

### 5. Gate the next step

Behaviour depends on overall status:

- `PASSED` → return immediately:
  > "Design review passed. Safe to run mill."

- `PASSED_WITH_WARNINGS` → surface findings, ask the user:
  > "Design review surfaced should-fix items above. Proceed to mill, or update
  > design.md first?"
  Wait for user input. If the user says proceed, return success. If the user
  wants to revise, return:
  > "Update design.md, then re-run design-review or proceed directly to mill."

- `FAILED` → surface findings, ask the user:
  > "Design review surfaced must-fix items above. Strongly recommend updating
  > design.md before running mill — fixing architectural issues at the design
  > stage is dramatically cheaper than after a build cycle. Proceed anyway, or
  > pause to revise?"
  Wait for explicit user confirmation. If they choose to proceed, return
  success but log the override in the response so the mill skill (if calling
  this) knows the user accepted the risk.

## Rules

- **Only spawn the two design-capable reviewers.** Other reviewers need code
  and will run inside the mill.
- **Do not write to disk.** No review.md, no design-review.md, no separate
  artifact. The output is conversational only.
- **Findings are advisory unless the user accepts them.** This skill never
  modifies design.md. If findings warrant changes, the user (or foundry, if
  re-invoked) makes them.
- **Auto-run from mill is supported.** When invoked from the mill skill at
  step 0, return a structured result the mill can branch on:
  `{status, findings_count, user_proceeded}`.
- **Manual invocation is also supported.** A user may run
  `use the design-review skill on {feature} {layer}` at any time after design
  is confirmed and before mill is run.
