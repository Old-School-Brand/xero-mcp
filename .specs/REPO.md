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
| MCP          | `@modelcontextprotocol/sdk` ^1.23.4 (stdio transport)                      |
| Xero SDK     | `xero-node` ^13.3.0                                                        |
| Auth         | Refresh Token mode via axios (refresh token exchange, token file persistence, proactive renewal) |
| Validation   | `zod` 3.25                                                                 |
| Env          | `dotenv` ^16.4.7                                                           |
| Linting      | ESLint 9 (`@eslint/js` + `typescript-eslint`)                              |
| Formatting   | Prettier 3.7 (via `eslint-config-prettier/flat`)                           |
| Type check   | `tsc` (part of `npm run build`)                                            |
| Package mgr  | `npm` (lockfile: `package-lock.json`)                                      |
| Testing      | Vitest 4.x (`vitest run`)                                                  |
| CI/CD        | None yet — `infra` / `ci-cd` layers are where this work will land          |

---

## Project Layout

```
xero-mcp/
├── src/
│   ├── index.ts                  # Entry point — wires StdioServerTransport, calls ToolFactory
│   ├── server/
│   │   └── xero-mcp-server.ts    # Singleton McpServer wrapper
│   ├── clients/
│   │   └── xero-client.ts        # RefreshTokenXeroClient — refresh token exchange, token file persistence, proactive renewal
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
│   └── consts/                   # Constants used across handlers
│
├── dist/                         # Compiled output (committed because the package's bin points at it)
├── examples/                     # Example client configs and usage snippets
│
├── package.json                  # Deps + npm scripts; "type": "module"; "bin": "./dist/index.js"
├── package-lock.json
├── tsconfig.json                 # strict ES2022 / Node16 ESM
├── eslint.config.js              # Flat config: @eslint/js + typescript-eslint + prettier
├── .prettierrc
├── .env.example                  # XERO_CLIENT_ID / XERO_CLIENT_SECRET / XERO_REFRESH_TOKEN template
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
| ci-cd    | GitHub Actions, release/publish workflows, image scans, version bumps (no files yet — folder is reserved) |
| infra    | Dockerfile, deployment artefacts, runtime config (env handling, scope minimisation, secret sourcing) (no files yet — folder is reserved) |

> Most of the existing codebase lives in the `backend` layer. `ci-cd` and `infra` are reserved homes for the org-specific improvements named in `.specs/PRD.md`.

---

## Development Environment

| Item              | Location / Value                                                                |
|-------------------|---------------------------------------------------------------------------------|
| Package config    | `package.json`                                                                  |
| Lockfile          | `package-lock.json`                                                             |
| Compiled output   | `dist/` (committed; `package.json` "bin" points at `dist/index.js`)             |
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

**Refresh Token mode:** At startup the server exchanges the refresh token for an access token, persists the rotated refresh token to the token file with `0600` permissions, then schedules proactive renewal at `expires_in - 300` seconds. All ~52 handlers call `await xeroClient.authenticate()` which is a no-op after the initial startup exchange.

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
| Run tests           | `npx vitest run src/__tests__/clients/xero-client.test.ts`          | repo root    |
| Run all tests       | `npx vitest run`                                                     | repo root    |

There is no `npm run start` — see [Driving the running MCP server](#driving-the-running-mcp-server) for how to launch.

### Driving the running MCP server

Because MCP servers communicate over stdio, "running" the server means handing its stdin/stdout to an MCP client. There is no port, no browser, no HTTP — verification is done through an MCP client that speaks the protocol.

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

**Verifying a change.** Type checking + linting only confirm code correctness. To verify a tool actually does what it should:

- Build (`npm run build`)
- Restart the MCP client (Inspector or Claude Desktop)
- Invoke the affected tool with realistic inputs
- Confirm the response matches expectations and that no error surfaces in stderr / Claude logs

For Xero-side verification, use a Xero Demo Company (top-left dropdown in Xero web app → "Demo Company"; reset data any time via My Xero) so test mutations don't touch real org data.

---

## Upstream Sync

The upstream repository is [`XeroAPI/xero-mcp-server`](https://github.com/XeroAPI/xero-mcp-server). The fork tracks `main` upstream. Sync workflow (to be formalised under the `ci-cd` layer when it lands):

1. Add upstream remote once: `git remote add upstream https://github.com/XeroAPI/xero-mcp-server.git`.
2. Periodically: `git fetch upstream && git merge upstream/main`.
3. Resolve conflicts in favour of upstream unless they touch a deliberate org-specific change (those should be small and localised).
4. Re-run `npm run build && npm run lint` after merge.
5. Bump our internal version if we ship a release-worthy change.

Per `.specs/PRD.md`: changes that *should* live upstream (new Xero API integrations, fixes to existing tools, etc.) belong as PRs to `XeroAPI/xero-mcp-server`, not in this fork. The fork is for things that are genuinely org-specific.

---

## Repo Conventions

### TypeScript

- All sources live under `src/`. Compiled output goes to `dist/` and is committed (the npm package's `bin` field points at `dist/index.js`).
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
