# Todo: OAuth2 Web App Auth Flow
**Layer:** backend
**Status:** In Progress
**Last updated:** 2026-05-24

## Implementation Tasks

Tasks are ordered. Do not start a task until its dependencies are complete.

### Phase 1: Foundation

- [x] **Task 1.1** — Install Vitest and add axios as a direct dependency
  - File(s): `package.json`, `package-lock.json`
  - What to do: Run `npm install -D vitest @vitest/coverage-v8` to add the test framework. Run `npm install axios` to make axios a direct dependency (it is currently only a transitive dep of `xero-node`, but the new code expands its use to a first-class role — making it direct prevents silent breakage if `xero-node` ever removes it). Add a `"test"` script to `package.json`: `"test": "vitest run"` and a `"test:coverage"` script: `"test:coverage": "vitest run --coverage"`.
  - Acceptance: `npm run test` resolves without "vitest not found" error (even if no test files exist yet). `axios` appears in `dependencies` in `package.json`. `npm run build` still passes.
  - Depends on: (none)
  - Examples: (none — setup only)
  - Completed: 2026-05-25

- [x] **Task 1.2** — Write failing tests for startup env var validation (FR-1, Examples 5 and 6)
  - File(s): `src/__tests__/clients/xero-client.test.ts`
  - What to do: Create the test file and the test suite scaffold. Write two tests using `vi.stubEnv` (or env manipulation + dynamic import with module reset via `vi.resetModules()`) that cover: (a) when `XERO_CLIENT_ID` is absent, importing the module throws with a message containing `"XERO_CLIENT_ID is required"`; (b) when `XERO_CLIENT_SECRET` is absent, importing the module throws with a message containing `"XERO_CLIENT_SECRET is required"`. Both tests should be failing (red) because the current module throws a generic message. Include the necessary `beforeEach`/`afterEach` hooks to reset module registry between tests using `vi.resetModules()`.
  - Acceptance: `npx vitest run src/__tests__/clients/xero-client.test.ts` runs and the two new tests are reported as failing (not erroring on setup).
  - Depends on: Task 1.1
  - Examples: Example 5, Example 6
  - Completed: 2026-05-25
  - Tests: `src/__tests__/clients/xero-client.test.ts`

- [x] **Task 1.3** — Implement startup env var validation; tests go green
  - File(s): `src/clients/xero-client.ts`
  - What to do: Replace the current module-level validation block (lines 14–21) with: read `client_id = process.env.XERO_CLIENT_ID` and `client_secret = process.env.XERO_CLIENT_SECRET` (removing `bearer_token` and `grant_type` variables entirely). Add two explicit throws — `if (!client_id) throw new Error("XERO_CLIENT_ID is required");` followed by `if (!client_secret) throw new Error("XERO_CLIENT_SECRET is required");`. Remove the `bearer_token` variable and combined guard. Keep `dotenv.config()` and the `MCPXeroClient` abstract base class entirely unchanged.
  - Acceptance: The two tests from Task 1.2 pass. `npm run build` passes. `npm run lint` passes.
  - Depends on: Task 1.2
  - Examples: Example 5, Example 6
  - Completed: 2026-05-25
  - Tests: `src/__tests__/clients/xero-client.test.ts`

### Phase 2: Core Logic

- [ ] **Task 2.1** — Write failing tests for `resolveRefreshToken()` (FR-2, Examples 2, 3, 4, 13, 14)
  - File(s): `src/__tests__/clients/xero-client.test.ts`
  - What to do: Add a describe block for `resolveRefreshToken()`. Write five tests using `vi.mock('node:fs')` and `vi.stubEnv` to cover: (a) token file exists and is non-empty — returns file contents trimmed (Example 14); (b) token file exists and has custom `XERO_TOKEN_FILE` path — returns that file's contents (Example 13); (c) no token file, `XERO_REFRESH_TOKEN` env var is set — returns env var value (Example 2); (d) token file AND `XERO_REFRESH_TOKEN` both present — returns file value, not env var (Example 3); (e) neither source available — throws with message containing `"XERO_REFRESH_TOKEN"` and `"https://api-explorer.xero.com"` (Example 4). Tests should be failing (red) because `RefreshTokenXeroClient` does not exist yet.
  - Acceptance: Five new tests are reported as failing.
  - Depends on: Task 1.3
  - Examples: Example 2, Example 3, Example 4, Example 13, Example 14

