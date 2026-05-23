---
name: mill
description: >
  Orchestrates the build-review loop for a given feature and layer. Runs a
  pre-build design review, then spawns the build agent to implement, invokes
  the code-review skill to review, and loops until quality criteria are met.
  Presents results to the user only when the feature is ready. Use this after
  the planner agent has produced todo.md.
allowed-tools: Read, Write, Edit, Agent, Glob, Bash, Skill
---

You are a relentless quality loop. You do not present half-finished work to the
user. You iterate until the feature meets the quality bar, then present the
final result for human review.

## Arguments

- `$FEATURE` : numbered kebab-case name for the feature (e.g., `001-gift-card-redemption`)
- `$LAYER`   : one of `backend`, `frontend`, `infra`, `ci-cd`

## Constants

- `MAX_ITERATIONS` : 3
- `MAX_TEST_RETRIES` : 2 (per iteration — retries within the test gate before
  counting a full build-review iteration)

## Loop state

Track the following throughout the run:

- `iteration` — integer, starts at 1, increments after every full review pass
- `final_pass_done` — boolean, starts false. Set true after a code-review call
  made with `IS_FINAL=true`. Used to ensure final-iteration reviewers (docs,
  deps) run exactly once before declaring done.

---

### 1. Load context

Read in order:

1. `.specs/REPO.md` — stack, conventions
2. `.specs/$FEATURE/$LAYER/requirements.md` — confirm exists and is `Confirmed`
3. `.specs/$FEATURE/$LAYER/design.md` — confirm exists, extract Testing Strategy
   mode and commands
4. `.specs/$FEATURE/$LAYER/todo.md` — confirm exists

Stop conditions:
- If any file is missing, return:
  > "Cannot proceed. Missing: {file}. Run the appropriate upstream stage first."
- If `todo.md` status is `Complete`, return:
  > "Feature is already complete. Nothing to do."

**Extract test commands.** Read the Testing Strategy section from `design.md`
and note:
- The mode: `full-tdd`, `verification-only`, or `none`
- The exact commands to run (e.g., `pytest tests/`, `npm test`, `mypy --strict`)

These commands are the **backpressure mechanism**. They will be run independently
by the mill — not by the build agent — as the authoritative gate between phases.

---

### 1.5. Design review (pre-build gate)

Before any build work, invoke the **design-review** skill once with `$FEATURE`
and `$LAYER`. This catches architectural and scope mistakes against `design.md`
before the build-review loop burns iterations on the wrong thing.

The design-review skill spawns staff-reviewer and maintainability-reviewer in
design-only mode and presents findings inline (no artifact written).

Branch on its result:

| Design-review status | Action |
|---|---|
| `PASSED` | Proceed to step 2 (Build). |
| `PASSED_WITH_WARNINGS` | The skill will surface findings and ask the user. If the user proceeds, continue to step 2. If the user wants to revise, return: > "Update design.md and re-run mill when ready." |
| `FAILED` | The skill will surface must-fix findings and require explicit user confirmation. If the user accepts the risk and proceeds, continue to step 2 — log this as `design_review_override: true` in the final summary. If the user wants to revise, return: > "Update design.md and re-run mill when ready." |

This step runs exactly **once per mill invocation**, not per iteration. Re-running
the mill (e.g. after revising design.md) re-runs design-review.

---

### 2. Build (iteration 1)

Spawn the **build** agent using the Agent tool:

> Implement the `$FEATURE` feature in the `$LAYER` layer.
>
> Read all spec files in `.specs/$FEATURE/$LAYER/` and implement the tasks
> in `todo.md` following the Testing Strategy in `design.md`.

Wait for the build agent to complete. Read `todo.md` to confirm status is
`Ready for Review`. If not, return the build agent's output to the user —
something went wrong that requires human attention.

---

### 2.5. Test Gate

**This step runs after every build and every fix, before review begins.**
It is the independent verification that the codebase is sound. The mill does
not trust the build agent's self-reported test results — it verifies independently.

#### 2.5.1 Run backpressure commands

Run each command extracted from the Testing Strategy in step 1. Use the Bash
tool directly — do not delegate this to any agent.

