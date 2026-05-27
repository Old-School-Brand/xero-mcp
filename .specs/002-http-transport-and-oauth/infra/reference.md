# Reference: Deployment Artefacts + Redis Token Persistence
**Layer:** infra
**Last updated:** 2026-05-27
**Source:** Context7 library documentation (node-redis, vitest, helm.sh) + direct reading of cin7-mcp reference files and existing repo source

## Overview

This reference covers four technology areas used in the two-phase implementation. Phase A extends `src/clients/xero-client.ts` with a Redis-backed token store using node-redis v4 (already installed at `^4.7.1`), tested via Vitest module mocking. Phase B adds Dockerfile, Docker Compose, and a Helm chart modelled directly on the cin7-mcp sibling project. The Dockerfile, Compose, and Helm sections are drawn from reading the actual cin7-mcp files at `/Users/llewellyn/Code/cin7-mcp/` and translating the Node-specific differences. The node-redis and Vitest sections reconcile the published v4 API against the already-written `src/http/server.ts` (the live connection pattern the repo already uses) and the existing `src/__tests__/clients/xero-client.test.ts` (the mock pattern the new Redis tests must coexist with).

---

## node-redis v4 (`redis@^4.7.1`)

### Key APIs

- `createClient({ url })` — creates a client instance. Does not connect automatically. Pass `url` as a `redis://...` string.
- `await client.connect()` — establishes the TCP connection. Throws if the server is unreachable.
- `await client.get(key)` — returns `string | null`. Returns `null` when the key does not exist (not `undefined`, not `""`).
- `await client.set(key, value)` — returns `"OK"` or `null`. No TTL, no EX/PX options needed for this feature.
- `await client.ping()` — returns `"PONG"`. Used in `src/http/server.ts` as a startup probe. Not needed in `xero-client.ts` (the connect itself is the proof of reachability).
- `client.isReady` — boolean property. `true` once `connect()` has resolved and the connection is alive. Use this in `ensureRedisClient()` to skip reconnection on subsequent calls.
- `await client.quit()` — sends QUIT then closes gracefully. **Not needed in this feature** (long-lived process-scope client).
- `client.destroy()` — tears down the socket immediately without QUIT. Also not needed; the official README shows `destroy()` as the v4 close method (replacing the old `quit()`).

### TypeScript typing for the lazy client field

The planner flagged `Awaited<ReturnType<typeof import("redis")["createClient"]>>` as unwieldy. The cleanest approach used by `src/http/server.ts` already in this repo is:

```typescript
import type { RedisClientType } from "redis";
```

`RedisClientType` is exported from the `redis` package directly. Use it for the field type annotation; use the dynamic `await import("redis")` only to get the runtime `createClient` value.

```typescript
// At the top of the file — type-only import (zero runtime cost in file mode)
import type { RedisClientType } from "redis";

// Inside RefreshTokenXeroClient:
private tokenRedisClient: RedisClientType | null = null;

private async ensureRedisClient(): Promise<RedisClientType> {
  if (this.tokenRedisClient?.isReady) return this.tokenRedisClient;
  if (!process.env.REDIS_URL) {
    throw new Error("REDIS_URL is required when XERO_TOKEN_STORE=redis");
  }
  const { createClient } = await import("redis");
  const client = createClient({ url: process.env.REDIS_URL });
  await client.connect();
  this.tokenRedisClient = client as RedisClientType;
  return this.tokenRedisClient;
}
```

Note: `import type` is erased by tsc at compile time — the `redis` module is never `require`d / `import`ed at module load when using `import type`. The dynamic `await import("redis")` inside the `async` method is what loads the runtime module, and it only runs when `ensureRedisClient()` is actually called (i.e. only in redis mode).

### The existing connection pattern in this repo

`src/http/server.ts` lines 66–72 show the canonical pattern already in use:

```typescript
import { createClient } from "redis";
import type { RedisClientType } from "redis";

redisClient = createClient({ url: nonLocal.REDIS_URL }) as unknown as RedisClientType;
try {
  await redisClient.connect();
  await redisClient.ping();
} catch {
  throw new Error(`Redis unreachable: ${safeRedisUrl(nonLocal.REDIS_URL)}`);
}
```