- [ ] **Task 2.2** — Implement `RefreshTokenXeroClient` skeleton and `resolveRefreshToken()`; tests go green
  - File(s): `src/clients/xero-client.ts`
  - What to do: Delete `CustomConnectionsXeroClient` and `BearerTokenXeroClient` entirely. Add `import * as fs from 'node:fs'` and `import * as path from 'node:path'` and `import * as os from 'node:os'` at the top. Add `import { AxiosError } from 'axios'` (keep the existing `axios` import, drop `AxiosError` from it if needed). Create `RefreshTokenXeroClient extends MCPXeroClient` with: a `private readonly clientId: string`, `private readonly clientSecret: string`, `private tokenFilePath: string` (set in constructor using `process.env.XERO_TOKEN_FILE ?? path.join(os.homedir(), '.xero-mcp', 'refresh_token')`), `private currentRefreshToken: string = ""`, `private initialised = false`. Implement `private resolveRefreshToken(): string` — reads token file path, tries `fs.readFileSync(this.tokenFilePath, 'utf-8').trim()` in a try/catch (on any error, fall through), then checks `process.env.XERO_REFRESH_TOKEN`, then throws with message `"No refresh token found. Set XERO_REFRESH_TOKEN to a valid Xero refresh token, or obtain one at https://api-explorer.xero.com"`. Add a stub `public async authenticate(): Promise<void> { throw new Error("not implemented"); }` to satisfy the abstract class. Update the module-level export: `export const xeroClient = new RefreshTokenXeroClient({ clientId: client_id, clientSecret: client_secret });`.
  - Acceptance: The five tests from Task 2.1 pass. `npm run build` passes. `npm run lint` passes.
  - Depends on: Task 2.1
  - Examples: Example 2, Example 3, Example 4, Example 13, Example 14

- [ ] **Task 2.3** — Write failing tests for `exchangeToken()` (FR-3, Examples 7)
  - File(s): `src/__tests__/clients/xero-client.test.ts`
  - What to do: Add a describe block for `exchangeToken()`. Mock `axios` using `vi.mock('axios')`. Write two tests: (a) Xero returns a 200 response with `{ access_token: "at_new", refresh_token: "rt_rotated", expires_in: 1800 }` — the method returns those fields; (b) Xero returns a 400 response with `{ error: "invalid_grant" }` — the method throws with a message containing `"invalid"` and `"https://api-explorer.xero.com"`. Verify that the POST is made with `Authorization: Basic <base64(clientId:clientSecret)>`, `Content-Type: application/x-www-form-urlencoded`, and body containing `grant_type=refresh_token` and the provided refresh token value.
  - Acceptance: Two new tests reported as failing (method stub returns "not implemented").
  - Depends on: Task 2.2
  - Examples: Example 7

- [ ] **Task 2.4** — Implement `exchangeToken()`; tests go green
  - File(s): `src/clients/xero-client.ts`
  - What to do: Add `private async exchangeToken(refreshToken: string): Promise<{ access_token: string; refresh_token: string; expires_in: number; token_type: string }>` to `RefreshTokenXeroClient`. Logic: build Basic auth header `Buffer.from(\`${this.clientId}:${this.clientSecret}\`).toString('base64')`. POST to `https://identity.xero.com/connect/token` with body `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}` and headers `Authorization: Basic ${credentials}`, `Content-Type: application/x-www-form-urlencoded`. On success: return `response.data`. On any error: catch and throw a new Error with message `"Refresh token is invalid or expired. Obtain a new one at https://api-explorer.xero.com. Xero error: ${<extract error from AxiosError.response.data or error.message>}"`.
  - Acceptance: The two tests from Task 2.3 pass. `npm run build` passes. `npm run lint` passes.
  - Depends on: Task 2.3
  - Examples: Example 7

- [ ] **Task 2.5** — Write failing tests for `persistRefreshToken()` (FR-4, Example 8)
  - File(s): `src/__tests__/clients/xero-client.test.ts`
  - What to do: Add a describe block for `persistRefreshToken()`. Mock `node:fs`. Write two tests: (a) parent directory exists — `fs.writeFileSync` is called with the token file path, the token string, and `{ mode: 0o600 }`; (b) parent directory does not exist (`fs.existsSync` returns false for the parent dir) — throws with a message containing the directory path and instructing the user to create it.
  - Acceptance: Two new tests reported as failing.
  - Depends on: Task 2.4
  - Examples: Example 8

- [ ] **Task 2.6** — Implement `persistRefreshToken()`; tests go green
  - File(s): `src/clients/xero-client.ts`
  - What to do: Add `private persistRefreshToken(token: string): void` to `RefreshTokenXeroClient`. Logic: `const dir = path.dirname(this.tokenFilePath)`. If `!fs.existsSync(dir)`, throw `new Error(\`Token file directory does not exist: ${dir}. Create it with: mkdir -p ${dir}\`)`. Otherwise call `fs.writeFileSync(this.tokenFilePath, token, { mode: 0o600 })`.
  - Acceptance: The two tests from Task 2.5 pass. `npm run build` passes. `npm run lint` passes.
  - Depends on: Task 2.5
  - Examples: Example 8