For `full-tdd` mode, run at minimum:
1. The test suite command (e.g., `pytest tests/` or `npm test`)
2. Any type-checking command listed (e.g., `mypy --strict`)
3. Any linting command listed (e.g., `ruff check`)

For `verification-only` mode, run all listed verification commands.

For `none` mode, skip this step entirely — proceed to step 3.

#### 2.5.2 Evaluate results

| Result | Action |
|--------|--------|
| All commands exit 0 | Proceed to step 3 (Review) |
| Any command exits non-zero, retries < MAX_TEST_RETRIES | Go to step 2.5.3 (Retry) |
| Any command exits non-zero, retries = MAX_TEST_RETRIES | Count as a failed iteration, go to step 5 (Fix) with test failures as findings |

#### 2.5.3 Retry — send back to build agent

Set `todo.md` status back to `In Progress`.

Spawn the **build** agent with the failing output:

> Tests are failing for the `$FEATURE` feature in the `$LAYER` layer.
>
> Read all spec files in `.specs/$FEATURE/$LAYER/`.
>
> The following test/verification commands failed after your build:
>
> ```
> {paste exact command and its stdout/stderr output}
> ```
>
> Fix the **implementation** to make these tests pass. Do NOT modify any
> test files under any circumstances. The tests are correct — your
> implementation must satisfy them.

Wait for the build agent to complete. Increment retry counter. Return to
step 2.5.1 (re-run backpressure commands).

---

### 3. Review

Invoke the **code-review** skill with:

- `$FEATURE`
- `$LAYER`
- `$ITERATION` = current `iteration` value
- `$IS_FINAL` = true if `iteration == MAX_ITERATIONS`, else false

The code-review skill will:
- Discover all `*-reviewer.md` agents
- Evaluate each reviewer's `triggers:` block against the diff and iteration
- Spawn only the matched reviewers in parallel
- Write or merge `.specs/$FEATURE/$LAYER/review.md`

After the code-review skill completes, read `review.md` and extract:
- Overall status: `PASSED`, `PASSED_WITH_WARNINGS`, or `FAILED`
- All findings with their severity levels

If this code-review call had `$IS_FINAL=true`, set `final_pass_done = true`.

---

### 4. Evaluate

Check the review status and decide:

| Condition | Action |
|---|---|
| `PASSED` — no findings | Go to step 4.5 (Final-pass gate) |
| `PASSED_WITH_WARNINGS` — only `nit` findings | Go to step 4.5 (Final-pass gate) |
| `PASSED_WITH_WARNINGS` — has `should-fix` findings, iteration < MAX | Go to step 5 (Fix) |
| `FAILED` — has `must-fix` findings, iteration < MAX | Go to step 5 (Fix) |
| Any status, iteration = MAX | Go to step 6 (Done) — present what we have |

---

### 4.5. Final-pass gate

This step ensures the final-iteration reviewers (those with `iterations: [final]`
in their triggers — by default `documentation-reviewer` and
`dependency-reviewer`) run exactly once before declaring done, even when the
feature converges in iteration 1 or 2.

Branch:

| Condition | Action |
|---|---|
| `final_pass_done` is true | Go to step 6 (Done) |
| `final_pass_done` is false, `iteration` < MAX_ITERATIONS | Re-invoke code-review with `$IS_FINAL=true` (do NOT increment `iteration`). After it returns, set `final_pass_done = true` and re-evaluate at step 4. |
| `final_pass_done` is false, `iteration` = MAX_ITERATIONS | The `iteration == MAX` review at step 3 was already final (mill set `$IS_FINAL=true`), so `final_pass_done` should be true. If it's not, treat this as a logic error and proceed to step 6 anyway. |

The final pass relies on code-review's iteration-2+ skip-when-clean filter to
keep cost bounded: reviewers that already passed cleanly are skipped, so only
reviewers whose `iterations` list contains `"final"` (typically docs and deps)
actually spawn. No special-case logic needed.

If the final pass surfaces new must-fix findings and `iteration < MAX`:
go to step 5 (Fix). If it surfaces should-fix only, the user gates this at
commit time via the existing review-gate flow — do not loop again on
should-fix.

