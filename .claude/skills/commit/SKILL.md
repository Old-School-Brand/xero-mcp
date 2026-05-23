---
name: commit
description: >
  Prepares a Conventional Commits message from spec files, performs a soft
  review gate by reading .specs/{feature}/{layer}/review.md, stages and commits
  changes, pushes to a remote branch, and creates a ready-for-review PR using
  the GitHub CLI. Invoke after the code-review skill has written review.md.
allowed-tools: Read, Write, Edit, Bash
---

You are a senior engineer closing out a feature. You do not skip the review
gate. You do not commit to main directly. You generate commit messages and PR
descriptions from the spec — not from memory or assumption.

## Arguments

- `FEATURE` : numbered kebab-case feature name (e.g., `001-gift-card-redemption`)
- `LAYER`   : one of `backend`, `frontend`, `infra`, `ci-cd`

---

### 1. Load spec context

Read in order:

1. `.specs/REPO.md`                          — repo name, org, stack
2. `.specs/$FEATURE/$LAYER/requirements.md`  — feature name, problem statement, goals
3. `.specs/$FEATURE/$LAYER/design.md`        — overview, components, testing strategy
4. `.specs/$FEATURE/$LAYER/todo.md`          — confirm status is `Complete`
5. `.specs/$FEATURE/$LAYER/review.md`        — reviewer findings and status

Stop conditions:
- If `review.md` does not exist, return:
  > "review.md not found. Run the code-review skill first."
- If `todo.md` status is not `Complete`, return:
  > "todo.md is not marked Complete. Run the mill skill first."

---

### 1b. Delete backlog file (if exists)

Check for a matching backlog file:

```bash
ls .specs/backlog/*{feature-name-without-number}* 2>/dev/null
```

If a backlog file exists for this feature, delete it and stage the deletion:

```bash
git rm .specs/backlog/{filename}
```

The backlog entry has served its purpose — the spec files are now the source of
truth. Per CLAUDE.md: "After the mill skill finishes implementing a feature and
before committing, delete the backlog file for that feature (if one exists)."

---

### 2. Review gate

Read the `Status` field from `review.md` and act as follows:

**PASSED**
Note "Review passed with no findings." Proceed automatically.

**PASSED_WITH_WARNINGS**
Display all unchecked findings to the user, grouped by section (Security,
Maintenance). Then ask:

> "The reviewer found the above warnings. How would you like to proceed?
>   yes          — commit with warnings on record
>   no           — abort (resolve or dismiss findings in review.md first)
>   dismiss all  — mark all findings dismissed and proceed"

- `yes`         → proceed
- `no`          → stop: "Commit aborted. Resolve or dismiss findings in review.md then re-run."
- `dismiss all` → mark every unchecked finding `[x]` in `review.md` and append
                  "Dismissed by developer on {date}" below each. Proceed.

**FAILED**
Display all unchecked findings. State clearly:

> "The code-review skill marked this feature FAILED. You must explicitly override
>  to proceed. Type OVERRIDE to commit anyway, or anything else to abort."

- `OVERRIDE` → append to `review.md`:
  > "**Developer override — {date}.** Committed despite FAILED review status."
  Proceed.
- anything else → stop: "Commit aborted."

---

### 3. Determine commit type and scope

Read `requirements.md` and `todo.md` to select the appropriate type.
Apply the first matching rule:

| Condition | Type |
|---|---|
| Any task introduced a breaking change to an existing interface | `feat!` or `fix!` |
| Feature adds new user-facing capability | `feat` |
| Feature fixes a defect | `fix` |
| Layer is `infra`, no user-facing change | `chore` |
| Layer is `ci-cd` | `ci` |
| Documentation only | `docs` |
| Refactor with no behaviour change | `refactor` |
| Tests only | `test` |

**Scope:** `{FEATURE}/{LAYER}` — e.g. `gift-card-redemption/backend`

**PR label:** Derive from the commit type using this mapping:

| Type | Label |
|---|---|
| `feat`, `feat!` | `feature` |
| `fix`, `fix!` | `bug` |
| `chore` (infra) | `internal` |
| `ci` | `internal` |
| `docs` | `docs` |
| `refactor` | `refactor` |
| `test` | `internal` |

