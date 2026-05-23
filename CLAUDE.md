# CLAUDE.md

This file provides guidance to Claude Code when working with any repository.
For repo-specific context, architecture, and technology details, always read `.specs/REPO.md` first.

---

## First Step

At the start of every new session or feature, read these in order:

1. `.specs/REPO.md` — what this repo does, tech stack, active spec layers, repo-specific rules
2. `.specs/PRD.md` — product context and design principles
3. `.specs/GLOSSARY.md` — canonical domain vocabulary. Use these terms verbatim in specs, code, and conversation; never invent synonyms.

---

## Spec-Driven Development Pipeline

All feature work follows a strict spec-first pipeline. Code is never written before a spec exists.

### Spec Structure

.specs/
├── REPO.md                              ← Repo-specific context (read at session start)
├── PRD.md                               ← Top-level product/repo design and requirements
├── backlog/                             ← Future feature ideas (freeform notes, not yet in pipeline)
│   └── {feature-name}.md               ← Pass to refinery when ready to start
└── {NNN-feature-name}/                  ← e.g. 001-core-infra
    └── {layer}/                         ← backend, frontend, infra, ci-cd
        ├── requirements.md              ← Written by refinery skill
        ├── design.md                    ← Written by foundry agent
        ├── todo.md                      ← Written by planner agent
        └── reference.md                 ← Written by librarian agent

> Not all layers apply to every repo. Refer to `.specs/REPO.md` to see which layers are active.

### Feature Naming Convention

Feature folders are prefixed with a zero-padded 3-digit sequence number to preserve chronological order:

```
{NNN}-{kebab-case-name}
```

Examples: `001-core-infra`, `002-auth-service`, `003-user-dashboard`

When creating a new feature, look at existing folders in `.specs/` to determine the next number. The refinery skill handles this automatically.

### Spec Files

| File             | Written by        | Purpose                                   |
|------------------|-------------------|-------------------------------------------|
| requirements.md  | refinery skill    | WHAT needs to be built and WHY            |
| design.md        | foundry agent     | HOW it will be built                      |
| todo.md          | planner agent     | Ordered, file-level implementation tasks  |
| review.md        | code-review skill | Combined findings from all reviewers      |
| reference.md     | librarian agent   | Curated library docs and code examples    |

### Pipeline Stages (always run in order)

1. refinery skill        → .specs/{feature}/{layer}/requirements.md
2. foundry agent         → .specs/{feature}/{layer}/design.md
3. planner agent         → .specs/{feature}/{layer}/todo.md
4. librarian agent       → .specs/{feature}/{layer}/reference.md
5. design-review skill   → pre-build review of design.md (auto-runs as the first step inside mill; can also be invoked manually after librarian)
6. mill skill            → build agent ↔ code-review loop → implementation + review.md
7. commit skill          → Commit, push, and open PR

### Pipeline Rules

- Never write implementation code before `todo.md` exists.
- Always run the librarian agent after the planner and before the mill. The build agent uses `reference.md` for accurate, up-to-date library usage.
- Never produce `design.md` before `requirements.md` status is `Confirmed`.
- Never produce `todo.md` before `design.md` status is `Confirmed`.
- Always read `.specs/PRD.md` at the start of any new feature for product context.
- When a feature spans multiple layers, each layer gets its own spec folder.
- All spec files are committed to git. They are living documents — update them if scope changes.
- The mill skill handles both implementation and review autonomously. It spawns the build agent, runs the code-review skill, and loops until quality criteria are met (up to 3 iterations). Only the final result is presented to the user.
- The mill skill auto-runs the design-review skill once before any build, to catch architectural and scope mistakes against `design.md` before iterations begin. If design-review fails, the user is asked to revise `design.md` (and re-run mill) before any code is written. Design-review is also user-invocable on its own.
- The code-review skill is the sole writer of `review.md`. Individual reviewer agents return structured findings but never write to files directly.
- The code-review skill spawns reviewers selectively based on each reviewer's declared `triggers:` block (`layers`, `testing_modes`, `manifests`, `iterations`, `default`). Not every reviewer runs every iteration — e.g. `staff-reviewer` and `performance-reviewer` only run on iteration 1 and the final pass; `documentation-reviewer` and `dependency-reviewer` defer to the final pass; `dependency-reviewer` also fires earlier if a package manifest changed; `ui-ux-reviewer` only runs on the frontend layer. After iteration 1, reviewers that produced no findings are skipped on subsequent iterations (skip-when-clean). The header of `review.md` records which reviewers ran and why each was skipped.
- The code-review skill can also be run standalone for ad-hoc reviews outside the pipeline.
- Backlog files in `.specs/backlog/` are freeform future feature notes. When the user is ready to start a feature, pass the backlog file as context to the refinery skill. The backlog file can be deleted once `requirements.md` is confirmed.
- After the mill skill finishes implementing a feature and before committing, delete the backlog file for that feature (if one exists). The backlog entry has served its purpose — the spec files are now the source of truth.

