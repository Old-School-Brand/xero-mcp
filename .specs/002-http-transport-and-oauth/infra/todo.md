# Todo: Deployment Artefacts + Redis Token Persistence
**Layer:** infra
**Status:** Complete
**Last updated:** 2026-05-27

## Implementation Tasks

Tasks are ordered. Do not start a task until its dependencies are complete.

Phase A must end independently green (`npx vitest run src/__tests__/clients/xero-client.test.ts` passes, `npm run build` clean) before Phase B begins.

---

### Phase A — Redis token persistence (full-tdd)

#### A1 — Add token-store fields and `ensureRedisClient()` to `RefreshTokenXeroClient`

- File(s): `src/clients/xero-client.ts`
- What to do:
  1. Add three private fields to `RefreshTokenXeroClient` immediately after `authPromise`:
     - `private readonly tokenStore: "file" | "redis"` — read in the constructor as `process.env.XERO_TOKEN_STORE === "redis" ? "redis" : "file"`.
     - `private readonly tokenRedisKey: string` — read in the constructor as `process.env.XERO_TOKEN_REDIS_KEY ?? "xero:refresh_token"`.
     - `private tokenRedisClient: Awaited<ReturnType<typeof import("redis")["createClient"]>> | null = null` — initialised to `null`. (Type it as `unknown` if the conditional import type is unwieldy; cast inside the method.)
  2. Add private async method `ensureRedisClient()`: if `this.tokenRedisClient?.isReady` is true, return it. Otherwise: throw immediately if `process.env.REDIS_URL` is unset/empty (`"REDIS_URL is required when XERO_TOKEN_STORE=redis"`). Then `const { createClient } = await import("redis")`, `const client = createClient({ url: process.env.REDIS_URL })`, `await client.connect()`, assign to `this.tokenRedisClient`, return it.
  3. Do NOT change any other methods yet. All existing code below the new fields is untouched.
- Acceptance: `npx vitest run src/__tests__/clients/xero-client.test.ts` — all 17 existing tests pass. `npm run build` exits 0.
- Depends on: none
- Examples: Example 2 (tokenStore field defaults to "file")

#### A2 — Add `resolveRefreshTokenAsync()` and `persistRefreshTokenAsync()` async dispatchers

- File(s): `src/clients/xero-client.ts`
- What to do:
  1. Add private async method `resolveRefreshTokenAsync(): Promise<string>`:
     - If `this.tokenStore === "file"`: return `this.resolveRefreshToken()` (unchanged sync method).
     - If `this.tokenStore === "redis"`:
       1. `const client = await this.ensureRedisClient()`.
       2. `const token = await client.get(this.tokenRedisKey)`.
       3. If `token` is non-null and non-empty: return it.
       4. Else fall back to `process.env.XERO_REFRESH_TOKEN` — if non-empty, return it.
       5. Else throw `new Error("No refresh token found. Set XERO_REFRESH_TOKEN to a valid Xero refresh token, or obtain one at https://api-explorer.xero.com")`.
  2. Add private async method `persistRefreshTokenAsync(token: string): Promise<void>`:
     - If `this.tokenStore === "file"`: call `this.persistRefreshToken(token)` (unchanged sync method).
     - If `this.tokenStore === "redis"`: `const client = await this.ensureRedisClient()`, then `await client.set(this.tokenRedisKey, token)` — no TTL, no EX/PX options.
  3. Do NOT modify `_doAuthenticate()` or `scheduleRefresh()` yet.
- Acceptance: `npx vitest run src/__tests__/clients/xero-client.test.ts` — all 17 existing tests still pass. `npm run build` exits 0.
- Depends on: A1
- Examples: Example 3, 4, 5, 6, 8, 9

#### A3 — Wire async dispatchers into `_doAuthenticate()` and `scheduleRefresh()`

- File(s): `src/clients/xero-client.ts`
- What to do:
  1. In `_doAuthenticate()` (line 208):
     - Change `const refreshToken = this.resolveRefreshToken()` to `const refreshToken = await this.resolveRefreshTokenAsync()`.
     - Change `this.persistRefreshToken(tokenData.refresh_token)` to `await this.persistRefreshTokenAsync(tokenData.refresh_token)`.
     - Everything else (exchangeToken, setTokenSet, updateTenants, scheduleRefresh) is untouched.
  2. In the `setTimeout` callback inside `scheduleRefresh()` (line 184):
     - Change `this.persistRefreshToken(tokenData.refresh_token)` to `await this.persistRefreshTokenAsync(tokenData.refresh_token)`.
     - The callback is already `async`; the existing `catch (error) { console.error(...); process.exit(1); }` block is preserved exactly.
  3. No other changes.