`xero-client.ts` uses a similar pattern but without the `as unknown as RedisClientType` cast because the dynamic import returns the v4 client directly, and typing it via `import type { RedisClientType }` from the top-level type import is clean enough. The `ping()` step is omitted in the token store — `connect()` rejecting is sufficient for fail-loud.

### Code Examples

**Resolve from Redis key, fall back to env seed:**

```typescript
private async resolveRefreshTokenAsync(): Promise<string> {
  if (this.tokenStore === "file") {
    return this.resolveRefreshToken();
  }
  const client = await this.ensureRedisClient();
  const token = await client.get(this.tokenRedisKey);
  if (token) return token;                                    // non-null, non-empty
  const envSeed = process.env.XERO_REFRESH_TOKEN;
  if (envSeed) return envSeed;
  throw new Error(
    "No refresh token found. Set XERO_REFRESH_TOKEN to a valid Xero refresh token, " +
    "or obtain one at https://api-explorer.xero.com",
  );
}
```

**Persist to Redis key (no TTL):**

```typescript
private async persistRefreshTokenAsync(token: string): Promise<void> {
  if (this.tokenStore === "file") {
    this.persistRefreshToken(token);
    return;
  }
  const client = await this.ensureRedisClient();
  await client.set(this.tokenRedisKey, token);   // no EX/PX/NX options
}
```

### Configuration

- `createClient({ url: process.env.REDIS_URL })` — the `url` field accepts `redis://host:port/db` or `redis://user:pass@host:port/db`. Credentials in the URL are used automatically by the client.
- No `socket`, `database`, or `password` fields are needed for this feature; the URL carries everything.
- There is no built-in reconnection configuration needed here — the client connects once at startup and is reused for the process lifetime.

### Gotchas