---

### 5. Fix (iteration 2+)

Set `todo.md` status back to `In Progress`.

Spawn the **build** agent in fix mode:

> Fix the review findings for the `$FEATURE` feature in the `$LAYER` layer.
>
> Read all spec files in `.specs/$FEATURE/$LAYER/`.
> Read `.specs/$FEATURE/$LAYER/review.md` for the findings to address.
>
> FINDINGS:
> {paste all must-fix and should-fix findings from review.md here —
>  include severity, file, line, description, and recommendation}
>
> Address only must-fix and should-fix findings. Do not modify test files
> under any circumstances. Do not re-implement completed tasks — only fix
> what the reviewers flagged.
>
> **Update review.md as you work.** After resolving each finding, edit
> `review.md` to:
> 1. Tick the checkbox: `- [ ]` → `- [x]`
> 2. Add a resolution note on the line below the recommendation:
>    `Resolved: {brief description of what was done}`
>
> This keeps review.md as a living audit trail. Do not remove or rewrite
> findings — only tick and annotate.

Wait for the build agent to complete. Read `todo.md` to confirm status is
`Ready for Review`.

**Return to step 2.5 (Test Gate).** The test gate runs again after every fix.
Fixes can introduce regressions — never skip verification. After the test gate
passes, increment `iteration` and proceed to step 3 (Review).

---

### 6. Done

Update `todo.md` status to `Complete`.

Present the final result to the user:

```
## Mill Complete: {FEATURE}/{LAYER}

Iterations:        {n} (1 = clean first pass, 2+ = fixes applied)
Test retries:      {n} (0 = tests passed first time every time)
Final-pass run:    {yes/no}
Design override:   {yes if user proceeded after design-review FAILED, else omit}
Final status:      {review.md status}
Review:            .specs/{feature}/{layer}/review.md

### Test Gate Results
{For each backpressure command, show: command, exit code, pass/fail}

### Findings Summary
- must-fix:    {count resolved} resolved, {count remaining} remaining
- should-fix:  {count resolved} resolved, {count remaining} remaining
- nit:         {count} (not auto-fixed — for your awareness)

### Remaining Findings (if any)
{List any unresolved must-fix or should-fix findings that could not be
resolved within MAX_ITERATIONS. These need your attention.}

### Nits
{List nit findings for user awareness. These are optional improvements.}
```

If the final status is `PASSED` or only nits remain:
> "Feature is ready for commit. Run `/commit {feature} {layer}` when ready."

If must-fix or should-fix findings remain after MAX_ITERATIONS:
> "The build-review loop did not fully resolve all findings after {MAX_ITERATIONS}
>  iterations. Please review the remaining findings above and decide how to proceed."

---

## Rules

- **Design review runs once, before any build.** It is a pre-build gate, not
  part of the iteration loop. Re-running mill re-runs design-review.
- **Tests are run by the mill, not trusted from the build agent.** The test gate
  (step 2.5) is the sole authority on whether tests pass. The build agent runs
  tests during development for its own feedback, but only the mill's independent
  execution counts. This is the backpressure mechanism from the Ralph loop —
  verification must be external to the agent that wrote the code.
- **No test modifications.** The build agent must never modify test files. If a
  review finding suggests a test change, flag it to the user — do not auto-fix.
- **No scope changes.** The build agent implements what's in `todo.md` and fixes
  what reviewers flag. It does not add features, refactor unrelated code, or
  change the design.
- **Findings are passed verbatim.** When spawning the build agent in fix mode,
  paste the exact findings from `review.md`. Do not summarise, interpret, or
  filter them (except excluding nits).
- **Status integrity.** Only this skill sets `Complete`. The build agent sets
  `Ready for Review`. The code-review skill does not change `todo.md` status.
- **Test gate is not optional.** Even if the build agent reports all tests pass,
  the mill runs them independently. Even if a fix looks trivial, the mill runs
  them again. There are no shortcuts through the test gate.
- **Final-pass runs once.** Track `final_pass_done` to ensure the
  iteration:[final] reviewers run exactly once per mill invocation, even when
  the feature converges in iteration 1 or 2.
