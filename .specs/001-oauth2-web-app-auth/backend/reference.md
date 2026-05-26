# Reference: OAuth2 Web App Auth Flow
**Layer:** backend
**Last updated:** 2026-05-25
**Source:** Context7 library documentation / official web docs / codebase inspection

## Overview

This reference covers the four external libraries and one built-in Node.js namespace used
in `src/clients/xero-client.ts` and `src/__tests__/clients/xero-client.test.ts`:
**Vitest** (ESM + TypeScript test runner with mocking and fake timers),
**axios** (HTTP POST with Basic auth and form-encoded body),
**Node.js `fs`** (`readFileSync`, `writeFileSync`, `existsSync`, and file modes),
**Node.js `os`/`path`** (`homedir`, `join`, `dirname`), and
**xero-node `XeroClient`** (`setTokenSet`, `updateTenants`).
The xero-node section also documents the exact shape of the object that `setTokenSet` accepts,
which is the primary cross-boundary concern in this feature.

---

## Vitest

### Key APIs

- `vi.mock('node:fs', ...)` — replaces the `node:fs` module before the test file imports it. Because `vi.mock` is hoisted to the top of the file, the factory runs before any `import` statement in the test file.
- `vi.mock('node:fs', { spy: true })` — keeps the real `fs` implementation but makes every export a spy. Use when you want `existsSync` to return its real value for _most_ cases and only stub specific paths.
- `vi.mock('axios')` — replaces the `axios` module entirely. The factory must return `{ default: vi.fn(), ... }` because axios uses a default export.
- `vi.stubEnv('VAR_NAME', 'value')` — sets `process.env.VAR_NAME` for the duration of the test. Automatically restored when `unstubEnvs: true` is set in `vitest.config.ts`, or when `vi.unstubAllEnvs()` is called.
- `vi.resetModules()` — clears the module registry so the next dynamic `import()` re-executes module-level code. Required for testing module-level `throw`s (like the env var validation at module load time).
- `vi.useFakeTimers()` / `vi.useRealTimers()` — replaces `setTimeout`/`setInterval`/`Date` with controllable fakes.
- `vi.advanceTimersByTime(ms)` — advances fake time by `ms` milliseconds, firing all timers that would have elapsed.
- `vi.advanceTimersByTimeAsync(ms)` — same as above but awaits any async callbacks triggered by timers. Needed when the timer callback is `async`.
- `vi.runAllTimers()` — runs every pending timer to completion.
- `vi.fn()` — creates a mock function. Supports `.mockReturnValue()`, `.mockResolvedValue()`, `.mockRejectedValue()`, `.mockImplementation()`.
- `vi.spyOn(object, 'method')` — wraps an existing method. Call `.mockImplementation()` on the return value to stub it.
- `vi.mocked(fn)` — type helper; casts `fn` to `Mock<T>` for typed assertions. No runtime effect.

### Code Examples

**Testing module-level throw (env var missing at import time)**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('startup env validation', () => {
  beforeEach(() => {
    vi.resetModules() // clear module registry before each test
  })

  it('throws when XERO_CLIENT_ID is missing', async () => {
    vi.stubEnv('XERO_CLIENT_ID', '')
    vi.stubEnv('XERO_CLIENT_SECRET', 'secret')

    await expect(import('../clients/xero-client.js')).rejects.toThrow(
      'XERO_CLIENT_ID is required'
    )
  })
})
```

**Mocking `node:fs` with a full factory**

```typescript
vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(),
}))
```

**Mocking `node:fs` with spy (keeps real implementation, adds tracking)**

```typescript
import * as fs from 'node:fs'
vi.mock('node:fs', { spy: true })

// In test:
vi.mocked(fs.readFileSync).mockImplementation(() => 'rt_from_file')
```

**Mocking axios**

```typescript
import axios from 'axios'
vi.mock('axios')

