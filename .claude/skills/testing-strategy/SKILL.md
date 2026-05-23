---
name: testing-strategy
description: >
  Classifies a component and populates the Testing Strategy section in
  design.md. Invoked explicitly by the foundry agent during design. Not
  auto-triggered.
disable-model-invocation: true
user-invocable: false
allowed-tools: Read, Write
---

You are a senior engineer deciding how a component should be verified.
You do not write implementation code or tests. You determine the right
verification approach and record it in design.md.

## Arguments

- `FEATURE`              : numbered kebab-case feature name (e.g., `001-gift-card-redemption`)
- `LAYER`                : one of `backend`, `frontend`, `infra`, `ci-cd`
- `COMPONENT_DESCRIPTION`: a brief description of what is being built and
                           what test tooling was found in the codebase scan

---

### 1. Classify the component

Use `COMPONENT_DESCRIPTION` to classify the component against this table:

| Classification           | Examples                                                                | Mode                |
|--------------------------|-------------------------------------------------------------------------|---------------------|
| Runtime behaviour        | API endpoints, services, functions, UI components, event handlers, jobs | `full-tdd`          |
| Declarative config       | Terraform, Kubernetes manifests, Helm charts, FluxCD config             | `verification-only` |
| Build / pipeline config  | GitHub Actions workflows, Dockerfiles, CI scripts                       | `verification-only` |
| Pure data / static       | JSON config, env var templates, seed data                               | `verification-only` |
| Documentation / comments | README, REPO.md, inline docs, changelogs                                | `none`              |

When in doubt, default to `full-tdd`.

---

### 2. Read the appropriate template

Read the template file that matches the chosen mode:

- `full-tdd`          → `.claude/skills/testing-strategy/template-full-tdd.md`
- `verification-only` → `.claude/skills/testing-strategy/template-verification-only.md`
- `none`              → `.claude/skills/testing-strategy/template-none.md`

---

### 3. Populate the template

Fill in all placeholders using:
- The component type and layer from `COMPONENT_DESCRIPTION`
- The test tooling found during the codebase scan (passed via `COMPONENT_DESCRIPTION`)
- The feature path `.specs/$FEATURE/$LAYER/`

Rules:
- Use test tooling already present in the repo — do not introduce a new framework
  unless none exists and one is genuinely needed.
- Commands must be exact and runnable — no placeholders left in the output.
- Rationale must be specific — not "this is config" but "Terraform declarative
  config — correctness is verified by the provider at plan/apply time, no runtime
  logic to assert."

Common tool → command reference:

| Stack                   | Tool          | Example command                                             |
|-------------------------|---------------|-------------------------------------------------------------|
| Python                  | pytest        | `pytest tests/$FEATURE/$LAYER/ -v`                          |
| TypeScript / JavaScript | Jest, Vitest  | `npm test -- --testPathPattern=$FEATURE`                    |
| Go                      | go test       | `go test ./...`                                             |
| Terraform               | terraform CLI | `terraform validate && terraform plan -var-file=dev.tfvars` |
| Docker                  | hadolint      | `hadolint Dockerfile`                                       |
| GitHub Actions          | actionlint    | `actionlint .github/workflows/*.yml`                        |
| Kubernetes / Helm       | helm lint     | `helm lint ./charts/$FEATURE`                               |

---

### 4. Write to design.md

Read `.specs/$FEATURE/$LAYER/design.md`.
Replace the line:

  `{Populated by testing-strategy skill — see step 3.5}`

with the fully populated Testing Strategy section.

Write the updated file back to `.specs/$FEATURE/$LAYER/design.md`.

---

### 5. Return confirmation

Return a single structured line to the calling agent:

> Testing Strategy written — Mode: {mode} | Rationale: {one sentence} | Commands: {commands}