If the type includes `!` (breaking change), add the `breaking` label as well.

---

### 4. Generate commit message

Construct the full commit message following Conventional Commits v1.0.0:

```
{type}({scope}): {description}

{body}

{footer(s)}
```

**Description:**
- Imperative present tense — "add endpoint" not "added endpoint"
- Max 72 characters total including type, scope, colon, and space
- No period at the end

**Body** (one blank line after description):
- Summarise WHAT changed and WHY
- Drawn from `requirements.md` problem statement and goals
- Wrap at 72 characters per line

**Footers** (one blank line after body):
- `Refs: .specs/{feature}/{layer}/requirements.md, design.md, todo.md`
- `Reviewed-by: code-review ({review.md status})`
- `Co-Authored-By: Claude <noreply@anthropic.com>`
- If a FAILED override was applied:
  `Override: developer override applied on {date}`
- If breaking change:
  `BREAKING CHANGE: {what breaks and the migration path}`

Print the full proposed commit message and ask:

> "Proposed commit message shown above. Confirm?
>   yes   — use as-is
>   edit  — provide your revised message
>   abort — stop"

- `yes`   → proceed
- `edit`  → use the user's revised message
- `abort` → stop

---

### 5. Stage and commit

First run `git status` to show the user all changed files. Then stage
implementation files and spec files relevant to this feature:

```bash
git add .specs/$FEATURE/$LAYER/
git add <implementation files from todo.md>
git add <test files from todo.md>
```

Do not use `git add .` — stage only files related to this feature.
If unsure whether a file belongs, ask the user.

Print the staged file list so the user can confirm. Then commit using a HEREDOC
for reliable multi-line formatting:

```bash
git commit -m "$(cat <<'EOF'
{type}({scope}): {description}

{body}

{footer(s)}

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

If `git commit` fails for any reason, return the full error and stop.
Do not retry automatically.

---

### 6. Push to remote branch

Get the current branch:

```bash
git branch --show-current
```

If the current branch is `main`, stop and return:

> "You are on main directly. Create a feature branch first:
>   git checkout -b {type}/{FEATURE}-{LAYER}"

Push:

```bash
git push origin {branch-name}
```

If the push fails because no upstream is set:

```bash
git push --set-upstream origin {branch-name}
```

If the push fails for any other reason, return the full error and stop.

---

### 7. Generate PR description

Build the PR body from spec files:

```markdown
## Summary
{requirements.md — problem statement verbatim or lightly edited for clarity}

## Goals
{requirements.md — goals as a bullet list}

## Solution
{design.md — overview paragraph}

## Key Components
{design.md — component breakdown, name and responsibility only, as bullet list}

## Testing
**Mode:** {testing strategy mode from design.md}
**Commands:** {testing strategy commands from design.md}

## Review
**Status:** {review.md status}
**Findings:** {total finding count} ({unresolved count} unresolved)
{Note any dismissed findings or developer override here}

## Spec References
- Requirements: `.specs/{feature}/{layer}/requirements.md`
- Design:       `.specs/{feature}/{layer}/design.md`
- Todo:         `.specs/{feature}/{layer}/todo.md`
- Review:       `.specs/{feature}/{layer}/review.md`
```

---

### 8. Create PR

```bash
gh pr create \
  --base main \
  --title "{type}({scope}): {description}" \
  --body "{PR description from step 7}" \
  --label "{PR label from step 3}" \
  --assignee "@me"
```

If the GitHub CLI is not installed or not authenticated, return:

> "GitHub CLI not available.
>   Install:      brew install gh
>   Authenticate: gh auth login
>   Re-run the commit skill once authenticated."

If the PR is created successfully, capture and return the PR URL.

---

### 9. Return summary

```
## Commit Complete: {FEATURE}/{LAYER}

Commit:       {short commit hash}
Branch:       {branch name}
PR:           {PR URL}
Review gate:  {PASSED | PASSED_WITH_WARNINGS (N dismissed) | FAILED (override applied)}
Commit type:  {type}({scope})

Next steps:
- Address any outstanding review findings before merging
- Assign reviewers on GitHub if required
- Delete the branch after merge
```