- [ ] **Task 2.7** — Write failing tests for `scheduleRefresh()` and the timer behaviour (FR-6, FR-7, Examples 9, 10)
  - File(s): `src/__tests__/clients/xero-client.test.ts`
  - What to do: Add a describe block for `scheduleRefresh()`. Use Vitest fake timers (`vi.useFakeTimers()`) and mock `axios` and `node:fs`. Write three tests: (a) timer fires at `(expires_in - 300) * 1000` ms — `exchangeToken` is called with `currentRefreshToken`, `persistRefreshToken` is called with the rotated token, `setTokenSet` is called with new access token, `updateTenants` is NOT called, and a new timer is scheduled (Example 9); (b) timer fires and `exchangeToken` rejects — `process.exit` is called with `1` and something is written to stderr (Example 10); (c) the timer is `unref()`'d so the timer handle does not prevent process exit (check `timer.unref` was called).
  - Acceptance: Three new tests reported as failing.
  - Depends on: Task 2.6
  - Examples: Example 9, Example 10

- [ ] **Task 2.8** — Implement `scheduleRefresh()`; tests go green
  - File(s): `src/clients/xero-client.ts`
  - What to do: Add `private scheduleRefresh(expiresIn: number): void` to `RefreshTokenXeroClient`. Logic: `const delayMs = (expiresIn - 300) * 1000`. Call `setTimeout(async () => { try { const tokenData = await this.exchangeToken(this.currentRefreshToken); this.persistRefreshToken(tokenData.refresh_token); this.currentRefreshToken = tokenData.refresh_token; this.setTokenSet({ access_token: tokenData.access_token, expires_in: tokenData.expires_in, token_type: tokenData.token_type }); this.scheduleRefresh(tokenData.expires_in); } catch (error) { console.error("Scheduled token refresh failed:", error); process.exit(1); } }, delayMs).unref()`.
  - Acceptance: The three tests from Task 2.7 pass. `npm run build` passes. `npm run lint` passes.
  - Depends on: Task 2.7
  - Examples: Example 9, Example 10

- [ ] **Task 2.9** — Write failing tests for `authenticate()` startup orchestration (FR-5, Examples 1, 11)
  - File(s): `src/__tests__/clients/xero-client.test.ts`
  - What to do: Add a describe block for `authenticate()`. Mock `axios`, `node:fs`, and stub `updateTenants`. Write three tests: (a) first call — invokes `resolveRefreshToken`, `exchangeToken`, `persistRefreshToken`, `setTokenSet`, `updateTenants`, and `scheduleRefresh` in order; token file contains a valid token (Example 1); (b) second call (after `initialised` is true) — returns immediately with no HTTP calls or file I/O made (Example 11); (c) no token source — throws with the message from `resolveRefreshToken` (Example 4, propagation check).
  - Acceptance: Three new tests reported as failing.
  - Depends on: Task 2.8
  - Examples: Example 1, Example 11

- [ ] **Task 2.10** — Implement `authenticate()`; tests go green
  - File(s): `src/clients/xero-client.ts`
  - What to do: Replace the stub `authenticate()` in `RefreshTokenXeroClient` with the full implementation. Logic: `if (this.initialised) return;`. Then: `const refreshToken = this.resolveRefreshToken(); const tokenData = await this.exchangeToken(refreshToken); this.persistRefreshToken(tokenData.refresh_token); this.currentRefreshToken = tokenData.refresh_token; this.setTokenSet({ access_token: tokenData.access_token, expires_in: tokenData.expires_in, token_type: tokenData.token_type }); await this.updateTenants(); this.scheduleRefresh(tokenData.expires_in); this.initialised = true;`.
  - Acceptance: The three tests from Task 2.9 pass. All previous tests still pass. `npm run build` passes. `npm run lint` passes.
  - Depends on: Task 2.9
  - Examples: Example 1, Example 11

### Phase 3: Integration & Entry Point

- [ ] **Task 3.1** — Wire eager authentication into `src/index.ts` (Component 8)
  - File(s): `src/index.ts`
  - What to do: Add `import { xeroClient } from "./clients/xero-client.js";` to `src/index.ts`. Inside the `main()` function, add `await xeroClient.authenticate();` as the first statement before `ToolFactory(server)`. This ensures the server fails fast on startup with a clear error if credentials are invalid, and the scheduled refresh timer starts immediately.
  - Acceptance: `npm run build` passes. `npm run lint` passes. A manual smoke-check: running `node dist/index.js` without any env vars set should exit immediately with "XERO_CLIENT_ID is required" (visible in stderr).
  - Depends on: Task 2.10
  - Examples: Example 1

