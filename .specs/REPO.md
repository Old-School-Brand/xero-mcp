# REPO.md — xero-mcp

## What This Repo Does

A Model Context Protocol (MCP) server that bridges MCP-aware clients (Claude Desktop, IDEs, custom agents) and the Xero accounting/payroll API. Exposes ~70 tools across `list / create / update / delete / get` covering contacts, invoices, payments, bank transactions, credit notes, quotes, items, manual journals, tracking categories, payroll timesheets, leave management, and reports (P&L, balance sheet, trial balance, aged receivables/payables).

See `.specs/PRD.md` for the fork's charter.

> **Origin & maintenance posture.** This is a fork of [`XeroAPI/xero-mcp-server`](https://github.com/XeroAPI/xero-mcp-server). The base project — code style, build toolchain, handler-per-resource layout, scope handling — was authored upstream. We track upstream and layer in **org-specific security and deployment improvements** on top. Anything that should land in every Xero MCP install goes upstream; anything specific to how we run it for our team lives here. The upstream remote and merge cadence are documented under [Upstream Sync](#upstream-sync) below.

---

## Tech Stack

| Layer        | Technology                                                                 |
|--------------|----------------------------------------------------------------------------|
| Runtime      | Node.js v18+                                                               |
| Language     | TypeScript 5.9 (`strict: true`, target ES2022, module Node16, ESM)         |
| MCP          | `@modelcontextprotocol/sdk` ^1.23.4 (stdio transport + Streamable HTTP transport) |
| Xero SDK     | `xero-node` ^13.3.0                                                        |
| Auth (Xero)  | Refresh Token mode via axios (refresh token exchange; token store persistence — `file` default or `redis` via `XERO_TOKEN_STORE`; proactive renewal) |
| Auth (MCP HTTP) | Entra ID OAuth via `jose` (JWT verification) + an OAuth-proxy bridge (`EntraBridgeProvider`, a subclass of the SDK's `ProxyOAuthServerProvider`) that terminates the Entra login at the server's own fixed `{MCP_SERVER_URL}/auth/callback` so every MCP client type authenticates uniformly. Local-dev: static bearer. See ADR-0002 (transport/local-auth) and ADR-0004 (OAuth handshake model, supersedes ADR-0002 decision 2). |
| HTTP         | `express` — app shell for the HTTP entry point (`src/http/server.ts`)      |
| Cache/Store  | `redis` v4 (node-redis) — DCR client storage + health probes. See ADR-0003. |
| Logging      | `pino` + `pino-http` — structured JSON logging for the HTTP entry          |
| Validation   | `zod` 3.25                                                                 |
| Env          | `dotenv` ^16.4.7                                                           |
| Linting      | ESLint 9 (`@eslint/js` + `typescript-eslint`)                              |
| Formatting   | Prettier 3.7 (via `eslint-config-prettier/flat`)                           |
| Type check   | `tsc` (part of `npm run build`)                                            |
| Package mgr  | `npm` (lockfile: `package-lock.json`)                                      |
| Testing      | Vitest 4.x (`vitest run`)                                                  |
| CI/CD        | GitHub Actions (`.github/workflows/`): PR gate, build-publish on `main` (image + Helm chart → Azure Container Registry), tag-triggered release, plus Claude review bots. See [CI/CD & Release](#cicd--release). |

---

## Project Layout

```
xero-mcp/
├── src/
│   ├── index.ts                  # Stdio entry point — wires StdioServerTransport, calls ToolFactory
│   ├── server/
│   │   └── xero-mcp-server.ts    # Singleton McpServer wrapper (used by stdio entry only)
│   ├── clients/
│   │   └── xero-client.ts        # RefreshTokenXeroClient — refresh token exchange, token store persistence (file or redis via XERO_TOKEN_STORE), proactive renewal
│   ├── handlers/                 # One handler file per Xero API operation (~53 files)
│   │   ├── create-xero-*.handler.ts
│   │   ├── list-xero-*.handler.ts
│   │   ├── update-xero-*.handler.ts
│   │   └── ...
│   ├── tools/                    # Tool definitions registered with the McpServer
│   │   ├── tool-factory.ts       # Wires every tool into the server
│   │   ├── create/               # 12 create-* tools
│   │   ├── list/                 # 26 list-* tools
│   │   ├── update/               # 14 update-* tools
│   │   ├── delete/               # 2 delete-* tools
│   │   └── get/                  # 1 get-* tool
│   ├── helpers/                  # Shared utilities (error formatting, line-item parsing, tracking options, deeplinks, etc.)
│   ├── types/                    # ToolDefinition, ToolResponse, ToolList, Timeframe, etc.
│   ├── consts/                   # Constants used across handlers
│   ├── http/                     # OSB HTTP entry point and auth (org-specific; never modify upstream files)
│   │   ├── server.ts             # HTTP entry point — Express bootstrap + session router
│   │   ├── settings.ts           # Zod schema for HTTP-mode env vars
│   │   ├── sessions.ts           # Per-session transport + McpServer lifecycle
│   │   ├── health.ts             # /livez and /readyz endpoints
│   │   ├── logging.ts            # Pino logger + pino-http middleware factory
│   │   └── auth/                 # Auth provider factory + verifiers + DCR/txn/code stores
│   │       ├── build.ts          # Provider factory: local vs Entra (OAuth-proxy bridge) branch
│   │       ├── local-verifier.ts # Static bearer verifier (ENVIRONMENT=local)
│   │       ├── entra-verifier.ts # Entra JWT verifier via jose
│   │       ├── redis-clients-store.ts  # OAuthRegisteredClientsStore on Redis
│   │       ├── bridge-provider.ts      # EntraBridgeProvider — OAuth-proxy bridge (ADR-0004)
│   │       ├── redis-code-store.ts     # Redis-backed txn/server-code store for the bridge
│   │       └── callback-handler.ts     # GET /auth/callback — exchanges the Entra code, bridges to client
│   └── __tests__/                # Test suites
│       ├── clients/
│       │   └── xero-client.test.ts
│       └── http/                 # Tests for the HTTP entry (mirrors src/http/ structure)
│
├── dist/                         # Compiled output — NOT committed (.gitignored); built by `tsc`, produced fresh in the Docker image / on npm publish
├── examples/                     # Example client configs and usage snippets
│
├── package.json                  # Deps + npm scripts; "type": "module"; bin: stdio + HTTP entries
├── package-lock.json
├── tsconfig.json                 # strict ES2022 / Node16 ESM
├── eslint.config.js              # Flat config: @eslint/js + typescript-eslint + prettier
├── .prettierrc
├── .env.example                  # Xero creds + OSB HTTP-mode vars
├── Dockerfile                    # Multi-stage container image (builder: node:22-bookworm-slim; runtime: node:22-bookworm-slim, UID 10001)
├── .dockerignore                 # Build context exclusions (node_modules, dist, .specs, .env*, etc.)
├── compose.yml                   # Docker Compose stack: backend + Valkey (production-like defaults)
├── compose.override.yml          # Local-dev overrides: port 8000, bind-mount for token file, watch rebuild
├── charts/xero-mcp/              # Helm chart for Kubernetes deployment (Deployment, Service, Ingress)
├── start-server.sh               # Local-dev convenience: `npx tsc && node dist/index.js`
├── glama.json                    # Glama MCP registry metadata
├── README.md                     # User-facing: setup, auth modes, available tools
├── CLAUDE.md                     # Generic Claude Code workflow guidance (template — same in all our projects)
└── .specs/                       # Spec-driven development artefacts (project-tailored)
    ├── REPO.md                   # This file
    ├── PRD.md                    # Fork charter
    ├── GLOSSARY.md               # MCP/Xero vocabulary
    ├── adr/                      # Architecture Decision Records
    ├── backlog/                  # Future feature notes
    └── {NNN-feature-name}/{layer}/ # Per-feature spec folders
```

---

## Active Spec Layers

| Layer    | Purpose                                                                                            |
|----------|----------------------------------------------------------------------------------------------------|
| backend  | TypeScript MCP server source (`src/`) — handlers, tools, `ToolFactory` registration, `XeroClient` wrapping, helpers, types |
| ci-cd    | GitHub Actions in `.github/workflows/`: PR gate, build-publish on `main`, tag-triggered release, reusable test/lint jobs, and Claude review bots. Chart-version helper in `scripts/update-chart-versions.sh`. See [CI/CD & Release](#cicd--release). |
| infra    | Dockerfile, Docker Compose stack (`compose.yml` + `compose.override.yml`), Helm chart (`charts/xero-mcp/`), and the conditional Redis token store (`XERO_TOKEN_STORE`) in `xero-client.ts` |

> Most of the existing codebase lives in the `backend` layer. `ci-cd` and `infra` hold the org-specific deployment and pipeline improvements named in `.specs/PRD.md`.

---

## Development Environment

| Item              | Location / Value                                                                |
|-------------------|---------------------------------------------------------------------------------|
| Package config    | `package.json`                                                                  |
| Lockfile          | `package-lock.json`                                                             |
| Compiled output   | `dist/` — **not committed** (`.gitignored`); built by `tsc` (`npm run build`), produced fresh in the Docker image and on npm publish. `package.json` "bin" points at `dist/index.js`. |
| Node version      | 18+ (Node 22 LTS recommended)                                                   |
| Module type       | ESM (`"type": "module"`)                                                        |
| Env file          | `.env` (gitignored) — copy from `.env.example`                                  |

### Required env vars

| Variable              | Purpose                                                                              |
|-----------------------|--------------------------------------------------------------------------------------|
| `XERO_CLIENT_ID`      | Xero app client ID                                                                   |
| `XERO_CLIENT_SECRET`  | Xero app client secret                                                               |
| `XERO_REFRESH_TOKEN`  | Refresh token seed (used on first run if token file is absent; rotated thereafter)  |
| `XERO_TOKEN_FILE`     | Optional. Path to the persisted refresh token file. Defaults to `~/.xero-mcp/refresh_token` |
| `XERO_TOKEN_STORE`    | Optional. Token store backend: `file` (default, local/stdio) or `redis` (deployed/HTTP). |
| `XERO_TOKEN_REDIS_KEY` | Optional. Redis key name for the refresh token when `XERO_TOKEN_STORE=redis`. Default: `xero:refresh_token`. |

**Refresh Token mode:** At startup the server exchanges the refresh token for an access token, persists the rotated refresh token via the configured **token store** (default `file`, `0600` permissions; `redis` when `XERO_TOKEN_STORE=redis`, used by the deployed HTTP mode), then schedules proactive renewal at `expires_in - 300` seconds. The stdio entry defaults to `file` mode and needs no Redis. All ~52 handlers call `await xeroClient.authenticate()` which is a no-op after the initial startup exchange.

### HTTP-mode env vars (additional)

When running the HTTP entry (`dist/http/server.js`), additional variables are required. See `.env.example` for the full list with comments. Key additions: `ENVIRONMENT`, `DEV_BEARER_TOKEN`, `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `MCP_SERVER_URL`, `ENTRA_REQUIRED_SCOPES`, `REDIS_URL`.

---

## Canonical Commands

> **Rule of thumb:** every Node command uses `npm` or `npx` from the repo root. There is no `bun`/`pnpm`/`yarn` in this project. Compiled output is `dist/index.js`; the server is run with `node dist/index.js` over stdio.

### Package Management

| Task                | Command                       | Where to run |
|---------------------|-------------------------------|--------------|
| Install deps        | `npm install`                 | repo root    |
| Install (CI, clean) | `npm ci`                      | repo root    |
| Add dep             | `npm install <package>`       | repo root    |
| Add dev dep         | `npm install -D <package>`    | repo root    |

### Build & Lint

| Task                       | Command                | Where to run |
|----------------------------|------------------------|--------------|
| Build (tsc + chmod bin)    | `npm run build`        | repo root    |
| Watch (incremental tsc)    | `npm run watch`        | repo root    |
| Lint (check)               | `npm run lint`         | repo root    |
| Lint (fix)                 | `npm run lint:fix`     | repo root    |

### Testing

| Task                | Command                                                              | Where to run |
|---------------------|----------------------------------------------------------------------|--------------|
| Run all tests       | `npm run test` (= `vitest run`)                                      | repo root    |
| Run with coverage   | `npm run test:coverage` (= `vitest run --coverage`)                  | repo root    |
| Run a single file   | `npx vitest run src/__tests__/clients/xero-client.test.ts`           | repo root    |
| Run HTTP tests      | `npx vitest run src/__tests__/http/`                                 | repo root    |

There is no `npm run start` — see [Driving the running MCP server](#driving-the-running-mcp-server) for how to launch.

### Driving the running MCP server

**Stdio mode** — the upstream default. MCP over stdio; one process per user.

**1. Local launch (manual)**

```bash
npm run build
node dist/index.js
```

The process will start and block on stdin. It is meant to be piped to from an MCP client; running it bare is only useful as a "does it boot" smoke check.

A convenience wrapper exists in `start-server.sh` (`npx tsc && node dist/index.js`).

**2. Driving from Claude Desktop (preferred dev flow)**

Add a dev entry to `claude_desktop_config.json` pointing at the local build:

```json
{
  "mcpServers": {
    "xero-dev": {
      "command": "node",
      "args": ["/absolute/path/to/xero-mcp/dist/index.js"],
      "env": {
        "XERO_CLIENT_ID": "...",
        "XERO_CLIENT_SECRET": "...",
        "XERO_REFRESH_TOKEN": "..."
      }
    }
  }
}
```

Restart Claude Desktop. Inspect logs at `~/Library/Logs/Claude/mcp-server-xero-dev.log` (macOS). After every change run `npm run build` and restart Claude Desktop to pick up the new `dist/index.js`.

**3. Driving from the MCP Inspector (faster iteration loop)**

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

Opens a local web UI for listing tools, invoking them with parameter forms, and seeing raw request/response JSON. Faster than Claude Desktop for quick "does this tool work" checks.

**HTTP mode** — the org-specific entry point. MCP over Streamable HTTP with bearer auth.

**4. HTTP local-dev launch**

```bash
npm run build
ENVIRONMENT=local DEV_BEARER_TOKEN=test XERO_CLIENT_ID=... XERO_CLIENT_SECRET=... XERO_REFRESH_TOKEN=... node dist/http/server.js
```

Or via the script: `npm run start:http` (requires env vars in `.env`).

Verify: `curl -fsS http://localhost:8000/livez` should return `{"status":"ok"}`.

**5. Local Docker stack**

```bash
# One-shot boot (requires .env with Xero credentials)
docker compose up --build

# Smoke check
curl -fsS http://localhost:8000/livez

# Tear down
docker compose down
```

The stack runs `backend` (the HTTP entry point) + `valkey` (Redis-compatible, used for DCR OAuth state). The compose override publishes port 8000 and bind-mounts `.xero-mcp/` so the file-mode token survives restarts. `ENVIRONMENT=local` and `REDIS_URL` are pre-set; add Xero credentials to `.env` (copy from `.env.example`).

**Verifying a change.** Type checking + linting only confirm code correctness. To verify a tool actually does what it should:

- Build (`npm run build`)
- Restart the MCP client (Inspector or Claude Desktop)
- Invoke the affected tool with realistic inputs
- Confirm the response matches expectations and that no error surfaces in stderr / Claude logs

For Xero-side verification, use a Xero Demo Company (top-left dropdown in Xero web app → "Demo Company"; reset data any time via My Xero) so test mutations don't touch real org data.

---

## CI/CD & Release

GitHub Actions live in `.github/workflows/`. The pipeline **publishes artifacts to Azure Container Registry (ACR)** — it does **not** deploy to a running cluster; the rollout to the tailnet instances happens outside this repo (GitOps / manual `helm upgrade` against the OCI chart). Confirm that mechanism with whoever owns the cluster.

| Workflow | Trigger | What it does |
|----------|---------|--------------|
| `pr-gate.yml` | PR opened/synchronized | Reusable `test-backend`, `test-docker-compose`, `lint-helm`, plus a Trivy CRITICAL/HIGH scan (fails the PR). This is the automated gate on every PR. |
| `build-publish.yml` | push to `main` | Re-runs the gate, builds `xero-mcp/backend:sha-<shortsha>`, Trivy-scans (report-only), pushes the image + a dev-versioned Helm chart (`0.0.0-<ts>.sha.<sha>`) to ACR. |
| `release.yml` | push tag `vX.Y.Z` | **Verifies the `sha-<sha>` image already exists in ACR** (so tag *after* the main build), retags it to the SemVer, pushes the SemVer Helm chart, and cuts a GitHub Release. |
| `claude.yml`, `claude-code-review.yml` | PR / mention | Claude review bots. |

Helper: `scripts/update-chart-versions.sh <chart_version> <image_tag>` stamps the chart/image versions before packaging.

### Testing a change end-to-end (given the Xero refresh-token constraint)

Xero **rotates the refresh token on every exchange**, so a local instance and the deployed instance cannot both run off the same Xero app connection — whichever refreshes last invalidates the other's token. Practical consequences:

1. **Unit tests need no token** — `npm run test` deterministically covers pure logic (formatters, helpers). Run these first; the PR gate runs them too.
2. **For live/end-to-end checks, use the deployed instance**, which holds its own rotated token (Redis-backed). Do not point a local build at the production Xero connection.
3. **Local live testing** is only safe against a *separate* Xero app/connection (its own client id/secret + refresh token, e.g. a Demo Company), so it can't clash with the deployed token.

**Release/test flow used in practice:**

1. Merge the PR to `main` → `build-publish` puts a `sha-<sha>` image + dev chart in ACR.
2. Roll the **dev instance** to that chart (via the external deploy mechanism), then exercise the change in Claude Code against the dev instance's HTTP/Entra endpoint (own token → no clash).
3. Once confirmed, push a `vX.Y.Z` tag → `release` promotes the same image to the SemVer and cuts a release; roll the **prod instance** to the SemVer. Claude Desktop / claude.ai prod users then talk to the updated prod endpoint (the tag promotes the image; it does not itself push anything to clients).

---

## Upstream Sync

The upstream repository is [`XeroAPI/xero-mcp-server`](https://github.com/XeroAPI/xero-mcp-server). The fork tracks `main` upstream. Sync workflow:

1. Add upstream remote once: `git remote add upstream https://github.com/XeroAPI/xero-mcp-server.git`.
2. Periodically: `git fetch upstream && git merge upstream/main`.
3. Resolve conflicts in favour of upstream unless they touch a deliberate org-specific change (those should be small and localised).
4. Re-run `npm run build && npm run lint` after merge.
5. Bump our internal version if we ship a release-worthy change.

Per `.specs/PRD.md`: changes that *should* live upstream (new Xero API integrations, fixes to existing tools, etc.) belong as PRs to `XeroAPI/xero-mcp-server`, not in this fork. The fork is for things that are genuinely org-specific.

> **Upstream-isolation convention.** OSB-specific additions live under `src/http/` (and any future `src/{feature}/` subdirectories). Never modify upstream-owned files in `src/` (e.g. `index.ts`, `clients/`, `handlers/`, `tools/`, `server/`, `helpers/`, `types/`, `consts/`). Verify with: `git diff upstream/main -- src/ ':!src/http'` — should show zero changes. `package.json` and `.env.example` receive additive-only edits. See ADR-0002 for rationale.
>
> **Known exception (feature 004-response-formatting-fixes).** Response-rendering bug fixes were applied *locally* to upstream-owned formatters (`src/helpers/format-line-item.ts`, the new `src/helpers/format-date.ts`, deleted `src/helpers/get-external-link.ts`, and ~30 `src/tools/**` files) — an owner-approved deviation accepting the merge cost, because the fixes were needed before upstream could land them. As a result, `git diff upstream/main -- src/ ':!src/http'` is **no longer empty**, and these files may conflict on the next upstream merge (resolve in favour of keeping the fixes until upstream carries equivalents). All *other* features must still honour the zero-change invariant.
>
> **Known exception (feature 005-xero-usability).** A second, deliberate deviation: pagination fixes were applied *locally* to upstream-owned `src/handlers/` and `src/tools/` — an owner-approved deviation accepting the merge cost, following the feature 004 precedent. Affected files: the `pageSize` bump (10 to 100) plus pagination-hint messaging in the five existing transaction handler/tool pairs — `list-xero-invoices`, `list-xero-manual-journals`, `list-xero-bank-transactions`, `list-xero-credit-notes`, `list-xero-payments` (handler + tool file each) — and the new shared helper `src/helpers/pagination-hint.ts`. The `offline_access` scope fix (workstream C) stayed entirely within `src/http/` and required **no** exception. `git diff upstream/main -- src/ ':!src/http'` remains non-empty for this additional, named reason on top of feature 004's.
>
> **Reverted from 005 (workstream A — GL tool).** The `list-account-transactions` tool over Xero's Journals endpoint (new handler + tool + `index.ts` wiring) was implemented, merged, then **reverted** — the Journals endpoint requires Xero's Advanced developer-app plan, which we do not have and do not plan to purchase, so the tool returned 403. This is a permanent known limitation (see `.specs/PRD.md` §5 Out of Scope), not a deferred item.

---

## Repo Conventions

### TypeScript

- All sources live under `src/`. Compiled output goes to `dist/`, which is **`.gitignored` (not committed)** — it is built by `tsc` (`npm run build`) and produced fresh in the Docker image and on npm publish. The npm package's `bin` field points at `dist/index.js`.
- Module system is ESM throughout. Relative imports include the `.js` extension (Node16 module resolution requirement) — e.g. `import { XeroMcpServer } from "./server/xero-mcp-server.js";` even though the source file is `.ts`.
- `tsconfig.json` enables `strict: true`, `esModuleInterop: true`, `forceConsistentCasingInFileNames: true`. Honour these — don't disable strict mode.
- One handler per Xero API operation under `src/handlers/`. Naming: `{verb}-xero-{resource}[.payroll].handler.ts`. Match this pattern when adding handlers.
- Tools live under `src/tools/{create,list,update,delete,get}/` and are registered in `src/tools/tool-factory.ts`. Adding a tool means adding both the handler and the tool definition, then wiring it into `ToolFactory`.
- Validation is `zod` schemas at the tool boundary. Internal types live under `src/types/`.

### Environment

- `.env` is gitignored — never commit secrets, never check in `.env`.
- `.env.example` is the source of truth for required variable names.
- Secrets are loaded once by `dotenv.config()` in `src/clients/xero-client.ts`.
- The client throws at startup if either `XERO_CLIENT_ID` or `XERO_CLIENT_SECRET` is missing — fail-loud is intentional.

### Linting & formatting

- `npm run lint` runs ESLint with the flat config in `eslint.config.js` (extends `@eslint/js` recommended + `typescript-eslint` recommended + Prettier).
- `dist/` is ignored.
- There is no pre-commit hook framework in the upstream repo. If we add one, it goes under `infra` / `ci-cd`.

---

## Commands That Should NEVER Be Used

| Wrong                              | Why                                                              | Correct                                |
|------------------------------------|------------------------------------------------------------------|----------------------------------------|
| `yarn install` / `yarn run`        | npm is the package manager (lockfile is `package-lock.json`)     | `npm install` / `npm run`              |
| `pnpm install`                     | Same as above                                                    | `npm install`                          |
| `bun install` / `bun run`          | Same as above                                                    | `npm install` / `npm run`              |
| `tsx src/index.ts`                 | We run the compiled build, not source                            | `npm run build && node dist/index.js`  |
| `npm run start`                    | No such script — the server starts via stdio from an MCP client  | See [Driving the running MCP server](#driving-the-running-mcp-server) |
| Editing files under `dist/`        | `dist/` is regenerated by `tsc`; manual edits are silently lost  | Edit `src/`, then `npm run build`      |
