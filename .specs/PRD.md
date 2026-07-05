# PRD: xero-mcp — Org Fork Charter

| Field   | Value                                  |
|---------|----------------------------------------|
| Owner   | Llewellyn Strydom (CTO)                |
| Status  | Active                                 |
| Date    | 2026-07-05                             |
| Scope   | The fork itself — not the underlying Xero MCP product |

---

## 1. Problem

[`XeroAPI/xero-mcp-server`](https://github.com/XeroAPI/xero-mcp-server) is a solid base: it speaks MCP over stdio, wraps the official `xero-node` SDK, and ships ~70 tools across `list / create / update / delete / get`. We want to use it inside our organisation. But "use it" means three things the upstream project does not fully solve for our context:

1. **Security posture.** Upstream is permissive about scopes (sensible defaults for a generic install, but broader than we need per environment), trusts the operator to handle secrets correctly, and has no audit trail of tool invocations. We need finer control over what scopes get requested, how secrets and bearer tokens are sourced/rotated, and what record we keep of tool use.
2. **Deployment.** Upstream ships as an npm package consumed via `npx`. That model fits individual users; it does not fit our team workflow (shared image, pinned versions, controlled rollout, predictable runtime env).
3. **Upstream tracking.** We want upstream's bug fixes and new tools without continually re-doing our local work. The fork needs a sustainable merge cadence and a clear rule for "is this change ours or theirs."

## 2. Solution

A long-lived fork with a narrow, deliberately additive purpose:

- **Track upstream.** Pull in every upstream release. Conflicts resolve in favour of upstream unless they touch a deliberate org-specific seam.
- **Layer in org-specific improvements.** Each improvement is its own small feature, scoped to `security`, `deployment`, or `upstream-tracking`.
- **Never modify the public MCP tool contract.** Tools, parameter schemas, and Xero API resource coverage are upstream's job. Changes there belong as PRs to upstream, not divergent code here. (If we ever need to *temporarily* diverge — e.g. to scope-gate or wrap an existing tool — that wrap stays cleanly isolated so it can be removed when upstream supports it natively.)

## 3. Users & Roles

| Role                       | Permissions                                                                | Notes                                                       |
|----------------------------|----------------------------------------------------------------------------|-------------------------------------------------------------|
| Internal developer         | Run the MCP server locally (stdio) or reach the hosted HTTP endpoint via claude.ai; Xero auth is Refresh Token mode | Local: dev `claude_desktop_config.json`. Remote: Entra ID login |
| Internal AI assistant      | Invoke tools via MCP                                                       | Inherits the developer's Xero scope                         |
| Fork maintainer (Llewellyn) | All of the above; merges upstream; cuts releases; sets org-wide defaults  | One person in v0                                            |

No external users — remote access is gated by Entra ID and limited to our team. The server is reachable remotely (a hosted HTTP endpoint for claude.ai) alongside local stdio use, but is not open to the public. No multi-tenant onboarding flow.

## 4. In Scope

Broad strokes only — concrete decisions belong in per-feature `requirements.md` once a feature is on the table. The themes we anticipate working on:

### 4.1 Security improvements

- Tighter, env-specific scope minimisation (run-time enforcement that the configured `XERO_SCOPES` is the *minimum* needed for the tools we expose, not the union of all upstream defaults).
- Org-friendly secret sourcing (e.g. read from a vault / cloud secret manager rather than `.env`).
- Optional restriction of the exposed tool surface (some tools may be too privileged for some environments).
- Audit logging of tool invocations: who, when, which tool, which tenant, success/failure.

### 4.2 Deployment improvements

- Container image (Dockerfile + base image we control) with non-root runtime and reproducible builds.
- Pinned dependency posture (`npm ci`, lockfile gates in CI).
- Release flow: tag → image build → publish to our registry (no manual `npm publish` to the public registry).
- Runtime config: env-driven, with explicit validation and fail-loud startup behaviour.

### 4.3 Upstream-tracking workflow

- Defined upstream remote and merge cadence (documented in `.specs/REPO.md` § Upstream Sync).
- CI gate that ensures upstream merges don't break our build before they land on `main`.
- A short rule of thumb for "should this go upstream as a PR" vs "should this stay in the fork."

## 5. Out of Scope

- **New Xero API integrations** that should serve every Xero MCP user — those are upstream's responsibility. Open a PR against `XeroAPI/xero-mcp-server`, not a feature here.
- **Bug fixes to upstream tools** — same rule: PR upstream. We may carry a short-lived patch locally if upstream is slow, but only with an open upstream PR backing it.
- **Rewriting the handler-per-resource pattern, swapping the `xero-node` SDK, changing the MCP transport** — anything that would create hard divergence and make every upstream merge painful.
- **A web UI, admin console, or REST API** — this is an MCP server, exposing MCP over stdio (local) and Streamable HTTP (remote). Nothing beyond the MCP surface.
- **Multi-tenant SaaS hosting** — out of scope; the fork is for our own team's use.

## 6. Design Principles (Non-Negotiable)

A subset of CLAUDE.md's engineering principles that genuinely bind decisions in *this* repo. Apply them in every feature.

- **YAGNI.** Build only what the current feature requires. The fork's whole point is being thin.
- **KISS.** Simplest solution that works. Complexity is a liability when every upstream merge has to drag it forward.
- **Goldilocks code & Written Once, Read 1000 Times.** Optimise for the reader (human or AI). The fork has to be obvious to someone landing in it months later.
- **Fail Fast, Fail Loud.** Startup errors crash immediately with a clear message (see `xero-client.ts` line 19–21 for the existing pattern — match it).
- **Async First.** All I/O — Xero API calls, secret fetches, anything else — is async. This is already the upstream pattern; preserve it.
- **Stay close to upstream.** Every diff that's not "obviously ours" is a cost we pay on every merge. When in doubt, send the change upstream first.
- **Configuration over code.** Anything that varies between environments (scopes, secret sources, tool surface, log destinations) is configuration, not branching logic in source files.

## 7. Features

- **001-oauth2-web-app-auth** (backend) — Replace Custom Connection + Bearer Token auth with a single Refresh Token mode that works with Xero Web Applications (available to all regions).
- **002-http-transport-and-oauth** (backend, infra) — Add a Streamable HTTP entry point with Entra ID OAuth (DCR + Redis-backed clients store) alongside the existing stdio entry, and the container/compose/Helm artefacts to deploy it. All new source under `src/http/` so upstream merges stay clean.
- **003-oauth-proxy-bridge** (backend) — Replace the dumb-forward `ProxyOAuthServerProvider` with an OAuth-proxy *bridge* that terminates the Entra login at the server's own fixed `/auth/callback`, so every MCP client type (Claude Code/local loopback, claude.ai/Desktop web) authenticates uniformly — mirroring `cin7-mcp`. Enables private dev testing in Claude Code + prod via claude.ai.

---

## 8. Upstream-vs-Fork Decision Rule

When you're about to write code, ask: *would this change be valuable to every Xero MCP user, or only to us?*

| Type of change                                                        | Where it lives          |
|-----------------------------------------------------------------------|-------------------------|
| New Xero API integration (e.g. new endpoint, new tool)                | Upstream PR             |
| Bug fix to an existing tool's behaviour                               | Upstream PR             |
| Performance / refactor of upstream code that benefits everyone        | Upstream PR             |
| Vault-based secret sourcing tied to our infra                         | Fork (`infra` layer)    |
| Docker image with our base, registry, and policies                    | Fork (`infra` layer)    |
| Release pipeline targeting our private registry                       | Fork (`ci-cd` layer)    |
| Audit logging to our log sink                                         | Fork (`backend` layer, wired via a configurable hook) |
| Run-time enforcement of scope minimisation against the tool surface   | Fork (`backend` layer)  |

When unsure, default to upstream PR. Easier to land in two places than to live with permanent divergence.