### Status Fields

| Status           | Meaning                                                    |
|------------------|------------------------------------------------------------|
| Draft            | Work in progress, not yet confirmed by user                |
| Confirmed        | User has explicitly approved — next stage may begin        |
| Pending          | Todo created, implementation not yet started               |
| In Progress      | Build agent is actively implementing                       |
| Ready for Review | Build agent finished, awaiting code review                 |
| Complete         | Implementation done and review passed — ready for commit   |
| Superseded       | Replaced by a newer version of the spec                    |

---

## Skills & Agents

### Skills (run in current session context)

| Skill            | Invocation                                          | Output                                     |
|------------------|-----------------------------------------------------|--------------------------------------------|
| refinery         | "use the refinery skill on {feature} {layer}"       | .specs/{feature}/{layer}/requirements.md   |
| testing-strategy | Preloaded into foundry agent (not user-invocable)   | Testing Strategy section in design.md      |
| design-review    | "use the design-review skill on {feature} {layer}"  | Inline pre-build review of design.md (no artifact written; auto-runs inside mill) |
| mill             | "use the mill skill on {layer} {feature}"           | Implementation + review.md (build ↔ review loop) |
| code-review      | "use the code-review skill on {feature} {layer}"    | .specs/{feature}/{layer}/review.md         |
| commit           | /commit {layer} {feature}                           | Commit, push, and PR with review gate      |

### Subagents (run in isolated context)

| Agent                    | Invocation                                                    | Output                                  |
|--------------------------|---------------------------------------------------------------|-----------------------------------------|
| foundry                  | "use the foundry agent on {feature}/{layer}"                  | .specs/{feature}/{layer}/design.md      |
| planner                  | "use the planner agent on {feature}/{layer}"                  | .specs/{feature}/{layer}/todo.md        |
| librarian                | "use the librarian agent on {feature}/{layer}"                | .specs/{feature}/{layer}/reference.md   |
| build                    | "use the build agent on {layer}/{feature}" (or via mill skill)| Implementation code + tests             |

> Individual reviewer agents (`*-reviewer.md`) can also be run standalone for ad-hoc reviews outside the pipeline.

---

## Backtracking

The pipeline flows forward, but sometimes you need to go backwards:

| Situation | Action |
|---|---|
| Foundry's design surfaces gaps in requirements | Update `requirements.md`, set status to `Draft`, re-confirm with user, re-run foundry |
| Planner reveals design gaps | Update `design.md`, set status to `Draft`, re-confirm with user, re-run planner |
| design-review skill flags must-fix on `design.md` before build | Update `design.md`, re-confirm, re-run mill (which re-runs design-review automatically) |
| Mill can't converge after 3 iterations | User decides: update design, update requirements, or manual fix |
| Scope changes mid-build | Update the relevant spec files, mark earlier specs as `Superseded` if replaced entirely |

When backtracking, update the affected spec files and re-run from the appropriate stage. Do not attempt to patch forward — go back to the source of the problem.

---

## Engineering Principles

These are non-negotiable. Apply them in every decision — from design docs to individual lines of code.