// In test:
vi.mocked(axios.post).mockResolvedValue({
  data: { access_token: 'at_new', refresh_token: 'rt_rotated', expires_in: 1800, token_type: 'Bearer' }
})
```

**Fake timers — advance time and run async timer callback**

```typescript
import { beforeEach, afterEach, it, vi } from 'vitest'

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

it('fires the refresh timer at expires_in - 300 seconds', async () => {
  // set up the client so a timer is scheduled with expiresIn=1800
  // ...

  // advance by 1500 * 1000ms (1800 - 300)
  await vi.advanceTimersByTimeAsync(1500 * 1000)

  expect(axiosPostMock).toHaveBeenCalledTimes(2) // startup + scheduled refresh
})
```

**Checking timer `unref()` was called**

`setTimeout` returns a `NodeJS.Timeout` whose `.unref()` method is what detaches it from the event loop. To assert it was called, spy on the timer handle returned by `setTimeout`. The simplest pattern is to spy on the global `setTimeout`:

```typescript
const timeoutSpy = vi.spyOn(globalThis, 'setTimeout')
// ... trigger scheduleRefresh ...
const handle = timeoutSpy.mock.results[0].value as NodeJS.Timeout
// If unref() was called, the handle will have been called with unref
// Alternatively, spy on the handle's .unref method:
const unrefSpy = vi.spyOn(handle, 'unref')
// But the cleanest approach is to use a fake timer environment where
// unref is tracked automatically by vi.useFakeTimers().
```

### Configuration

Minimal `vitest.config.ts` for ESM + TypeScript (no Vite needed — Vitest can run standalone):

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    unstubEnvs: true,   // auto-restore vi.stubEnv() after each test
    unstubGlobals: true // auto-restore vi.stubGlobal() after each test
  }
})
```

Without a config file, Vitest still works for the simple case. Add the config only if the test runner complains (the todo.md marks this as not-anticipated).

### Gotchas

- **`vi.mock` is hoisted.** Even if written after imports, it runs before them. This is why mocking `node:fs` works even though the module under test imports `fs` at the top.
- **`vi.resetModules()` is required for module-level code.** The env var validation runs at module load time. Without calling `vi.resetModules()` in `beforeEach`, the module is only imported once and subsequent tests see the cached (already-thrown) module.
- **Dynamic import must be used after `vi.resetModules()`.** Static `import` is resolved at parse time. Use `await import('./path.js')` inside the `it` block after calling `vi.resetModules()`.
- **`vi.advanceTimersByTimeAsync` vs `vi.advanceTimersByTime`.** The timer callback in `scheduleRefresh` is `async`. Use the `Async` variant to correctly await its resolution and avoid unhandled rejection warnings.
- **`axios` default export.** When mocking axios entirely with a factory, ensure the mock includes `default` if the module is imported with `import axios from 'axios'`. Using `vi.mock('axios')` auto-mocks axios — then `vi.mocked(axios.post).mockResolvedValue(...)` works without a factory.
- **`process.exit` must be mocked.** Tests that verify `process.exit(1)` is called on scheduled refresh failure will cause Vitest to exit unless `process.exit` is spied on first: `vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)`.

---

## axios

### Key APIs

- `axios.post(url, data, config)` — makes an HTTP POST. `data` can be a string, object, or `URLSearchParams`. `config` includes `headers`, `auth`, etc.
- `config.headers` — plain object of request headers. Set `'Content-Type': 'application/x-www-form-urlencoded'` for form-encoded bodies.
- `config.auth` — convenience option for HTTP Basic auth. Automatically sets the `Authorization: Basic <base64>` header. **This is an alternative to building the header manually**, but the existing code in `xero-client.ts` builds it manually with `Buffer.from(...).toString('base64')` — match that pattern.
- `response.data` — the parsed response body (Axios auto-parses JSON).
- `AxiosError` — the error class thrown when Axios receives a non-2xx response. `error.response?.data` contains the server's error body; `error.response?.status` is the HTTP status code.

### Code Examples

**POST with manual Basic auth and form-encoded body (matches existing codebase pattern)**

