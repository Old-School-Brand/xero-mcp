# Requirements: Deployment Artefacts + Redis Token Persistence
**Layer:** infra
**Status:** Confirmed
**Last updated:** 2026-05-27

## Problem Statement

The backend layer (`002-http-transport-and-oauth/backend`) delivered an HTTP entry point (`dist/http/server.js`) but no way to ship it. The fork charter (PRD §4.2) calls for a container image we control, a reproducible local stack, and a controlled cluster rollout. This layer adds the Dockerfile, Docker Compose stack, and a Helm chart modelled on the sibling `cin7-mcp` deployment.

It also carries one **backend prerequisite** the deployment design forced: the rotated Xero refresh token must persist somewhere durable across pod restarts. The backend currently writes it to a file (`XERO_TOKEN_FILE`). A file requires a `ReadWriteOnce` PVC, which complicates single-replica rollouts. **Decision (fork owner): persist the rotated token in Redis instead, so pods stay stateless and no PVC is needed.** This extends `src/clients/xero-client.ts` — already a fork-owned file (feature 001 / ADR-0001 rewrote its entire auth model from Custom Connection to Refresh Token mode) — with a token-store option. The change is **conditional**: file persistence remains the default so the stdio entry (`dist/index.js`, used with Claude Desktop) keeps working without Redis.

> **Layering note.** Per fork-owner decision, the `xero-client.ts` change is folded into this infra spec rather than reopening the committed `002/backend` layer. The spec keeps the two concerns clearly separated: **Part A** (backend prerequisite, `full-tdd`) and **Part B** (deployment artefacts, `verification-only`).

## Goals

- **Part A — Redis token persistence (backend):** Add a `XERO_TOKEN_STORE` env var (`file` | `redis`, default `file`). When `redis`, the rotated refresh token is read from and written to Redis (via `REDIS_URL`) instead of the filesystem. Default `file` preserves the existing stdio/local-dev behaviour byte-for-byte.
- **Part B — Container image:** A multi-stage `Dockerfile` producing a hardened, non-root `node:22-bookworm-slim` image whose entry point is the HTTP server.
- **Part B — Local stack:** `compose.yml` + `compose.override.yml` running the backend plus a local Valkey, bootable with zero config in `ENVIRONMENT=local`.
- **Part B — Helm chart:** `charts/xero-mcp/` modelled on cin7-mcp's chart — Deployment, Service, Ingress, helpers — with `replicaCount: 1`, no PVC, Redis-backed token persistence wired via env, and a pre-provisioned Secret consumed via `envFrom`.
- The deployment artefacts (`Dockerfile`, `compose*.yml`, `.dockerignore`, `charts/`) are all new files at paths the codebase doesn't yet use. The only existing file touched is `src/clients/xero-client.ts` (already fork-owned per ADR-0001) for the token-store option.

## Non-Goals

