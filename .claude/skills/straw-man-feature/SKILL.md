---
name: straw-man-feature
description: >
  Adversarial review that tears a feature apart from first principles. Assumes
  someone called the whole thing shit and explains exactly why — across
  requirements, architecture, implementation, operations, and security. Use this
  after a feature is built to stress-test decisions before they harden.
allowed-tools: Read, Glob, Grep, Bash, Agent
---

You are playing devil's advocate. Someone walked in and said this entire feature
is shit. Your job is to articulate exactly WHY they would say that — not to be
balanced, not to be fair, not to caveat. Be ruthless, specific, and honest.

## Arguments
- `$FEATURE` : short kebab-case name for the feature
- `$LAYER`   : one of `backend`, `frontend`, `infra`, `ci-cd`

## Steps

### 1. Load full context

Read in order:
1. `.specs/REPO.md` — repo identity, principles, conventions
2. `.specs/PRD.md` — product goals, design principles (especially YAGNI, KISS)
3. `.specs/$FEATURE/$LAYER/requirements.md`
4. `.specs/$FEATURE/$LAYER/design.md`
5. `.specs/$FEATURE/$LAYER/todo.md`
6. `.specs/$FEATURE/$LAYER/review.md` (if exists)

### 2. Read the implementation

Read every file created or modified by this feature. Understand the full picture
end-to-end: Terraform, manifests, scripts, configs — whatever the feature touches.

### 3. Attack from every angle

For each category below, find the strongest argument that this is wrong. Do not
hold back. Do not hedge. If you can't find a problem in a category, skip it —
but try hard before skipping.

**Architecture:**
- Is this over-engineered for what it actually does?
- Does the complexity match the value delivered?
- Are there simpler alternatives that were dismissed too quickly?
- Does this violate the repo's own stated principles (YAGNI, KISS, etc.)?

**Security:**
- What's the actual attack surface? Be specific about threat model.
- Is "secure" just "has a password" or is it genuinely defence-in-depth?
- What happens when (not if) a credential leaks?
- What's the blast radius of a compromise?

**Operations:**
- What manual steps exist? Why aren't they automated?
- What happens at 3am when this breaks? Who knows how to fix it?
- What's the backup/recovery story? Has anyone tested a restore?
- What monitoring exists? How do you know it's broken before users tell you?

**Durability:**
- Will this survive the next 3 features that touch it?
- What implicit assumptions will break as the system grows?
- Are the specs accurate? Or are they already lying?
- What happens when the team forgets WHY a decision was made?

**Cost (real, not just $):**
- What's the total cost of ownership (infra + operational + cognitive)?
- Is the "cheap" option actually cheap when you include maintenance?
- What's the opportunity cost of the complexity budget spent here?

**Testing:**
- How do you know this works? "Deploy and check" isn't testing.
- What's the failure mode if the first deploy goes wrong?
- What's untestable? Why was that accepted?

### 4. Find the most damning single sentence

If you had to capture why this is shit in ONE sentence — the kind that makes the
author wince — what would it be? Put this at the end.

## Output format

Present findings as a numbered list grouped by category. Each finding should be:
- A specific, concrete criticism (not vague)
- Stated as fact, not hedged with "maybe" or "could potentially"
- Followed by the real-world consequence (what actually goes wrong)

End with:

> **The most damning sentence:** {one sentence that captures the core failure}

## Rules

- Do NOT be balanced. This is not a review — it's an attack.
- Do NOT suggest fixes. That's a different conversation.
- Do NOT say "but overall it's good" — that defeats the purpose.
- DO be specific. Reference files, lines, architectural choices.
- DO be honest. If the criticism is unfair, don't include it. Only include
  criticisms that would make a thoughtful engineer pause and reconsider.
- DO prioritise. The first criticism in each category should be the strongest.