```typescript
import axios, { AxiosError } from 'axios'

const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

const response = await axios.post(
  'https://identity.xero.com/connect/token',
  `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
  {
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  }
)

const { access_token, refresh_token, expires_in, token_type } = response.data
```

**Catching and inspecting AxiosError**

```typescript
try {
  const response = await axios.post(url, body, config)
  return response.data
} catch (error) {
  if (error instanceof AxiosError) {
    const serverError = error.response?.data  // e.g. { error: 'invalid_grant' }
    const status = error.response?.status     // e.g. 400
    throw new Error(`Token exchange failed (${status}): ${JSON.stringify(serverError)}`)
  }
  throw error
}
```

### Configuration

- **`Content-Type: application/x-www-form-urlencoded`** — required for Xero's token endpoint. When `data` is a plain string, Axios does not automatically set Content-Type, so it must be set explicitly in `headers`.
- **`Accept: application/json`** — the existing `requestToken()` sets this; maintain it in `exchangeToken()` for consistency.

### Gotchas

- **String body bypasses JSON serialisation.** Passing a raw string as `data` (e.g. `"grant_type=refresh_token&..."`) means Axios sends it as-is with no Content-Type defaulting. Always set `Content-Type` explicitly.
- **`encodeURIComponent` on the refresh token.** Refresh tokens may contain characters that are not safe in URL-encoded form. Always wrap the token value with `encodeURIComponent(refreshToken)`.
- **`AxiosError` is the correct import.** It is a named export: `import axios, { AxiosError } from 'axios'`. The existing file already imports it this way.
- **`error.response` may be undefined.** A network error (DNS failure, timeout) produces an `AxiosError` with no `response`. Always use `error.response?.data` with optional chaining.

---

## Node.js `fs`

### Key APIs

- `fs.readFileSync(path, 'utf-8')` — reads a file synchronously, returns a `string` when encoding is specified. Throws `ENOENT` if the file does not exist.
- `fs.writeFileSync(path, data, options)` — writes a string to a file synchronously. `options.mode` sets Unix file permissions.
- `fs.existsSync(path)` — returns `boolean`. Does not throw. Use to check whether a directory exists before writing.

### Code Examples

**Read file, trim whitespace, fall through on any error**

```typescript
import * as fs from 'node:fs'

try {
  const token = fs.readFileSync(tokenFilePath, 'utf-8').trim()
  if (token) return token
} catch {
  // file does not exist — fall through to next source
}
```

**Write file with 0600 permissions**

```typescript
fs.writeFileSync(tokenFilePath, token, { mode: 0o600 })
```

**Check directory exists before writing**

```typescript
import * as path from 'node:path'

const dir = path.dirname(tokenFilePath)
if (!fs.existsSync(dir)) {
  throw new Error(`Token file directory does not exist: ${dir}. Create it with: mkdir -p ${dir}`)
}
fs.writeFileSync(tokenFilePath, token, { mode: 0o600 })
```

### Configuration

- **`mode: 0o600`** — octal literal for owner read/write only (no access for group or others). The `0o` prefix is required in TypeScript strict mode.
- **`writeFileSync` with `mode`** — mode sets permissions on the _created_ file. If the file already exists, permissions are **not** updated by mode alone. For this feature, the security property is achieved because the directory itself is `~/.xero-mcp/` which the user controls, and the token file is either newly created or overwritten (without changing existing permissions). For strictness, the design could call `fs.chmodSync(path, 0o600)` after writing if the file pre-existed — but the design spec says `writeFileSync` with `mode: 0o600` is sufficient.

### Gotchas

- **`readFileSync` throws on missing file; `existsSync` does not.** The try/catch around `readFileSync` in `resolveRefreshToken` is the correct pattern: attempt to read, catch `ENOENT` (and any other FS error), fall through.
- **`existsSync` is deprecated for race-sensitive operations** (official Node docs recommend open-then-handle-error instead). For this feature the file is tiny and single-process, so `existsSync` is acceptable and matches the design spec.
- **Import as namespace.** The design spec uses `import * as fs from 'node:fs'`. This is the correct ESM pattern for built-ins and matches how Vitest's `vi.mock('node:fs')` intercepts calls.

---

## Node.js `os` and `path`

### Key APIs

- `os.homedir()` — returns the home directory of the current user as an absolute string (e.g. `/Users/alice`). Never ends with a trailing slash.
- `path.join(...parts)` — joins path segments with the platform-appropriate separator. Normalises `..` and `.`.
- `path.dirname(filePath)` — returns the directory portion of a file path (everything up to the last `/`).

### Code Examples

**Resolve default token file path**

```typescript
import * as os from 'node:os'
import * as path from 'node:path'

