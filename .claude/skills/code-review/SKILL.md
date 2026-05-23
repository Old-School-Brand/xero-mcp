---
name: code-review
description: >
  Orchestrates reviewer agents for a given feature and layer. Reads each
  reviewer's declared `triggers:` block and only spawns reviewers whose
  triggers match the current iteration / layer / mode / manifest changes.
  Combines findings into a single .specs/{feature}/{layer}/review.md. Use
  this after the build agent has completed implementation.
allowed-tools: Read, Write, Glob, Bash, Agent
---

You are a review orchestrator. You do not perform reviews yourself — you
discover reviewer agents, evaluate their declared triggers against the current
iteration and change set, spawn the matching reviewers in parallel, collect
their structured findings, and write a combined review file.

## Arguments

- `$FEATURE`     : numbered kebab-case feature name (e.g., `001-gift-card-redemption`)
- `$LAYER`       : one of `backend`, `frontend`, `infra`, `ci-cd`
- `$ITERATION`   : integer (1, 2, 3) — which mill iteration this is. Default 1
                   when called outside the mill.
- `$IS_FINAL`    : boolean — set true on the final code-review of the mill loop
                   (either iteration == MAX, or the post-convergence final-pass
                   guard). Used to match the `"final"` literal in reviewers'
                   `iterations` lists. Default false.

## Trigger schema (read by this skill from each reviewer's frontmatter)

Each reviewer agent declares a `triggers:` block in its YAML frontmatter:

```yaml
triggers:
  layers: [backend, frontend, infra, ci-cd]    # SKIP filter — if set and current $LAYER not listed, SKIP
  testing_modes: [full-tdd, verification-only] # SKIP filter — if set and current Testing Strategy mode not listed, SKIP
  manifests: [package.json, pyproject.toml]   # RUN trigger — if any listed file is in the changed-file set, RUN
  iterations: [1, "final"]                     # RUN trigger — RUN when current $ITERATION matches any int in the list, OR when the list contains "final" and $IS_FINAL is true
  default: skip                                # what to do when no RUN trigger matched. `skip` or `run`. Defaults to `run` if omitted.
```

Two field categories with distinct semantics:

- **SKIP filters** (`layers`, `testing_modes`) — exclusionary. If the field is
  set and the current value doesn't match, the reviewer is SKIPPED outright,
  regardless of any RUN trigger.
- **RUN triggers** (`manifests`, `iterations`) — inclusionary. Any one match
  flips the reviewer to RUN.
- `default` — applied when no RUN trigger matched (and no SKIP filter
  excluded). `skip` means the reviewer doesn't spawn this iteration; `run`
  means it does.

Type rules:
- `iterations` may mix ints and the string `"final"`. Compare ints to
  `$ITERATION`. The literal `"final"` matches when `$IS_FINAL=true`.
- `manifests` are matched against the **basename** of each changed file
  (e.g. `frontend/package.json` matches the entry `package.json`).

## Steps

### 1. Discover reviewers

Use Glob on `.claude/agents/*-reviewer.md`. For each match, read the YAML
frontmatter and extract:

- `name` (the reviewer agent name)
- `triggers:` block (parse fields above; missing fields are treated as
  unrestricted)

### 2. Load context

Read `.specs/$FEATURE/$LAYER/todo.md` to confirm status is `Ready for Review`
or `Complete`. If status is `Pending` or `In Progress`, stop:
> "Todo is not yet ready for review. Run the build agent first."

Read `.specs/$FEATURE/$LAYER/design.md`. Note the **Testing Strategy mode**
(`full-tdd`, `verification-only`, or `none`).

### 3. Compute change scope

Run once and cache:

```bash
git diff --name-only "$(git merge-base HEAD main)...HEAD"
```

This is the only diff data triggers consume. If `main` doesn't exist, fail
loudly — there's no meaningful baseline to compute against. Note in the
review.md header which baseline was used.

### 4. Filter reviewers

For each discovered reviewer, in order:

1. **Apply SKIP filters.** If `layers` is set and `$LAYER` is not in it: mark
   SKIP, reason `"layer mismatch"`. If `testing_modes` is set and the current
   mode is not in it: mark SKIP, reason `"mode mismatch"`. SKIP filters are
   absolute — no later step un-skips.
2. **Evaluate RUN triggers.**
   - `manifests`: any listed basename present in the changed-file set → RUN
     trigger fires.
   - `iterations`: any integer matches `$ITERATION`, or the list contains
     `"final"` and `$IS_FINAL` is true → RUN trigger fires.
   - If any RUN trigger fired: mark RUN.
3. **Apply `default`.** If no RUN trigger fired, apply `default` (`run` or
   `skip`). If `skip`, record reason `"no triggers matched, default=skip"`.

#### Iteration-2+ skip-when-clean refinement

When `$ITERATION > 1` AND `.specs/$FEATURE/$LAYER/review.md` already exists,
apply one extra optimization to reviewers currently marked RUN:

- Parse the prior iteration's findings for each reviewer.
- If the reviewer had **zero unresolved `[ ]` findings** in its prior section:
  downgrade to SKIP with reason
  `"clean from prior iteration; nothing to re-check"`.