- Acceptance: `npx vitest run src/__tests__/clients/xero-client.test.ts` — all 17 existing tests pass. `npm run build` exits 0.
- Depends on: A2
- Examples: Example 1, 10, 11

#### A4 — Write Redis-mode tests for `resolveRefreshTokenAsync()` and `ensureRedisClient()`

- File(s): `src/__tests__/clients/xero-client.test.ts`
- What to do: Add a new `describe("resolveRefreshTokenAsync() — redis mode", ...)` section after the existing Section 2. The section must include a `vi.mock("redis", ...)` factory at the top level of the new describe (or at the file's top level alongside the existing mocks) returning a fake `createClient` whose result has `connect: vi.fn()`, `get: vi.fn()`, `set: vi.fn()`, `isReady: true`. Use `vi.stubEnv("XERO_TOKEN_STORE", "redis")` and `vi.stubEnv("REDIS_URL", "redis://localhost:6379/0")` in `beforeEach`. Write these specific tests:
  - `test_redis_resolvesFromKey`: `get` returns `"rt_redis_stored_001"` → `resolveRefreshTokenAsync()` returns `"rt_redis_stored_001"`; `fs.readFileSync` not called. (Example 3)
  - `test_redis_seedsFromEnvWhenKeyAbsent`: `get` returns `null`, `XERO_REFRESH_TOKEN=rt_env_seed_003` → returns `"rt_env_seed_003"`. (Example 4)
  - `test_redis_throwsWhenKeyAndEnvAbsent`: `get` returns `null`, `XERO_REFRESH_TOKEN` unset → throws matching `/XERO_REFRESH_TOKEN.*api-explorer\.xero\.com/`. (Example 9)
  - `test_redis_usesCustomKeyName`: `XERO_TOKEN_REDIS_KEY=custom:token:key`, `get("custom:token:key")` returns `"rt_custom_001"` → returns `"rt_custom_001"` and `get` was called with `"custom:token:key"`. (Example 8)
  - `test_redis_failLoudWhenRedisUrlMissing`: `REDIS_URL` is `""` → `resolveRefreshTokenAsync()` rejects with `"REDIS_URL is required when XERO_TOKEN_STORE=redis"`. (Example 6)
  - `test_redis_failLoudWhenRedisUnreachable`: `connect` rejects with `Error("Connection refused")` → `resolveRefreshTokenAsync()` rejects with that error. (Example 7)
  - `test_fileModeDefault_doesNotCallRedis`: `XERO_TOKEN_STORE` unset, `fs.readFileSync` returns a token → `resolveRefreshTokenAsync()` resolves; `redis.createClient` not called. (Example 1 / Example 10 guard)
- Acceptance: `npx vitest run src/__tests__/clients/xero-client.test.ts` — all tests pass (17 existing + new redis-mode tests). `npm run build` exits 0.
- Depends on: A3
- Examples: Example 1, 3, 4, 6, 7, 8, 9, 10

#### A5 — Write Redis-mode tests for `persistRefreshTokenAsync()` and `scheduleRefresh()` in redis mode

- File(s): `src/__tests__/clients/xero-client.test.ts`
- What to do: Add a new `describe("persistRefreshTokenAsync() — redis mode", ...)` section and extend or add to the existing `scheduleRefresh()` section. Use the same mock setup from A4. Write these specific tests:
  - `test_redis_persistWritesToRedisKey`: `persistRefreshTokenAsync("rt_rotated_004")` calls `redis.set("xero:refresh_token", "rt_rotated_004")`; `fs.writeFileSync` and `fs.renameSync` not called. (Example 5)
  - `test_redis_scheduledRefreshPersistsToRedis`: Boot a client in redis mode (stub `XERO_TOKEN_STORE=redis`, `vi.useFakeTimers`), advance the timer, confirm `redis.set` is called with the rotated token and `fs.writeFileSync` is not called. (Example 5 / Example 11)
  - `test_redis_scheduledRefreshFailureExitsProcess`: Boot a client in redis mode, cause the exchange to reject, advance the timer, confirm `process.exit(1)` is called. (Example 11)
- Acceptance: `npx vitest run src/__tests__/clients/xero-client.test.ts` — all tests pass (full suite including existing 17). `npm run build` exits 0.
- Depends on: A4
- Examples: Example 5, 11

#### A6 — Update `.env.example` with `XERO_TOKEN_STORE` block

- File(s): `.env.example`
- What to do: Insert the following block between the `# XERO_TOKEN_FILE=...` comment line (line 13) and the `# -- OSB HTTP Mode` separator (line 15). Do not alter any existing line:
  ```
  
  # -- Token persistence backend ------------------------------------------------------------------
  # Controls where the rotated refresh token is stored.
  # "file" (default): writes to XERO_TOKEN_FILE (local/stdio use).
  # "redis": writes to a Redis key (deployed/HTTP use; requires REDIS_URL).
  # XERO_TOKEN_STORE=file
  
  # Redis key name for the refresh token when XERO_TOKEN_STORE=redis.
  # XERO_TOKEN_REDIS_KEY=xero:refresh_token
  ```
- Acceptance: `git diff .env.example` shows only the two new comment-blocks added; no existing line changed. `npx vitest run src/__tests__/clients/xero-client.test.ts` still passes.
- Depends on: A3
- Examples: (FR-7)

---

### Phase B — Deployment artefacts (verification-only)

#### B1 — Create `.dockerignore`

- File(s): `.dockerignore` (repo root — new file)
- What to do: Create the file with the following entries (one per line):
  ```
  .git/
  .github/
  .specs/
  .claude/
  .vscode/
  coverage/
  node_modules/
  dist/
  compose*.yml
  charts/
  .env*
  *.md
  !package.json
  ```
  The `!package.json` exception ensures `package.json` is in the build context despite `*.md` exclusion not applying to it — but keep it because it makes intent explicit.
- Acceptance: File exists at repo root. Running `docker build --dry-run .` (or any docker build attempt) does not error on missing context files. FR-9 entries all present.
- Depends on: (none — can be done in parallel with B2, but must precede the B2 docker build verification)

#### B2 — Create `Dockerfile`

- File(s): `Dockerfile` (repo root — new file)
- What to do: Create a multi-stage `Dockerfile` exactly as specified in design.md component B1:
  - **Builder stage** `FROM node:22-bookworm-slim AS builder`: `WORKDIR /app`, `COPY package.json package-lock.json ./`, `RUN npm ci`, `COPY tsconfig.json ./`, `COPY src/ ./src/`, `RUN npm run build && npm prune --omit=dev`.
  - **Runtime stage** `FROM node:22-bookworm-slim`: `WORKDIR /app`, `RUN apt-get update && apt-get upgrade -y --no-install-recommends && rm -rf /var/lib/apt/lists/*`, `RUN groupadd -g 10001 appgroup && useradd -u 10001 -g appgroup -s /sbin/nologin -M appuser && chown -R appuser:appgroup /app`, `COPY --from=builder --chown=appuser:appgroup /app/dist ./dist/`, `COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules/`, `COPY --from=builder --chown=appuser:appgroup /app/package.json ./`.
  - ENV declarations: `XERO_TOKEN_FILE=/app/.xero-mcp/refresh_token`, `MCP_BIND_HOST=0.0.0.0`, `MCP_BIND_PORT=8000`.
  - `EXPOSE 8000`.
  - `HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 CMD node -e "const http = require('http'); const req = http.get('http://localhost:8000/livez', (res) => { process.exit(res.statusCode === 200 ? 0 : 1); }); req.on('error', () => process.exit(1));"`.
  - `USER 10001:10001`.
  - `ENTRYPOINT ["node", "/app/dist/http/server.js"]`.
- Acceptance: `docker build -t xero-mcp:test .` exits 0. `docker inspect xero-mcp:test | jq '.[0].Config.User'` outputs `"10001:10001"`. `docker inspect xero-mcp:test | jq '.[0].Config.Entrypoint'` outputs `["node","/app/dist/http/server.js"]`. FR-8, AC-6.
- Depends on: B1 (`.dockerignore` must exist for the build context to be correct)

#### B3 — Create `compose.yml` and `compose.override.yml`

- File(s): `compose.yml`, `compose.override.yml` (repo root — both new)
- What to do:
  **`compose.yml`** — two services:
  - `valkey`: image `valkey/valkey:9.0.4`, `restart: always`, healthcheck `["CMD", "valkey-cli", "ping"]` with `interval: 10s`, `timeout: 5s`, `retries: 5`.
  - `backend`: `build: { context: ., dockerfile: Dockerfile }`, `image: xero-mcp:latest`, `restart: always`, `depends_on: { valkey: { condition: service_healthy } }`, `environment: [ENVIRONMENT=local, REDIS_URL=redis://valkey:6379/0]`, `env_file: [{ path: .env, required: false }]`, healthcheck using the same Node one-liner as the Dockerfile with `interval: 10s`, `timeout: 5s`, `start_period: 15s`, `retries: 5`.

  **`compose.override.yml`** — backend service only:
  - `restart: "no"`, `ports: ["8000:8000"]`, `volumes: ["./.xero-mcp:/app/.xero-mcp"]`, `develop.watch: [{ path: ./src, action: rebuild }, { path: ./package.json, action: rebuild }]`.
- Acceptance: `docker compose config` exits 0 (validates merged config). AC-7.
- Depends on: B2 (Dockerfile must exist for compose config validation to succeed)

#### B4 — Create Helm chart skeleton (`Chart.yaml`, `.helmignore`, `templates/_helpers.tpl`)

- File(s): `charts/xero-mcp/Chart.yaml`, `charts/xero-mcp/.helmignore`, `charts/xero-mcp/templates/_helpers.tpl` (all new)
- What to do:
  **`Chart.yaml`**:
  ```yaml
  apiVersion: v2
  name: xero-mcp
  description: MCP server that wraps the Xero accounting/payroll API.
  version: 0.0.0
  appVersion: "0.0.0"
  ```
  **`.helmignore`**: verbatim copy of `/Users/llewellyn/Code/cin7-mcp/charts/cin7-mcp/` — standard Helm ignore file (covers `.git/`, `*.md`, `tests/`, etc.; read cin7-mcp's file for the exact content).
  **`templates/_helpers.tpl`**: same four helpers as cin7-mcp (`backend.name`, `backend.fullname`, `backend.labels`, `backend.selectorLabels`) with chart name `xero-mcp` where cin7-mcp uses `cin7-mcp`. Content is identical aside from that substitution.
- Acceptance: `helm lint charts/xero-mcp` exits 0 (chart skeleton is valid even without complete templates). FR-12.
- Depends on: (none — no dependency on Phase A or B1-B3)

#### B5 — Create `charts/xero-mcp/templates/service.yaml`

- File(s): `charts/xero-mcp/templates/service.yaml` (new)
- What to do: Verbatim copy of cin7-mcp's `service.yaml`. ClusterIP Service, port from `.Values.service.port`, selector via `backend.selectorLabels` helper. No changes needed relative to cin7-mcp.
- Acceptance: `helm lint charts/xero-mcp` still exits 0. `helm template xero-mcp charts/xero-mcp | grep "kind: Service"` outputs a line. FR-14.
- Depends on: B4

#### B6 — Create `charts/xero-mcp/templates/ingress.yaml`

- File(s): `charts/xero-mcp/templates/ingress.yaml` (new)
- What to do: Verbatim copy of cin7-mcp's `ingress.yaml`. Gate on `{{- if .Values.ingress.enabled }}`. Immediately inside the gate, add `{{- if not .Values.ingress.host }}{{ fail "ingress.enabled is true but ingress.host is empty — set ingress.host to the Tailscale Funnel hostname" }}{{- end }}`. `ingressClassName: tailscale`, annotation `tailscale.com/funnel: "true"`, host from `.Values.ingress.host`, TLS with `.Values.ingress.tls.secretName`. No changes needed relative to cin7-mcp.
- Acceptance: `helm template xero-mcp charts/xero-mcp` (default `ingress.enabled=false`) produces no Ingress object. `helm template xero-mcp charts/xero-mcp --set ingress.enabled=true --set ingress.host=xero.tail.ts.net` renders an Ingress with `ingressClassName: tailscale`. `helm template xero-mcp charts/xero-mcp --set ingress.enabled=true 2>&1 | grep "ingress.host is empty"` finds the guard message. AC-9.
- Depends on: B4

#### B7 — Create `charts/xero-mcp/values.yaml`

- File(s): `charts/xero-mcp/values.yaml` (new)
- What to do: Create `values.yaml` exactly as shown in design.md component B11. Key points that differ from cin7-mcp's `values.yaml` (to avoid inadvertently copying cin7-mcp's extra keys):
  - `replicaCount: 1` with inline comment `# See deployment.yaml comments for token-rotation rationale`.
  - `image.repository: oldschoolbrand.azurecr.io/xero-mcp/backend`.
  - `service.type: ClusterIP`, `service.port: 8000`.
  - `resources` requests `100m`/`384Mi`, limits `500m`/`1Gi`.
  - `envFrom.secretRef.name: ""`.
  - `auth.publicUrl: ""`, `auth.requiredScopes: ""`.
  - `env: {}`.
  - `ingress.enabled: false`, `ingress.host: ""`, `ingress.tls.secretName: ""`.
  - `probes.liveness` and `probes.readiness` with timings matching cin7-mcp exactly.
  - `extraVolumes: []`, `extraVolumeMounts: []`, `nodeSelector: {}`.
  - **NO** `cache`, `rateLimit`, `tokenPersistence`, or PVC keys.
- Acceptance: `helm lint charts/xero-mcp` exits 0. `helm template xero-mcp charts/xero-mcp | grep -c "kind:"` shows 2 (Deployment + Service). FR-16.
- Depends on: B4

#### B8 — Create `charts/xero-mcp/templates/deployment.yaml`

- File(s): `charts/xero-mcp/templates/deployment.yaml` (new)
- What to do: Model on cin7-mcp's `deployment.yaml` with these specific differences:
  1. Add `strategy: { type: RollingUpdate }` explicitly, with a YAML comment above the `replicas` field explaining the token-rotation overlap behaviour (brief: "RollingUpdate may cause brief 2-pod overlap during deploys; the second pod crash-restarts and reads the latest token from Redis — self-healing").
  2. In the `env:` block: replace cin7-mcp's `FASTMCP_HOME`, `CACHE_TTL_SECONDS`, and all `*_RATE_LIMIT_*` entries with a single chart-managed key: `- name: XERO_TOKEN_STORE`, `value: "redis"` (always). Conditionally add `MCP_SERVER_URL` from `.Values.auth.publicUrl` (same guard as cin7-mcp) and `ENTRA_REQUIRED_SCOPES` from `.Values.auth.requiredScopes` (same guard). Free-form `.Values.env` range goes before the chart-managed keys (same pattern as cin7-mcp).
  3. Everything else (pod securityContext, container securityContext, probes, resources, volumeMounts for `/tmp` emptyDir, extraVolumes, extraVolumeMounts, nodeSelector, envFrom.secretRef guard) is identical to cin7-mcp.
- Acceptance: `helm lint charts/xero-mcp` exits 0. `helm template xero-mcp charts/xero-mcp --set envFrom.secretRef.name=xero-secrets --set auth.publicUrl=https://x/ --set auth.requiredScopes=mcp` renders valid YAML. The rendered Deployment contains: `replicas: 1`, `strategy: { type: RollingUpdate }`, `readOnlyRootFilesystem: true`, `runAsNonRoot: true`, `runAsUser: 10001`, `XERO_TOKEN_STORE: redis` in env. No `PersistentVolumeClaim` in rendered output. AC-8, AC-10.
- Depends on: B5, B6, B7

#### B9 — Full Helm verification pass

- File(s): (no new files — verification only)
- What to do: Run the complete verification suite from design.md Testing Strategy Part B:
  1. `helm lint charts/xero-mcp` — must exit 0, zero errors or warnings.
  2. `helm template xero-mcp charts/xero-mcp --set envFrom.secretRef.name=xero-secrets --set auth.publicUrl=https://x/ --set auth.requiredScopes=mcp` — pipe to `kubectl apply --dry-run=client -f -` if `kubectl` is available, or simply check it produces valid YAML with `helm template ... | python3 -c "import sys,yaml; list(yaml.safe_load_all(sys.stdin))"`.
  3. `helm template xero-mcp charts/xero-mcp --set ingress.enabled=true --set ingress.host=xero.tail.ts.net | grep ingressClassName` — must output `tailscale`.
  4. `helm template xero-mcp charts/xero-mcp --set ingress.enabled=true 2>&1 | grep "ingress.host is empty"` — must find the guard message.
  5. `helm template xero-mcp charts/xero-mcp | grep -c PersistentVolumeClaim` — must output `0`.
  All five commands must pass before marking this task complete.
- Acceptance: All five commands pass. AC-8, AC-9, AC-10.
- Depends on: B8

#### B10 — Docker and Compose end-to-end verification

- File(s): (no new files — verification only)
- What to do: Run the two docker verification commands from design.md Testing Strategy Part B:
  1. `docker build -t xero-mcp:test .` — must exit 0.
  2. Confirm the image runs as UID 10001 and the entrypoint is `node /app/dist/http/server.js` (via `docker inspect xero-mcp:test`).
  3. Ensure a `.env` file with valid `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`, `XERO_REFRESH_TOKEN`, and `ENVIRONMENT=local`, `DEV_BEARER_TOKEN=test` is present (copy `.env.example` and fill in test values). Then: `docker compose up --build -d`, wait for the backend healthcheck to pass (`docker compose ps` shows healthy), `curl -fsS http://localhost:8000/livez`, then `docker compose down`.
  Note: this step requires a working `.env` with real or test Xero credentials. If credentials are unavailable, verify the compose config is syntactically valid with `docker compose config` and record that the live boot verification requires credentials (it is not a CI gate — it is a local smoke test per the design.md scope).
- Acceptance: `docker build` exits 0; `docker inspect` confirms UID and entrypoint. `docker compose config` exits 0. `curl /livez` returns 200 when a valid `.env` is present. AC-6, AC-7.
- Depends on: B3, B8 (Dockerfile and compose files complete)

#### B11 — Update `.specs/REPO.md` and confirm `.specs/GLOSSARY.md`

- File(s): `.specs/REPO.md`, `.specs/GLOSSARY.md`
- What to do:
  **`.specs/REPO.md`:**
  1. In the **Project Layout** section, add the new root-level files to the directory tree: `Dockerfile`, `.dockerignore`, `compose.yml`, `compose.override.yml`, `charts/xero-mcp/` (with a brief descriptor for each).
  2. In the **Required env vars** table, add a row for `XERO_TOKEN_STORE` (purpose: Token store selector, `file`|`redis`, default `file`) and `XERO_TOKEN_REDIS_KEY` (optional, default `xero:refresh_token`).
  3. Add a short **Local Docker stack** subsection under **Driving the running MCP server** describing `docker compose up --build` and the `curl /livez` smoke check.
  **`.specs/GLOSSARY.md`:** Verify that `Token store` and `XERO_TOKEN_STORE` entries already exist (they were promoted by foundry in design.md step 4b, and are present in the current file). If both entries are present with correct definitions, no change is needed. If either is missing or the `Token file` entry has not been updated to note it is the `file`-mode backend, apply the minimal corrective edit.
- Acceptance: `git diff .specs/REPO.md` shows the three additions described above. `.specs/GLOSSARY.md` contains entries for `Token store` and `XERO_TOKEN_STORE` (already confirmed present — this is a check task, not a write task). FR-18.
- Depends on: B9 (ensures the artefacts are correct before documenting them)

---

### Phase 3: Integration & Verification

#### V1 — Full suite regression check

- File(s): (no new files)
- What to do: Run `npm run test` from the repo root. Confirm all tests pass (the existing 17 file-mode tests plus all new redis-mode tests from A4 and A5). Then run `npm run build` to confirm TypeScript compilation is clean. Then run `npm run lint` to confirm ESLint passes.
- Acceptance: `npm run test` exits 0. `npm run build` exits 0. `npm run lint` exits 0 (or exits with only pre-existing warnings, none introduced by this feature).
- Depends on: A6, B10, B11

---

## Out of Scope

- **CI image build + push / registry auth / image scanning / version bumps** — `ci-cd` layer, separate feature.
- **Live `helm install` against a cluster** — deferred to the release engineer per design.md.
- **Deploying Valkey/Redis** — the chart consumes a pre-provisioned instance via `REDIS_URL`; provisioning is operator responsibility.
- **Encryption at rest for the Redis token** — explicit follow-up noted in design.md.
- **A standalone ADR for the token-store decision** — `design.md` captures the rationale per FR-17; no separate ADR file is needed.
- **Any change to files outside `src/clients/xero-client.ts` under `src/`** — no other `src/` file is touched; the upstream-isolation convention is enforced.
- **`XERO_TOKEN_STORE=redis` in `compose.yml`** — the compose local-dev stack defaults to file mode (by not setting `XERO_TOKEN_STORE`); operators override in `.env` if they want redis mode locally.