const tokenFilePath =
  process.env.XERO_TOKEN_FILE ?? path.join(os.homedir(), '.xero-mcp', 'refresh_token')
// e.g. /Users/alice/.xero-mcp/refresh_token
```

**Extract directory from a file path**

```typescript
const dir = path.dirname('/Users/alice/.xero-mcp/refresh_token')
// => '/Users/alice/.xero-mcp'

const dir2 = path.dirname('/tmp/custom-xero-token')
// => '/tmp'
```

### Gotchas

- **`path.join` with `os.homedir()` is cross-platform.** Avoid string concatenation with hardcoded `/` separators.
- **`path.dirname` on a filename without a directory returns `'.'`** (current directory). This cannot happen here because `tokenFilePath` is always an absolute path.

---

## xero-node `XeroClient`

### Key APIs

- `setTokenSet(tokenSet: TokenSetParameters | TokenSet): void` — sets the active token on the XeroClient. Internally creates a new `TokenSet` from `openid-client` using the provided parameters. This makes the token available to all subsequent API calls via the `Authorization: Bearer` header.
- `updateTenants(fullOrgDetails?: boolean): Promise<any[]>` — GETs `/connections` and populates `this.tenants[]`. The overridden version in `MCPXeroClient` also sets `this.tenantId` from `this.tenants[0].tenantId`. Call this once at startup after `setTokenSet`.

### `setTokenSet` accepted shape

The method accepts a `TokenSetParameters` object. The fields used in this feature are:

| Field | Type | Notes |
|---|---|---|
| `access_token` | `string` | Required — the Bearer token |
| `expires_in` | `number` | Optional — seconds until expiry. Internally converted to `expires_at` by openid-client |
| `token_type` | `string` | Optional — typically `"Bearer"` |
| `refresh_token` | `string` | Optional — not needed in the `setTokenSet` call for this feature (we manage the refresh token ourselves) |

The existing codebase at lines 198–203 of `xero-client.ts` shows the correct call pattern:

```typescript
this.setTokenSet({
  access_token: tokenResponse.access_token,
  expires_in:   tokenResponse.expires_in,
  token_type:   tokenResponse.token_type,
})
```

Do not pass `refresh_token` to `setTokenSet` — the `RefreshTokenXeroClient` manages the refresh token in its own `private currentRefreshToken` field.

### Code Examples

**Full startup flow pattern (mirrors `MCPXeroClient` base class usage)**

```typescript
// After exchangeToken() returns tokenData:
this.setTokenSet({
  access_token: tokenData.access_token,
  expires_in:   tokenData.expires_in,
  token_type:   tokenData.token_type,
})
await this.updateTenants()
// this.tenantId is now set by MCPXeroClient.updateTenants()
```

**Scheduled refresh (no `updateTenants` call)**

```typescript
// In the timer callback:
this.setTokenSet({
  access_token: tokenData.access_token,
  expires_in:   tokenData.expires_in,
  token_type:   tokenData.token_type,
})
// Do NOT call updateTenants() — tenant ID is stable across token rotations
```

**Mocking `updateTenants` in tests**

`updateTenants` is defined on `MCPXeroClient` (a class in the same file), so `vi.mock` of the module won't easily stub it. Instead, spy directly on the instance after construction:

```typescript
const updateTenantsSpy = vi
  .spyOn(client as any, 'updateTenants')
  .mockResolvedValue([])