- **v4 vs v5/v6:** Context7 docs reference `client.destroy()` as the close method and show `client.close()` in some newer snippets. In v4.7.1 (the installed version) the correct graceful close is `quit()`; `destroy()` is also present as an immediate teardown. Neither is needed in this feature. Do NOT use `client.close()` — that is a v5+ API.
- **`get()` return type is `string | null`, not `string | undefined`:** The null-check `if (token)` is correct (catches both `null` and empty string). Do not use `!== null` alone if the stored value could be an empty string — an empty string is not a valid token and should fall through to the env seed.
- **`set()` with no options returns `"OK"` for a plain string value.** No need to check the return value for this feature.
- **`import type { RedisClientType }` does not require `redis` to be loaded at runtime.** TypeScript erases it. The module is only loaded when `await import("redis")` executes inside `ensureRedisClient()`. This is intentional: file mode must never load redis.
- **The `as unknown as RedisClientType` cast in `server.ts` is a workaround for an older v4 type mismatch.** When using the dynamic import pattern with `import type`, the cast is not needed — `createClient(...)` from the dynamic import already returns the concrete v4 type.
- **No `error` event listener is registered** in `xero-client.ts` (unlike `server.ts`'s `createClient().on("error", ...)`). This is intentional: the token store client is only ever used inside `ensureRedisClient`, and connection errors are propagated as thrown rejections from `connect()`. The process's unhandled-rejection behaviour handles anything after that.

---

## Vitest module mocking for `redis`

### Key APIs

- `vi.mock("redis", () => ({ ... }))` — factory form. The call is hoisted to the top of the file by Vitest's transform, so it runs before any `import` statements. The factory must return the module shape (an object with the exports, not a default-wrapped object).
- `vi.fn()` — creates a mock function. Use `vi.fn(() => fakeClient)` to make `createClient` return your fake object.
- `mockResolvedValueOnce(value)` — makes the next call to an async mock return a resolved promise with `value`.
- `mockRejectedValueOnce(error)` — makes the next call reject with `error`.
- `vi.stubEnv("VAR", "value")` — stubs `process.env.VAR` for the current test. Restored automatically between tests when `unstubEnvs` is enabled (which it is by default in Vitest 4).
- `vi.resetModules()` — used in `beforeEach` throughout the existing test file. Important for `xero-client.ts` because it is a module-level singleton (`export const xeroClient = new RefreshTokenXeroClient(...)`). After `vi.resetModules()`, a fresh `import("../../clients/xero-client.js")` creates a new instance with fresh constructor state.

### Mocking `redis` alongside existing `vi.mock("node:fs")` and `vi.mock("axios")`

The existing test file already has these at the top level:

```typescript
vi.mock("node:fs", () => ({ readFileSync: vi.fn(), writeFileSync: vi.fn(), ... }));
vi.mock("axios");
```

Add the Redis mock at the same level. All three `vi.mock` calls are hoisted together — order does not matter because Vitest processes them all before any `import` executes.

```typescript
// ─── vi.mock hoisting — must be at module top level ──────────────────────
vi.mock("node:fs", () => ({ ... }));           // existing
vi.mock("axios");                               // existing

vi.mock("redis", () => ({
  createClient: vi.fn(),
}));
```

### Controlling the fake client per test

The `createClient` mock needs to return a fake client object. Use `vi.hoisted` so the fake client object is available both inside the factory and in the test body:

```typescript
const mockRedisClient = vi.hoisted(() => ({
  connect: vi.fn().mockResolvedValue(undefined),
  get: vi.fn(),
  set: vi.fn().mockResolvedValue("OK"),
  isReady: true,
}));

vi.mock("redis", () => ({
  createClient: vi.fn(() => mockRedisClient),
}));
```

Then in individual tests, configure `get` per scenario:

```typescript
// test_redis_resolvesFromKey
mockRedisClient.get.mockResolvedValueOnce("rt_redis_stored_001");

// test_redis_seedsFromEnvWhenKeyAbsent
mockRedisClient.get.mockResolvedValueOnce(null);

// test_redis_throwsWhenKeyAndEnvAbsent
mockRedisClient.get.mockResolvedValueOnce(null);

// test_redis_failLoudWhenRedisUnreachable
mockRedisClient.connect.mockRejectedValueOnce(new Error("Connection refused"));
```

Reset between tests in `beforeEach`:

```typescript
beforeEach(() => {
  vi.resetModules();                                      // fresh singleton
  vi.stubEnv("XERO_CLIENT_ID", "ABC123");
  vi.stubEnv("XERO_CLIENT_SECRET", "DEF456");
  vi.stubEnv("XERO_TOKEN_STORE", "redis");
  vi.stubEnv("REDIS_URL", "redis://localhost:6379/0");
  mockRedisClient.connect.mockResolvedValue(undefined);   // reset to success
  mockRedisClient.get.mockReset();
  mockRedisClient.set.mockResolvedValue("OK");
  mockRedisClient.isReady = true;
});
```

### Dynamic import interop with vi.mock

`ensureRedisClient()` uses `await import("redis")` internally. Vitest intercepts dynamic imports of mocked modules the same way it intercepts static ones — the mock factory result is returned for `await import("redis")` just as it would be for a static `import { createClient } from "redis"`. No special handling is needed.

After `vi.resetModules()` in `beforeEach`, the next `await import("../../clients/xero-client.js")` re-evaluates the module. This creates a new `RefreshTokenXeroClient` instance with `tokenRedisClient = null`, so `ensureRedisClient()` will call `createClient` again. The `vi.mock("redis", ...)` factory is still in effect — it was registered once at hoist time and stays registered for the lifetime of the test file.

### Accessing private methods via `TestableClient`

The existing pattern in the file casts via `client as unknown as TestableClient`. Extend the existing `TestableClient` type to include the new private methods:

```typescript
type TestableClient = {
  resolveRefreshToken(): string;
  resolveRefreshTokenAsync(): Promise<string>;        // new
  persistRefreshTokenAsync(token: string): Promise<void>; // new
  // ... existing fields ...
};
```

### Code Example — complete describe block shape

```typescript
// At file top level alongside existing vi.mock calls:
const mockRedisClient = vi.hoisted(() => ({
  connect: vi.fn().mockResolvedValue(undefined),
  get: vi.fn(),
  set: vi.fn().mockResolvedValue("OK"),
  isReady: true,
}));

vi.mock("redis", () => ({
  createClient: vi.fn(() => mockRedisClient),
}));

// In the test file, after existing sections:
describe("resolveRefreshTokenAsync() — redis mode", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("XERO_CLIENT_ID", "ABC123");
    vi.stubEnv("XERO_CLIENT_SECRET", "DEF456");
    vi.stubEnv("XERO_TOKEN_STORE", "redis");
    vi.stubEnv("REDIS_URL", "redis://localhost:6379/0");
    mockRedisClient.connect.mockResolvedValue(undefined);
    mockRedisClient.get.mockReset();
    mockRedisClient.set.mockResolvedValue("OK");
    mockRedisClient.isReady = true;
  });

  afterEach(() => vi.clearAllMocks());

  it("test_redis_resolvesFromKey", async () => {
    mockRedisClient.get.mockResolvedValueOnce("rt_redis_stored_001");
    const client = await getFreshClient();
    const result = await (client as unknown as TestableClient).resolveRefreshTokenAsync();
    expect(result).toBe("rt_redis_stored_001");
    expect(vi.mocked(fs.readFileSync)).not.toHaveBeenCalled();
  });
  // ... etc.
});
```

### Gotchas

- **`vi.mock` factories cannot reference variables defined in the outer module scope** (they are hoisted before those variables are initialised). Use `vi.hoisted(() => ...)` to create variables that are both hoisted-safe and accessible in the test body. This is the pattern used in the example above for `mockRedisClient`.
- **`vi.resetModules()` in `beforeEach` is required** because `xero-client.ts` constructs the singleton at module scope. Without it, the second import in a test suite reuses the first instance, which may already have `initialised = true` or a stale `tokenRedisClient`.
- **The `redis` mock factory returns a plain string `"redis"` path** — not `import("redis")`. Use `vi.mock("redis", ...)` with the bare string, matching exactly how `ensureRedisClient` does `await import("redis")`.
- **`mockRedisClient.isReady`** is a plain property, not a `vi.fn()`. Set it directly (`mockRedisClient.isReady = false`) to test the "not ready, reconnect" path if needed.
- **Existing 17 file-mode tests must pass unmodified.** File mode tests do not stub `XERO_TOKEN_STORE`, so `process.env.XERO_TOKEN_STORE` is `undefined` in those tests. The constructor reads `process.env.XERO_TOKEN_STORE === "redis" ? "redis" : "file"` — any value other than the string `"redis"` produces `"file"`. Confirm that `vi.stubEnv` in the new Redis describe blocks is isolated by `vi.resetModules()` and does not bleed into the file-mode sections.

---

## Dockerfile (Node 22 multi-stage)

### Pattern

The cin7-mcp Dockerfile at `/Users/llewellyn/Code/cin7-mcp/Dockerfile` is Python-based but the structure is identical. Translate the pattern as follows:

| cin7-mcp (Python) | xero-mcp (Node) |
|---|---|
| `FROM python:3.13-slim AS builder` | `FROM node:22-bookworm-slim AS builder` |
| `uv sync --frozen --no-dev` | `npm ci` |
| `uv sync --frozen --no-dev` (install project) | `npm run build && npm prune --omit=dev` |
| `COPY .venv` and `COPY cin7_mcp/` | `COPY dist/` and `COPY node_modules/` and `COPY package.json` |
| `python -c "import urllib.request; ..."` healthcheck | `node -e "const http = require('http'); ..."` healthcheck |
| `ENTRYPOINT ["python", "-m", "cin7_mcp"]` | `ENTRYPOINT ["node", "/app/dist/http/server.js"]` |

### Key patterns

**Layer caching order matters:** Copy `package.json` and `package-lock.json` first, run `npm ci`, then copy source. This caches the dependency install layer until the lockfile changes.

**`npm prune --omit=dev`** must run after `npm run build` (build uses devDependencies like `typescript`). Prune happens in the builder stage, then only the pruned `node_modules` is copied to runtime.

**No curl in `node:22-bookworm-slim`** — the healthcheck uses Node's built-in `http` module:

```dockerfile
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "const http = require('http'); const req = http.get('http://localhost:8000/livez', (res) => { process.exit(res.statusCode === 200 ? 0 : 1); }); req.on('error', () => process.exit(1));"
```

Note: `require('http')` works in a `node -e` invocation even in an ESM project because `node -e` defaults to CJS context. This is the same one-liner used in `compose.yml`.

**Non-root user creation** — matches cin7-mcp exactly:

```dockerfile
RUN groupadd -g 10001 appgroup \
 && useradd -u 10001 -g appgroup -s /sbin/nologin -M appuser \
 && chown -R appuser:appgroup /app
```

`-M` skips home directory creation. `-s /sbin/nologin` prevents shell login.

**`apt-get upgrade -y --no-install-recommends`** applies OS security patches from the base image. Always followed by `rm -rf /var/lib/apt/lists/*` to keep the layer lean.

**Complete Dockerfile (exact target):**

```dockerfile
# ── Builder stage ─────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build && npm prune --omit=dev

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim
WORKDIR /app

RUN apt-get update \
 && apt-get upgrade -y --no-install-recommends \
 && rm -rf /var/lib/apt/lists/*

RUN groupadd -g 10001 appgroup \
 && useradd -u 10001 -g appgroup -s /sbin/nologin -M appuser \
 && chown -R appuser:appgroup /app

COPY --from=builder --chown=appuser:appgroup /app/dist ./dist/
COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules/
COPY --from=builder --chown=appuser:appgroup /app/package.json ./

ENV XERO_TOKEN_FILE=/app/.xero-mcp/refresh_token
ENV MCP_BIND_HOST=0.0.0.0
ENV MCP_BIND_PORT=8000

EXPOSE 8000

HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "const http = require('http'); const req = http.get('http://localhost:8000/livez', (res) => { process.exit(res.statusCode === 200 ? 0 : 1); }); req.on('error', () => process.exit(1));"

USER 10001:10001
ENTRYPOINT ["node", "/app/dist/http/server.js"]
```

### Gotchas

- **`EXPOSE` is documentation only** — it does not publish the port. Port publication happens in `compose.override.yml` or in the Helm Service.
- **`USER` must come after `chown -R`** — if `USER` precedes the `COPY --chown` instructions, the chown still works (it is a Dockerfile build-time instruction, not a runtime one). But placing `USER` after the `RUN chown` avoids any confusion.
- **`package.json` must be copied to runtime stage** because `dist/http/server.js` uses `createRequire(import.meta.url)` to read `package.json` for the server identity (`name` and `version`). Without it, the server crashes on startup.
- **`dist/` is committed in this repo** (the `package.json` `bin` field points at it) but it should NOT be in the Docker build context — it is rebuilt from source inside the builder stage. The `.dockerignore` excludes `dist/` for this reason.

---

## Docker Compose

### `compose.yml` (production-like base)

The cin7-mcp `compose.yml` at `/Users/llewellyn/Code/cin7-mcp/compose.yml` is the direct model. Key differences for xero-mcp:

- Valkey healthcheck uses `["CMD", "valkey-cli", "ping"]` — identical.
- Backend healthcheck replaces `python -c "import urllib.request; ..."` with the Node one-liner.
- `env_file: [{ path: .env, required: false }]` — identical pattern. Compose won't error if `.env` is absent.
- `ENVIRONMENT=local` and `REDIS_URL=redis://valkey:6379/0` are set in the `environment` block. `XERO_TOKEN_STORE` is intentionally absent (defaults to `file` for local compose dev).

**cin7-mcp difference to note:** cin7-mcp's `compose.yml` publishes `"127.0.0.1:6379:6379"` on the valkey service for external tooling access. xero-mcp's design does not include this (valkey is internal only). The xero-mcp `compose.yml` has no port publishing on valkey.

**`depends_on` with health condition:**

```yaml
depends_on:
  valkey:
    condition: service_healthy
```

This prevents the backend from starting until valkey's healthcheck passes. Compose v2 supports this natively.

### `compose.override.yml` (local-dev)

cin7-mcp's override uses `command: ["python", "-m", "cin7_mcp"]` (to override the entrypoint for local dev). xero-mcp does **not** need a `command:` override — the Dockerfile `ENTRYPOINT` is already correct for both local and deployed use.

cin7-mcp's override uses `action: sync` for Python source files (hot reload without rebuild). For Node with compiled TypeScript, hot reload requires a full rebuild — the watch action is `rebuild` for both `./src` and `./package.json`.

**Complete `compose.override.yml`:**

```yaml
services:
  backend:
    restart: "no"
    ports:
      - "8000:8000"
    volumes:
      - ./.xero-mcp:/app/.xero-mcp
    develop:
      watch:
        - path: ./src
          action: rebuild
        - path: ./package.json
          action: rebuild
```

The `./.xero-mcp:/app/.xero-mcp` bind-mount provides a writable location for the token file when `XERO_TOKEN_STORE=file` (default). Docker Compose creates the host directory automatically if absent.

### Gotchas

- **`restart: "no"` in the override** overrides `restart: always` from the base. This is intentional — local dev should crash visibly rather than restart silently.
- **`develop.watch` requires `docker compose watch`** (not `docker compose up`). It is a compose v2 feature available since Docker Desktop 4.24. `docker compose up --build` still works without watch.
- **The Node healthcheck one-liner uses `require('http')`** (CJS) not `import`. This works in `node -e` regardless of the project's `"type": "module"` setting because `-e` evaluates in a CJS context by default.
- **`env_file.required: false`** means compose will not error if `.env` is absent, but the Node server itself will throw at startup if required vars are missing (the `loadSettings()` zod parse). This is the correct fail-loud behaviour.

---

## Helm Chart

### `Chart.yaml` (apiVersion v2)

```yaml
apiVersion: v2
name: xero-mcp
description: MCP server that wraps the Xero accounting/payroll API.
version: 0.0.0
appVersion: "0.0.0"
```

`apiVersion: v2` is required for Helm 3. `version` is the chart version; `appVersion` is the application version. Both start at `0.0.0` and are bumped by the CI/CD layer.

### `templates/_helpers.tpl`

Direct copy of cin7-mcp's `_helpers.tpl` with `cin7-mcp` replaced by `xero-mcp`. The four helpers are:

```gotemplate
{{- define "backend.name" -}}
{{- .Chart.Name | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "backend.fullname" -}}
{{- printf "%s-backend" .Release.Name | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "backend.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
app.kubernetes.io/name: {{ include "backend.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "backend.selectorLabels" -}}
app.kubernetes.io/name: {{ include "backend.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
```

The chart name `xero-mcp` flows in via `.Chart.Name` — no string literal substitution is needed in the helpers themselves beyond what the chart metadata provides.

### `templates/service.yaml`

Verbatim copy of cin7-mcp's `service.yaml`:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: {{ include "backend.fullname" . }}
  labels:
    {{- include "backend.labels" . | nindent 4 }}
spec:
  type: {{ .Values.service.type }}
  ports:
    - port: {{ .Values.service.port }}
      targetPort: {{ .Values.service.port }}
      protocol: TCP
  selector:
    {{- include "backend.selectorLabels" . | nindent 4 }}
```

### `templates/ingress.yaml`

Verbatim copy of cin7-mcp's `ingress.yaml`. The `{{ fail "..." }}` guard is inside the `{{- if .Values.ingress.enabled }}` block:

```yaml
{{- if .Values.ingress.enabled }}
{{- if not .Values.ingress.host }}
{{ fail "ingress.enabled is true but ingress.host is empty — set ingress.host to the Tailscale Funnel hostname" }}
{{- end }}
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: {{ include "backend.fullname" . }}
  labels:
    {{- include "backend.labels" . | nindent 4 }}
  annotations:
    tailscale.com/funnel: "true"
spec:
  ingressClassName: tailscale
  rules:
    - host: {{ .Values.ingress.host | quote }}
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: {{ include "backend.fullname" . }}
                port:
                  number: {{ .Values.service.port }}
  tls:
    - hosts:
        - {{ .Values.ingress.host | quote }}
      secretName: {{ .Values.ingress.tls.secretName | quote }}
{{- end }}
```

### `templates/deployment.yaml`

Model: cin7-mcp's `deployment.yaml` with these specific substitutions:

1. Add `strategy: { type: RollingUpdate }` above the `replicas` line.
2. Replace the cin7-mcp env block (`FASTMCP_HOME`, `CACHE_TTL_SECONDS`, `*_RATE_LIMIT_*`) with xero-mcp's chart-managed keys.
3. Everything else (pod securityContext, container securityContext, probes, resources, volumeMounts, extraVolumes, envFrom.secretRef guard, nodeSelector) is identical.

**The env block for xero-mcp:**

```yaml
          env:
            {{- if .Values.auth.publicUrl }}
            - name: MCP_SERVER_URL
              value: {{ .Values.auth.publicUrl | quote }}
            {{- end }}
            {{- if .Values.auth.requiredScopes }}
            - name: ENTRA_REQUIRED_SCOPES
              value: {{ .Values.auth.requiredScopes | quote }}
            {{- end }}
            # Free-form env overrides emitted first so chart-managed keys win on
            # duplicate-key resolution (Kubernetes uses last occurrence).
            {{- range $key, $val := .Values.env }}
            - name: {{ $key }}
              value: {{ $val | quote }}
            {{- end }}
            # Chart-managed: always set for deployed mode.
            - name: XERO_TOKEN_STORE
              value: "redis"
```

The `XERO_TOKEN_STORE: redis` entry is last so it overrides any `XERO_TOKEN_STORE` placed in `.Values.env`.

**The `envFrom` block (conditional on secretRef being set):**

```yaml
          {{- if .Values.envFrom.secretRef.name }}
          envFrom:
            - secretRef:
                name: {{ .Values.envFrom.secretRef.name | quote }}
          {{- end }}
```

This is the exact pattern from cin7-mcp.

**Pod `securityContext` (verbatim from cin7-mcp):**

```yaml
      securityContext:
        runAsUser: 10001
        runAsGroup: 10001
        runAsNonRoot: true
```

**Container `securityContext` (verbatim from cin7-mcp):**

```yaml
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop:
                - ALL
```

**Volumes and mounts — only `/tmp` emptyDir plus passthrough:**

```yaml
      volumes:
        - name: tmp
          emptyDir: {}
        {{- with .Values.extraVolumes }}
        {{- toYaml . | nindent 8 }}
        {{- end }}
      # ...
          volumeMounts:
            - name: tmp
              mountPath: /tmp
            {{- with .Values.extraVolumeMounts }}
            {{- toYaml . | nindent 12 }}
            {{- end }}
```

No PVC, no `FASTMCP_HOME` volume. The `/tmp` emptyDir is sufficient because `readOnlyRootFilesystem: true` requires at least one writable path and Node occasionally writes to `/tmp` for temp files.

**`nodeSelector` passthrough:**

```yaml
      {{- with .Values.nodeSelector }}
      nodeSelector:
        {{- toYaml . | nindent 8 }}
      {{- end }}
```

### Helm verification commands

```bash
# Lint (must exit 0)
helm lint charts/xero-mcp

# Render with typical values (check for valid YAML and expected keys)
helm template xero-mcp charts/xero-mcp \
  --set envFrom.secretRef.name=xero-secrets \
  --set auth.publicUrl=https://x/ \
  --set auth.requiredScopes=mcp

# Render ingress (check for tailscale class)
helm template xero-mcp charts/xero-mcp \
  --set ingress.enabled=true \
  --set ingress.host=xero.tail.ts.net \
  | grep ingressClassName

# Guard message when host is empty
helm template xero-mcp charts/xero-mcp \
  --set ingress.enabled=true 2>&1 | grep "ingress.host is empty"

# Confirm no PVC
helm template xero-mcp charts/xero-mcp | grep -c PersistentVolumeClaim
# Expected: 0
```

### Gotchas

- **`{{ fail "..." }}`** causes `helm template` and `helm install` to exit non-zero with the message printed to stderr. The message is visible via `2>&1` in the verification command. The call must be inside the `{{- if .Values.ingress.enabled }}` block, not at the top level, so it only fires when ingress is enabled.
- **`include` vs `template`:** Always use `include` (not `template`) when the output needs to be piped through `nindent` or other functions. `template` renders in place without pipeline support.
- **`{{- with .Values.nodeSelector }}`** — the `{{- with }}` block skips the body entirely if the value is empty/nil/falsy. This is the correct guard for optional passthrough maps like `nodeSelector`, `extraVolumes`, `extraVolumeMounts`.
- **`| quote`** on env var values — always quote values in the `env:` block. Bare integers or booleans in Kubernetes env are valid YAML but some values (like `"0.0.0.0"`) can be misinterpreted without quotes.
- **`helm lint` requires `templates/` to exist** — run B4 (Chart.yaml + helpers) before B5/B6/B7, because `helm lint` is the acceptance test for B4 and the chart must be structurally valid from that point on.
- **`.helmignore`** is a copy of cin7-mcp's — covers `.git/`, `*.swp`, `*.bak`, `*.tmp`, `*.orig`, `*~`, `.idea/`, `.vscode/`, `*.tgz`. It does not exclude `.DS_Store` by default in the standard template but cin7-mcp's file includes it. Copy verbatim.

---

## Cross-Boundary Reference Map

| Source | Output | Format | Consumed By | Input | Expected Format | Match? |
|---|---|---|---|---|---|---|
| `createClient({ url })` in `ensureRedisClient()` | redis client instance | `RedisClientType` (node-redis v4) | `client.get(key)` / `client.set(key, value)` | first arg = key string | `string` | YES |
| `client.get(this.tokenRedisKey)` | stored refresh token | `string \| null` | `resolveRefreshTokenAsync()` null check `if (token)` | token value | non-null, non-empty string | YES — `null` and `""` both falsy, fall-through to env seed |
| `client.set(this.tokenRedisKey, token)` | sets Redis key | `"OK"` returned | — (fire and forget, return value unused) | — | — | YES |
| `vi.mock("redis", factory)` | mocked `createClient` | `vi.fn(() => mockRedisClient)` | `await import("redis")` inside `ensureRedisClient()` | `createClient` export | function returning a client-shaped object | YES — Vitest intercepts dynamic imports of mocked modules |
| `mockRedisClient.get` | `mockResolvedValueOnce(v)` | `Promise<string \| null>` | `await client.get(key)` in `resolveRefreshTokenAsync()` | resolved value | `string \| null` | YES |
| `Dockerfile ENTRYPOINT` | `["node", "/app/dist/http/server.js"]` | absolute path inside container | `docker inspect` / Kubernetes pod spec | entrypoint array | array of strings | YES |
| `compose.yml REDIS_URL` | `redis://valkey:6379/0` | Redis URL with compose service hostname | `createClient({ url: process.env.REDIS_URL })` in both `server.ts` and `xero-client.ts` | `url` config key | `redis://...` connection string | YES — `valkey` resolves within the compose network |
| Helm `envFrom.secretRef.name` | Kubernetes Secret name | plain string | `envFrom[].secretRef.name` in Deployment spec | secret name | string | YES |
| Helm `env: XERO_TOKEN_STORE: "redis"` | env var in pod | string `"redis"` | `process.env.XERO_TOKEN_STORE === "redis"` in constructor | string comparison | string `"redis"` | YES |

---

## Not Found

All libraries were resolved via Context7 or direct file reading. No library fell back to "not found."