This applies uniformly. It also removes the contradiction with the mill's
final-pass step: when the mill triggers a post-convergence guard (with
`$IS_FINAL=true`, iteration unchanged), the only reviewers that newly become
eligible are those whose `iterations` list contains `"final"`. All other
default-run reviewers were clean in the prior iteration and get skipped here.
Net effect: the final pass runs only the cheap "final-only" reviewers (docs,
deps, etc), exactly as the mill expects.

### 5. Spawn matched reviewers in parallel

For each reviewer marked RUN, spawn it using the Agent tool **in a single
message** (all calls parallel). Pass each agent the following prompt:

> Review the implementation for the `$FEATURE` feature in the `$LAYER` layer.
>
> Testing Strategy mode: `{mode from design.md}`
> Iteration: `$ITERATION` (final: `$IS_FINAL`)
>
> Context:
> - Design: `.specs/$FEATURE/$LAYER/design.md`
> - Todo: `.specs/$FEATURE/$LAYER/todo.md`
> - Requirements: `.specs/$FEATURE/$LAYER/requirements.md`
>
> Read the spec files and the implementation files referenced in todo.md.
> Review the implementation against the design and requirements.
>
> Return your findings in the structured format declared by your agent
> definition. If you have no findings, return RESULT: PASSED and FINDINGS: none.

If no reviewers matched (all skipped), record this in review.md and return
status `PASSED` with a note.

### 6. Combine results into review.md

Parse each spawned reviewer's response. Determine the overall status:

- If any reviewer returned `FAILED` (or `MUST_FIX`) → overall status is `FAILED`
- If any returned `WARNINGS` (or `PASSED_WITH_WARNINGS` / `SHOULD_FIX`) and
  none `FAILED`/`MUST_FIX` → `PASSED_WITH_WARNINGS`
- If all returned `PASSED` → `PASSED`

Skipped reviewers do not affect status — they are recorded for transparency
but their absence is not a finding.

#### Iteration label

Use this label format throughout review.md:

- Normal review: `iteration {N}`
- Mill final-pass guard (called with `$IS_FINAL=true` and iteration unchanged
  from a prior PASSED review): `iteration {N} (final pass)`

The skill detects "final pass" by reading the prior review.md: if the prior
record was already at iteration `$ITERATION` and the prior status was
`PASSED` or `PASSED_WITH_WARNINGS` with only nits, this invocation is the
final pass.

#### First iteration (no existing review.md)

Write `.specs/$FEATURE/$LAYER/review.md`:

```
# Review: {Feature Name}
**Layer:** {layer}
**Feature:** {feature}
**Date:** {date}
**Iteration:** {iteration label}
**Status:** PASSED | PASSED_WITH_WARNINGS | FAILED

## Reviewer Selection ({iteration label})

Ran:     {comma-separated list of reviewers spawned}
Skipped: {list of reviewers skipped, each with one-line reason}

## {Reviewer Name} Review
**Result:** PASSED | WARNINGS | FAILED

### Findings
- [ ] {severity} — {finding title} — {file}:{line}
      {description}
      Recommendation: {recommendation}

(repeat for each reviewer that ran)

## Summary
{One paragraph overall assessment.}
```

#### Subsequent iterations (existing review.md)

When `.specs/$FEATURE/$LAYER/review.md` already exists, **merge** fresh
reviewer output with the existing review history:

1. **Read the existing review.md.** Extract all findings, noting which are
   resolved (`[x]`) and their resolution notes.
2. **For each reviewer section**, merge findings:
   - Resolved findings (`[x]`) from prior iterations: keep as-is (audit trail).
   - Previously open findings not re-flagged by a re-run reviewer: mark `[x]`
     with `Resolved: confirmed fixed by reviewer ({iteration label})`.
   - Previously open findings re-flagged: keep as `[ ]`, update description if
     the reviewer provided new detail.
   - New findings: add as `[ ]`.
   - Reviewers that were SKIPPED this iteration (for any reason) leave their
     prior findings untouched. Do not auto-resolve findings just because the
     reviewer didn't run — they're still open until a reviewer re-runs and
     stops flagging them, or the user dismisses them.
3. **Update header**:
   - `**Date:**` to today
   - `**Iteration:**` to current iteration label
   - `**Status:**` to new overall status
   - Per-reviewer `**Result:**`
4. **Append a new "Reviewer Selection ({iteration label})" block** above the
   reviewer sections so each iteration's run/skip decision is recorded.
5. **Update the Summary** to reflect the current state.

#### Finding matching

Match findings across iterations by: reviewer name + severity + finding title
+ file path. Minor line-number drift is acceptable.

Rules:

- If a reviewer returned no findings, write "No findings." under its Findings
  heading.
- Severity levels: `must-fix`, `should-fix`, `nit`.
- Each finding gets a checkbox.
- Never remove findings from prior iterations — they are the audit trail.
- Resolved findings are marked `[x]` with a reason.
- Dismissed findings are marked `[x]` with a dismissal reason.

### 7. Return summary

Return to the calling session:

- Overall status
- Reviewer roster (ran vs skipped, with skip reasons)
- Count of findings per reviewer and severity
- Path to review.md

Gate behaviour for the commit skill:

- `PASSED` → proceed without prompting
- `PASSED_WITH_WARNINGS` → surface findings, ask for confirmation
- `FAILED` → surface findings, require explicit override with reason