```

Or, because `MCPXeroClient` extends `XeroClient` from `xero-node`, mock the entire `xero-node` module and provide a stub `XeroClient` class with a mocked `updateTenants`.

### Configuration

`XeroClient` constructor accepts `IXeroClientConfig`:

```typescript
const xero = new XeroClient({
  clientId:     'YOUR_CLIENT_ID',
  clientSecret: 'YOUR_CLIENT_SECRET',
  // redirectUris and scopes are not used in this feature
})
```

For `RefreshTokenXeroClient`, the constructor is called with `{ clientId, clientSecret }` only (no `grantType`, no `scopes`).

### Gotchas

- **`setTokenSet` does not store `refresh_token` in a way the SDK uses for auto-refresh.** The `RefreshTokenXeroClient` manages its own refresh cycle via `setTimeout`. Do not expect xero-node to auto-renew.
- **`updateTenants` sets `this.tenantId` via the override in `MCPXeroClient`.** Looking at the override at lines 36–42 of `xero-client.ts`: it calls `super.updateTenants()` then sets `this.tenantId = this.tenants[0].tenantId`. This means `updateTenants()` must be called at least once at startup; after that, `this.tenantId` remains stable.
- **`expires_in` vs `expires_at` in openid-client.** The `TokenSetParameters` type from openid-client v5 accepts `expires_in` as an input but stores it internally as `expires_at`. Passing `expires_in: 1800` is valid and the SDK converts it. Do not pass `expires_at` directly — calculate it from `expires_in` only if needed elsewhere.
- **`XeroClient` is instantiated without `await xero.initialize()` in this design.** The existing `CustomConnectionsXeroClient` does not call `initialize()` either (it calls `axios.post` directly). The new `RefreshTokenXeroClient` follows this same pattern.

---

## Cross-Boundary Reference Map

| Source | Output | Format | Consumed By | Input | Expected Format | Match? |
|---|---|---|---|---|---|---|
| `axios.post(identity.xero.com/connect/token)` | `response.data.access_token` | opaque string (JWT) | `setTokenSet({ access_token })` | `access_token` field of `TokenSetParameters` | `string` | YES |
| `axios.post(identity.xero.com/connect/token)` | `response.data.expires_in` | `number` (seconds, e.g. `1800`) | `setTokenSet({ expires_in })` | `expires_in` field of `TokenSetParameters` | `number` (seconds) | YES — openid-client converts to `expires_at` internally |
| `axios.post(identity.xero.com/connect/token)` | `response.data.refresh_token` | opaque string | `persistRefreshToken(token)` + `this.currentRefreshToken` | raw string written to file / used in next POST body | raw string | YES |
| `axios.post(identity.xero.com/connect/token)` | `response.data.expires_in` | `number` (seconds) | `scheduleRefresh(expiresIn)` | `expiresIn` parameter | `number` (seconds) | YES — `(expiresIn - 300) * 1000` ms |
| `fs.readFileSync(tokenFilePath, 'utf-8')` | file contents | string (may include trailing whitespace / newlines) | `resolveRefreshToken()` return value | refresh token string passed to `exchangeToken()` | clean string, no whitespace | NO — apply `.trim()` before returning |
| `process.env.XERO_TOKEN_FILE` | path string | any string (could be relative or absolute) | `path.dirname(tokenFilePath)` | path argument | must be an absolute path for security | PARTIAL — if user sets a relative path, `path.dirname` will return a relative dir; document that the env var should be an absolute path |
| `setTokenSet(...)` | (mutates internal state) | — | `xero.accountingApi.*` calls in handlers | `Authorization: Bearer <access_token>` header | Bearer token string | YES — xero-node sets the header from the token set automatically |

---

## Not Found

All libraries were successfully resolved via Context7 and/or codebase inspection. No fallback gaps remain.