- **YAGNI (You Aren't Gonna Need It)** — Do not build anything that is not immediately required. No speculative abstractions, no "just in case" parameters, no future-proofing. If it's not in the spec, it doesn't exist.
- **KISS (Keep It Simple, Stupid)** — The simplest solution that works is the correct one. If a junior engineer can't understand it in 30 seconds, it's too clever. Complexity is a liability, not a feature.
- **Written Once, Read 1000 Times** — Code is written once but read 1000 times. Always optimize for the reader, not the writer. When there's a tradeoff between writing convenience and reading clarity, reading wins every time. Names should reveal intent, structure should guide the eye, and logic should flow naturally without requiring the reader to hold a mental stack. If someone has to re-read a block twice to understand it, rewrite it.
- **Goldilocks Code** — Every line must earn its place: not so terse that the reader has to reverse-engineer intent, not so verbose that signal drowns in noise. Context is gold — preserve it for the reader (human or AI) by being clear and obvious. If a comment restates what the code already says, delete it. If removing a line would force the next reader to guess, keep it. Aim for just right: enough detail to understand at a glance, nothing more.
- **DRY (Don't Repeat Yourself)** — Every piece of knowledge should have a single, authoritative source. If you're copying logic, extract it. If you're copying data, reference it. But don't over-abstract — two similar lines are better than one premature helper.
- **API-First** — All backend development starts with the API contract. Define endpoints, request/response shapes, and error codes before writing any implementation. The API is the product.
- **JSON Everywhere** — All inter-service communication, API request/response bodies, and data exchange formats use JSON. No XML, no YAML payloads, no custom wire formats. JSON in, JSON out.
- **Composition Over Inheritance** — Favor small, composable pieces over deep hierarchies. Functions over classes when state isn't needed. Interfaces over base classes.
- **Fail Fast, Fail Loud** — Errors should surface immediately and clearly. No silent swallowing of exceptions, no default fallbacks that mask broken behavior. If something is wrong, make it obvious.
- **Single Responsibility** — Every function, module, and service does one thing well. If you need the word "and" to describe what it does, split it.
- **Lifecycle Hooks** — Design every meaningful input, output, and action as a hookable event. Any operation — creation, mutation, sync, approval, notification — should allow functions to be injected that can observe, transform, or react to it. This enables cross-cutting concerns (audit logging, notifications, validation, external integrations) to be composed without modifying core logic. If something happens in the system, other parts of the system should be able to listen to it or alter it.
- **Async First** — Always prefer asynchronous code handling. Use async/await and non-blocking I/O by default. In Python, use `asyncio` and async-compatible libraries (e.g., `httpx`, `aiohttp`) over synchronous ones (e.g., `requests`). In JavaScript/TypeScript, use Promises and async/await over synchronous or callback-based patterns. Synchronous blocking calls are only acceptable when async is genuinely unavailable.
- **Prove It in CI** — Write code so that if type checks + linting + tests pass, you have near-certainty it works at runtime. Push runtime errors into build-time errors. In Python: `mypy --strict`, exhaustive `match` with `assert_never`, strict Pydantic models at I/O boundaries, and prefer library/framework options that crash loudly on misuse over ones that silently return stale or wrong data (e.g., `expire_on_commit=True`). In TypeScript: `strict: true` with `noUncheckedIndexedAccess`, discriminated unions with exhaustive switch checks, and `satisfies` for type-safe config. The goal: if CI is green, the code works. See: [Parse, Don't Validate](https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/), [Make Illegal States Unrepresentable](https://fsharpforfunandprofit.com/posts/designing-with-types-making-illegal-states-unrepresentable/).

---

## Software Fundamentals (the AI multiplier rule)

AI agents amplify the quality of the codebase they work in. Bad code is more expensive than ever, because it compounds: every additional change in a bad codebase makes the next change harder. Three rules govern every design, plan, and review decision in this repo:

- **Complexity is anything that makes the system hard to understand and modify** (Ousterhout). A change that makes the next change harder is a bad change, even if today's diff looks fine. Software entropy is the default — judge each change against the design of the whole system, not just the diff.
- **The rate of feedback is your speed limit** (Pragmatic Programmer). Never take a step you can't immediately verify. Tasks must be small enough to complete and verify in one TDD cycle; if you can't write a single Given/When/Then to prove a task is done, split it.
- **Prefer deep modules over shallow ones** (Ousterhout). Lots of functionality behind a simple, narrow interface — not many thin modules with leaky internals. Wrappers that only forward calls, services whose public surface mirrors their private collaborators one-for-one, and helpers that expose every internal step are signals that the design has gone shallow.

The reviewer agents (`maintainability-reviewer`, `staff-reviewer`) enforce these at review time. The point of restating them here is to keep them in mind during design and implementation so reviewers have less to flag.

---

## General Coding Rules

- Prefer editing existing files over creating new ones unless clearly warranted.
- Never delete or overwrite files outside of `.specs/` without explicit user confirmation.
- Always use `git mv` when renaming or moving tracked files — never delete and recreate.
- Keep commits atomic — one logical change per commit.
- Do not commit secrets, credentials, or environment-specific values.

## Asking the User Questions

ALWAYS use the `AskUserQuestion` tool when posing a question to the user — never ask via plain text output. This applies to every interactive prompt: clarifications, choices between options, confirmations of scope, picking between approaches, anything that expects a user reply.

- Use `AskUserQuestion` for any question, even single-question prompts.
- Provide structured options whenever the answer space is enumerable (yes/no, A vs B vs C, layer selection, etc.).
- Only fall back to plain-text questions if the `AskUserQuestion` tool is genuinely unavailable in the current environment.

## Driving the running app

When you need to use the app (browser MCP, curl, anything that hits the running stack):

- **Read the active port from `compose.yml` / `compose.override.yml`.** Don't assume — a developer may have changed it. Today the local stack uses Traefik on port `80`, so `http://localhost/` (from your shell) and `http://host.docker.internal/` (from the browser MCP container) are the entrypoints. `/api/*` routes to the backend; everything else routes to the frontend SPA.
- **Default credentials are in `.env.example`.** For agent-driven UI flows, try `FIRST_SUPERUSER` / `FIRST_SUPERUSER_PASSWORD` from `.env.example` first before asking the user. This is a standing authorization for browser MCP login.
- **One origin, no CORS, no `localhost:8000` rewrites.** The frontend bundle is built with `VITE_API_URL=` (empty) → relative URLs. Any browser context that can reach the Traefik port works without configuration.

---

## Common Commands

### Git

git status && git diff
git add <files>
git commit -m "<type>(<scope>): <short description>"
git push origin <branch>