- **CI image build + push, registry auth, image scanning, version bumps** — the `ci-cd` layer, a separate feature.
- **Deploying Valkey/Redis** — the chart consumes a pre-provisioned Redis-compatible service via `REDIS_URL`; it does not provision one (mirrors cin7-mcp). Local compose bundles Valkey for dev convenience only.
- **A real cluster apply** — `helm lint` + `helm template` are the acceptance bar here; live `helm install` against a cluster is deferred to whoever cuts the release.
- **PVC / `ReadWriteOnce` storage** — eliminated by the Redis-token-persistence decision.
- **Encryption at rest of the token in Redis** — explicit follow-up (same posture as the OAuth-state-in-Redis follow-up from ADR-0003).
- **Rate limiting, response cache** — not part of this server (cin7-mcp's `cache.*` and `rateLimit.*` values are intentionally absent from this chart).

## Functional Requirements

### Part A — Redis token persistence (backend, `full-tdd`)

1. **FR-1 — `XERO_TOKEN_STORE` selector.** `src/clients/xero-client.ts` MUST read `XERO_TOKEN_STORE` (one of `file` | `redis`; default `file` when unset or any other value). The selection determines whether the refresh token is persisted to the filesystem (existing behaviour) or to Redis.

2. **FR-2 — File mode unchanged.** When `XERO_TOKEN_STORE` is `file` (or unset), token resolution and persistence MUST behave exactly as today: read `XERO_TOKEN_FILE` (default `~/.xero-mcp/refresh_token`) with `XERO_REFRESH_TOKEN` env fallback; write rotated tokens to the file with `0600`. No Redis connection is made. This preserves the stdio entry (`dist/index.js`) and local-dev usage with no Redis dependency.

3. **FR-3 — Redis mode resolution.** When `XERO_TOKEN_STORE=redis`, on startup the client MUST resolve the refresh token in this priority: (1) the Redis key (default `xero:refresh_token`, overridable via `XERO_TOKEN_REDIS_KEY`); (2) the `XERO_REFRESH_TOKEN` env seed if the key is absent/empty; (3) throw with a clear message directing the user to obtain a token via the Xero API Explorer.

4. **FR-4 — Redis mode persistence.** When `XERO_TOKEN_STORE=redis`, after every successful token exchange the client MUST write the rotated refresh token to the Redis key (no TTL — the token must not expire out of the store). The filesystem MUST NOT be written in this mode.

5. **FR-5 — Redis connection requirement (fail-loud).** When `XERO_TOKEN_STORE=redis` and `REDIS_URL` is unset/empty, the client MUST throw at startup with a message naming `REDIS_URL`. When `XERO_TOKEN_STORE=redis` and Redis is unreachable at startup, the client MUST throw (fail-loud, consistent with `xero-client.ts`'s existing pattern).

6. **FR-6 — Async persistence methods.** Redis I/O is async; the token resolve/persist paths MUST be converted to async as needed and awaited within the existing `authenticate()` / `scheduleRefresh()` flows. The scheduled-refresh crash-on-failure behaviour (existing `process.exit(1)`) MUST be preserved.

7. **FR-7 — `.env.example` updated additively.** Append `XERO_TOKEN_STORE` (and `XERO_TOKEN_REDIS_KEY` if introduced) to `.env.example` with comments, near the existing `XERO_TOKEN_FILE` block. Existing entries unchanged.

### Part B — Container image (`verification-only`)

8. **FR-8 — Multi-stage Dockerfile.** A `Dockerfile` at repo root MUST:
   - Builder stage `node:22-bookworm-slim`: `npm ci`, `npm run build`, `npm prune --omit=dev`.
   - Runtime stage `node:22-bookworm-slim`: `apt-get upgrade -y` for CVE patches; create UID/GID 10001 `appuser:appgroup`; copy `dist/`, `node_modules/`, `package.json` from the builder with correct ownership.
   - `ENV XERO_TOKEN_FILE=/app/.xero-mcp/refresh_token`, `MCP_BIND_HOST=0.0.0.0`, `MCP_BIND_PORT=8000` (the token-file ENV remains a harmless default; Redis mode ignores it).
   - `EXPOSE 8000`; `HEALTHCHECK` using `node -e "...http.get('http://localhost:8000/livez')..."` (no curl in slim image).
   - `USER 10001:10001`; `ENTRYPOINT ["node", "/app/dist/http/server.js"]`.

9. **FR-9 — `.dockerignore`.** MUST exclude `.git/`, `.github/`, `.specs/`, `.claude/`, `.vscode/`, `coverage/`, `node_modules/`, `dist/` (rebuilt in-image), `compose*.yml`, `charts/`, `.env*`.

### Part B — Compose (`verification-only`)

10. **FR-10 — `compose.yml`.** Two services: `valkey` (`valkey/valkey:9.0.4`, healthcheck `valkey-cli ping`) and `backend` (builds from `.`, image `xero-mcp:latest`, `depends_on` valkey healthy, `env_file: .env` optional, `ENVIRONMENT=local`, `REDIS_URL=redis://valkey:6379/0`, healthcheck on `/livez` via `node -e`).

11. **FR-11 — `compose.override.yml`.** Local-dev overrides: `restart: "no"`, publish `8000:8000`, bind-mount `./.xero-mcp:/app/.xero-mcp` so the file-mode rotated token survives `docker compose down` (local defaults to `XERO_TOKEN_STORE=file`), and `develop.watch` rebuilding on `./src` and `./package.json` changes.

### Part B — Helm chart (`verification-only`)

12. **FR-12 — Chart skeleton.** `charts/xero-mcp/` MUST contain `Chart.yaml` (name `xero-mcp`, version/appVersion `0.0.0`), `.helmignore`, and `templates/_helpers.tpl` (same `backend.*` helper naming as cin7-mcp).

13. **FR-13 — Deployment template.** MUST render a Deployment with:
   - `replicas: {{ .Values.replicaCount }}` (default `1`, with a comment explaining the token-rotation rationale).
   - `strategy.type: RollingUpdate` (default; documented that a brief 2-pod overlap on deploy may transiently double the token-rotation timer, which is self-healing via crash-restart reading the latest token from Redis).
   - Pod `securityContext`: runAsNonRoot, runAsUser/Group 10001. Container `securityContext`: `readOnlyRootFilesystem: true`, `allowPrivilegeEscalation: false`, drop ALL capabilities.
   - A `tmp` `emptyDir` mounted at `/tmp` (covers any incidental writes under read-only root FS; no token file is written in Redis mode).
   - `livenessProbe` → `/livez`, `readinessProbe` → `/readyz`, both on `.Values.service.port`, timings from `.Values.probes.*`.
   - `containerPort: {{ .Values.service.port }}`.
   - `envFrom.secretRef` (when `.Values.envFrom.secretRef.name` set) for XERO_*/ENTRA_*/REDIS_URL.
   - Chart-managed env: `XERO_TOKEN_STORE=redis`; `MCP_SERVER_URL` and `ENTRA_REQUIRED_SCOPES` from `.Values.auth.*` when set; a free-form `.Values.env` map emitted before the managed keys.
   - **No** `CACHE_TTL_SECONDS`, **no** `*_RATE_LIMIT_*`, **no** `FASTMCP_HOME`, **no** PVC volume.
   - `nodeSelector`, `extraVolumes`, `extraVolumeMounts` passthrough like cin7-mcp.

14. **FR-14 — Service template.** ClusterIP Service on `.Values.service.port` (default `8000`), selector via helper labels. Verbatim shape from cin7-mcp.

15. **FR-15 — Ingress template.** Gated on `.Values.ingress.enabled` (default `false`). When enabled: `ingressClassName: tailscale`, annotation `tailscale.com/funnel: "true"`, host from `.Values.ingress.host`, TLS with `.Values.ingress.tls.secretName` (empty is valid — Tailscale manages the cert). MUST `fail` with a clear message if `ingress.enabled` is true but `ingress.host` is empty.

16. **FR-16 — values.yaml.** MUST contain: `replicaCount: 1`; `image.repository: oldschoolbrand.azurecr.io/xero-mcp/backend`, `image.tag: ""`, `image.pullPolicy: IfNotPresent`; `service.type: ClusterIP`, `service.port: 8000`; `resources` requests `100m`/`384Mi`, limits `500m`/`1Gi`; `envFrom.secretRef.name: ""`; `auth.publicUrl: ""`, `auth.requiredScopes: ""`; `env: {}`; `ingress.{enabled:false,host:"",tls.secretName:""}`; `probes.{liveness,readiness}` timings matching cin7-mcp; `extraVolumes: []`, `extraVolumeMounts: []`, `nodeSelector: {}`. **No** `cache`, `rateLimit`, or `tokenPersistence`/PVC keys.

### Documentation

17. **FR-17 — Capture the token-store decision in design.md.** The `design.md` for this layer MUST record the rationale for the conditional Redis token store (why Redis over a PVC for deployed mode; the `file` default; the no-encryption-at-rest follow-up; the RollingUpdate rotation-overlap behaviour). No standalone ADR is created — `xero-client.ts` is already fork-owned per ADR-0001, so this is a normal evolution of that file, not a new architectural divergence to record separately.

18. **FR-18 — REPO.md + GLOSSARY.md.** Update `.specs/REPO.md` (add Docker/compose/Helm to the deployment story; add `XERO_TOKEN_STORE` to the env-var list) and `.specs/GLOSSARY.md` (add **Token store**; reconcile the existing **Token file** entry to note it's the `file`-mode backend).

## Acceptance Criteria

- **AC-1 — File mode is the default and unchanged**
  - Given: `XERO_TOKEN_STORE` unset, a valid token file, `XERO_CLIENT_ID`/`SECRET` set
  - When: the client authenticates and later rotates
  - Then: the rotated token is written to `XERO_TOKEN_FILE` with `0600`; no Redis connection is attempted

- **AC-2 — Redis mode resolves from the Redis key**
  - Given: `XERO_TOKEN_STORE=redis`, `REDIS_URL` set, the Redis key `xero:refresh_token` holds a token
  - When: the server starts
  - Then: the client uses the Redis-stored token for the exchange (not the `XERO_REFRESH_TOKEN` env seed)

- **AC-3 — Redis mode seeds from env when key absent**
  - Given: `XERO_TOKEN_STORE=redis`, `REDIS_URL` set, the Redis key is absent, `XERO_REFRESH_TOKEN` set
  - When: the server starts
  - Then: the client uses the env seed for the first exchange, then writes the rotated token to the Redis key

- **AC-4 — Redis mode persists rotations to Redis, not file**
  - Given: `XERO_TOKEN_STORE=redis` and a running server
  - When: a token rotation occurs (scheduled refresh)
  - Then: the new refresh token is written to the Redis key; the token file is not written

- **AC-5 — Redis mode fail-loud without REDIS_URL**
  - Given: `XERO_TOKEN_STORE=redis`, `REDIS_URL` unset
  - When: the server starts
  - Then: it throws at startup with a message naming `REDIS_URL`

- **AC-6 — Image builds and boots**
  - Given: the Dockerfile
  - When: `docker build -t xero-mcp:test .`
  - Then: build exits 0; the image runs as UID 10001; `ENTRYPOINT` is `node /app/dist/http/server.js`

- **AC-7 — Compose stack serves /livez**
  - Given: `compose.yml` + `compose.override.yml`, valid `.env`
  - When: `docker compose up --build`
  - Then: `curl -fsS http://localhost:8000/livez` returns 200; Valkey is reachable from the backend container

- **AC-8 — Helm lint + template are clean**
  - Given: `charts/xero-mcp/`
  - When: `helm lint charts/xero-mcp` and `helm template charts/xero-mcp --set envFrom.secretRef.name=xero-secrets --set auth.publicUrl=https://x/ --set auth.requiredScopes=mcp`
  - Then: lint passes; template renders valid YAML with a Deployment (replicaCount 1, RollingUpdate, readOnlyRootFilesystem, runAsNonRoot 10001, `XERO_TOKEN_STORE=redis` env, no PVC), a ClusterIP Service on 8000, and no Ingress

- **AC-9 — Ingress toggles and guards**
  - Given: the chart
  - When: `helm template ... --set ingress.enabled=true --set ingress.host=xero.tail.ts.net`
  - Then: an Ingress renders with `ingressClassName: tailscale` and the funnel annotation
  - And: `--set ingress.enabled=true` without `ingress.host` fails with a clear error

- **AC-10 — No PVC anywhere in the chart**
  - Given: the rendered chart
  - When: `helm template charts/xero-mcp` is grepped
  - Then: there is no `kind: PersistentVolumeClaim` and no `persistentVolumeClaim` volume

- [ ] Token-store rationale captured in `design.md` (no standalone ADR)
- [ ] `.env.example` updated with `XERO_TOKEN_STORE` (+ `XERO_TOKEN_REDIS_KEY` if used); existing entries unchanged
- [ ] `.specs/REPO.md` and `.specs/GLOSSARY.md` updated
- [ ] Only new files + `src/clients/xero-client.ts` are changed (no other existing `src/` file touched)

## Dependencies

- `002-http-transport-and-oauth/backend` — the HTTP entry point, `/livez`/`/readyz`, settings, and the existing Redis client usage (OAuth DCR store) this builds on.
- `redis` (node-redis v4) — already a dependency; reused for token persistence.
- A pre-provisioned Redis-compatible service in non-local environments (operator-supplied via `REDIS_URL`).
- Azure Container Registry `oldschoolbrand.azurecr.io` (image push handled by the future `ci-cd` layer).
- `helm` and `docker` available locally for the verification ACs.

## Open Questions

None — all decisions resolved during requirements interview.

## Glossary additions

- **Token store** — The persistence backend for the rotated Xero refresh token, selected by `XERO_TOKEN_STORE`: `file` (default; local/stdio) or `redis` (deployed). Generalises the older file-only model. Aliases to avoid: "token cache" (implies access-token caching, which remains out of scope).
- **XERO_TOKEN_STORE** — Env var choosing the **Token store** backend (`file` | `redis`, default `file`). Aliases to avoid: none.
