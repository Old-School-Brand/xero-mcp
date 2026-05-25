# Todo: OAuth2 Web App Auth Flow
**Layer:** backend
**Status:** Complete
**Last updated:** 2026-05-25

## Implementation Tasks

Tasks are ordered. Do not start a task until its dependencies are complete.

### Phase 1: Foundation

- [x] **Task 1.1** — Install Vitest and add axios as a direct dependency
  - File(s): `package.json`, `package-lock.json`
  - Completed: 2026-05-25

- [x] **Task 1.2** — Write failing tests for startup env var validation (FR-1, Examples 5 and 6)
  - File(s): `src/__tests__/clients/xero-client.test.ts`
  - Completed: 2026-05-25
  - Tests: `src/__tests__/clients/xero-client.test.ts`

- [x] **Task 1.3** — Implement startup env var validation; tests go green
  - File(s): `src/clients/xero-client.ts`
  - Completed: 2026-05-25
  - Tests: `src/__tests__/clients/xero-client.test.ts`

### Phase 2: Core Logic

- [x] **Task 2.1** — Write failing tests for `resolveRefreshToken()` (FR-2, Examples 2, 3, 4, 13, 14)
  - File(s): `src/__tests__/clients/xero-client.test.ts`
  - Completed: 2026-05-25
  - Tests: `src/__tests__/clients/xero-client.test.ts`

- [x] **Task 2.2** — Implement `RefreshTokenXeroClient` skeleton and `resolveRefreshToken()`; tests go green
  - File(s): `src/clients/xero-client.ts`
  - Completed: 2026-05-25
  - Tests: `src/__tests__/clients/xero-client.test.ts`

- [x] **Task 2.3** — Write failing tests for `exchangeToken()` (FR-3, Examples 7)
  - File(s): `src/__tests__/clients/xero-client.test.ts`
  - Completed: 2026-05-25
  - Tests: `src/__tests__/clients/xero-client.test.ts`

- [x] **Task 2.4** — Implement `exchangeToken()`; tests go green
  - File(s): `src/clients/xero-client.ts`
  - Completed: 2026-05-25
  - Tests: `src/__tests__/clients/xero-client.test.ts`

- [x] **Task 2.5** — Write failing tests for `persistRefreshToken()` (FR-4, Example 8)
  - File(s): `src/__tests__/clients/xero-client.test.ts`
  - Completed: 2026-05-25
  - Tests: `src/__tests__/clients/xero-client.test.ts`

- [x] **Task 2.6** — Implement `persistRefreshToken()`; tests go green
  - File(s): `src/clients/xero-client.ts`
  - Completed: 2026-05-25
  - Tests: `src/__tests__/clients/xero-client.test.ts`

- [x] **Task 2.7** — Write failing tests for `scheduleRefresh()` and the timer behaviour (FR-6, FR-7, Examples 9, 10)
  - File(s): `src/__tests__/clients/xero-client.test.ts`
  - Completed: 2026-05-25
  - Tests: `src/__tests__/clients/xero-client.test.ts`

- [x] **Task 2.8** — Implement `scheduleRefresh()`; tests go green
  - File(s): `src/clients/xero-client.ts`
  - Completed: 2026-05-25
  - Tests: `src/__tests__/clients/xero-client.test.ts`

- [x] **Task 2.9** — Write failing tests for `authenticate()` startup orchestration (FR-5, Examples 1, 11)
  - File(s): `src/__tests__/clients/xero-client.test.ts`
  - Completed: 2026-05-25
  - Tests: `src/__tests__/clients/xero-client.test.ts`

- [x] **Task 2.10** — Implement `authenticate()`; tests go green
  - File(s): `src/clients/xero-client.ts`
  - Completed: 2026-05-25
  - Tests: `src/__tests__/clients/xero-client.test.ts`

### Phase 3: Integration & Entry Point

- [x] **Task 3.1** — Wire eager authentication into `src/index.ts` (Component 8)
  - File(s): `src/index.ts`
  - Completed: 2026-05-25

- [x] **Task 3.2** — Verify complete removal of old auth code (FR-8, Example 12)
  - File(s): `src/clients/xero-client.ts`
  - Completed: 2026-05-25

- [x] **Task 3.3** — Update ADR 0001 status to Accepted
  - File(s): `.specs/adr/0001-refresh-token-auth-mode.md`
  - Completed: 2026-05-25

### Phase 4: Documentation & Cleanup

- [x] **Task 4.1** — Update `.env.example` (FR-9)
  - File(s): `.env.example`
  - Completed: 2026-05-25

- [x] **Task 4.2** — Rewrite the Authentication section of `README.md` (FR-9)
  - File(s): `README.md`
  - Completed: 2026-05-25

## Out of Scope

- **Handler files** — None of the 51+ handler files need changes. They all call `await xeroClient.authenticate()` which becomes a no-op after startup, and they import only `xeroClient` by name (which is unchanged).
- **`openid-client` direct dependency removal** — The design notes that `openid-client` ^6.8.1 is a direct dep that is never imported in source. Removing it is out of scope for FR-8, which only targets code removal within `src/`. That is a separate cleanup task.
- **`src/tools/` and `src/helpers/`** — No changes required; the public interface of `xeroClient` is unchanged.
- **`vitest.config.ts`** — Vitest can run without a config file for a simple ESM + TypeScript project; if the test runner complains, the build agent should add a minimal config, but this is not anticipated as a required task.
- **Initial refresh token acquisition flow** — Out of scope per requirements (no localhost HTTP listener; the user obtains the token manually via the Xero API Explorer).