- [ ] **Task 3.2** — Verify complete removal of old auth code (FR-8, Example 12)
  - File(s): `src/clients/xero-client.ts`
  - What to do: Run `grep -r "client_credentials\|XERO_SCOPES\|XERO_CLIENT_BEARER_TOKEN\|BearerTokenXeroClient\|CustomConnectionsXeroClient\|XERO_DEFAULT_AUTH_SCOPES" src/` and confirm it returns no results. If any symbols remain (e.g. stale comments or imports), remove them now. Ensure the only exports from `src/clients/xero-client.ts` are `xeroClient` (the singleton) and any types that handlers depend on (verify by checking handler imports — none import anything besides `xeroClient`). Run `npm run build` and `npm run lint` to confirm no broken references.
  - Acceptance: The grep returns zero results. `npm run build` and `npm run lint` both pass. All tests still pass.
  - Depends on: Task 3.1
  - Examples: Example 12

- [ ] **Task 3.3** — Update ADR 0001 status to Accepted
  - File(s): `.specs/adr/0001-refresh-token-auth-mode.md`
  - What to do: Change `Status: Draft` to `Status: Accepted` in the ADR front matter. This must happen in Phase 3 (alongside the code landing) so the ADR and the implementation are in sync at all times — not after documentation.
  - Acceptance: The ADR status field reads `Accepted`.
  - Depends on: Task 3.2

### Phase 4: Documentation & Cleanup

- [ ] **Task 4.1** — Update `.env.example` (FR-9)
  - File(s): `.env.example`
  - What to do: Replace the file contents with the new required/optional env vars: `XERO_CLIENT_ID` (required), `XERO_CLIENT_SECRET` (required), `XERO_REFRESH_TOKEN` (optional — initial seed token, used on first run before token file exists), `XERO_TOKEN_FILE` (optional — defaults to `~/.xero-mcp/refresh_token`). Each variable should have a one-line comment explaining its purpose and whether it is required or optional.
  - Acceptance: `.env.example` contains no references to `XERO_CLIENT_BEARER_TOKEN` or `XERO_SCOPES`. All four new variables are present with comments.
  - Depends on: Task 3.2
  - Examples: (none — documentation)

- [ ] **Task 4.2** — Rewrite the Authentication section of `README.md` (FR-9)
  - File(s): `README.md`
  - What to do: Remove the "Custom Connections" and "Bearer Token" subsections (lines 41–136 approximately). Replace with a single "Refresh Token Mode" section that covers: (1) prerequisites — a Xero Web Application in the Xero Developer Portal (available to all regions); (2) step-by-step instructions for obtaining the initial refresh token via the Xero API Explorer at `https://api-explorer.xero.com`; (3) where to put the token — set `XERO_REFRESH_TOKEN` env var for first run, after which the token file at `~/.xero-mcp/refresh_token` is used automatically; (4) update the Claude Desktop config JSON example to show `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`, and `XERO_REFRESH_TOKEN` only (no `XERO_SCOPES` or `XERO_CLIENT_BEARER_TOKEN`); (5) a note about token rotation — the server auto-persists the rotated token so the env var only needs to be set once. Remove any mention of scopes V1/V2, `XERO_SCOPES`, or `XERO_CLIENT_BEARER_TOKEN` from the README. The Available MCP Commands section and all other sections remain unchanged.
  - Acceptance: `grep "XERO_CLIENT_BEARER_TOKEN\|XERO_SCOPES\|Custom Connection\|Bearer Token\|client_credentials" README.md` returns no results. README contains step-by-step instructions referencing `https://api-explorer.xero.com`.
  - Depends on: Task 4.1
  - Examples: (none — documentation)

## Out of Scope

- **Handler files** — None of the 51+ handler files need changes. They all call `await xeroClient.authenticate()` which becomes a no-op after startup, and they import only `xeroClient` by name (which is unchanged).
- **`openid-client` direct dependency removal** — The design notes that `openid-client` ^6.8.1 is a direct dep that is never imported in source. Removing it is out of scope for FR-8, which only targets code removal within `src/`. That is a separate cleanup task.
- **`src/tools/` and `src/helpers/`** — No changes required; the public interface of `xeroClient` is unchanged.
- **`vitest.config.ts`** — Vitest can run without a config file for a simple ESM + TypeScript project; if the test runner complains, the build agent should add a minimal config, but this is not anticipated as a required task.
- **Initial refresh token acquisition flow** — Out of scope per requirements (no localhost HTTP listener; the user obtains the token manually via the Xero API Explorer).
