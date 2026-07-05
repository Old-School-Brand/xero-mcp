# Reference: OAuth-Proxy Bridge for Entra (MCP HTTP auth)
**Layer:** backend
**Last updated:** 2026-07-05
**Source:** Installed package source (`node_modules/@modelcontextprotocol/sdk@1.29.0/dist/esm/...`), `node_modules/@redis/client` type defs, and official Microsoft identity-platform docs (web).

## Overview

This feature subclasses `ProxyOAuthServerProvider` from the installed MCP TypeScript SDK
(**v1.29.0** — not the `^1.23.4` declared in `package.json`; see Gotchas) and adds a
Redis-backed txn/code store plus an Express `GET /auth/callback` route. All SDK facts below
were read directly from the installed `dist/esm` sources (ground truth for this exact
version), not from generic docs, because the auth-provider surface has changed across SDK
minor versions. Entra v2.0 authorize/token parameter names are cited from the canonical
Microsoft identity-platform doc. Redis and Node crypto sections mirror the exact API already
in use in this repo (`redis-clients-store.ts`) so the new store is a drop-in sibling, not a
new pattern.

## @modelcontextprotocol/sdk (v1.29.0 installed)

### Key APIs

- `class ProxyOAuthServerProvider implements OAuthServerProvider` —
  `node_modules/@modelcontextprotocol/sdk/dist/esm/server/auth/providers/proxyProvider.js`
- `constructor(options: ProxyOptions)` — sets `this.skipLocalPkceValidation = true` (default!),
  stores `_endpoints`, `_verifyAccessToken`, `_getClient`, `_fetch`. Only wires
  `revokeToken` if `options.endpoints.revocationUrl` is set (we don't pass one — stays
  `undefined`, matching design.md "inherited (not configured)").
- `get clientsStore()` — returns `{ getClient, registerClient? }`. `registerClient` is only
  present if `options.endpoints.registrationUrl` is set. **The bridge must keep the existing
  `Object.defineProperty(provider, "clientsStore", { value: store })` override** from
  `build.ts` — the base getter is otherwise not overridable by a subclass field assignment
  (it's a real `get` accessor on the base class), same as the current code already does.
- `authorize(client, params: AuthorizationParams, res)` — base impl builds a
  `URLSearchParams` and calls `res.redirect(url)`. The bridge overrides this entirely (does
  not call `super.authorize`).
- `challengeForAuthorizationCode(_client, _authorizationCode)` — base impl is a **no-op
  stub returning `''`** (proxy setups defer PKCE to upstream). The bridge must override this
  to actually look up the stored `clientCodeChallenge`.
- `exchangeAuthorizationCode(client, authorizationCode, codeVerifier?, redirectUri?, resource?)`
  — base impl POSTs to `_endpoints.tokenUrl` and returns `OAuthTokensSchema.parse(data)`.
  The bridge overrides this to return locally-stored tokens instead of calling the base.
- `exchangeRefreshToken(client, refreshToken, scopes?, resource?)` — base impl builds
  `URLSearchParams({grant_type: 'refresh_token', client_id, refresh_token})`, conditionally
  adds `client_secret`, `scope` (space-joined), `resource` (`.href`), POSTs to
  `_endpoints.tokenUrl`. **The bridge should call `super.exchangeRefreshToken(entraClient,
  refreshToken, [entraConfig.scope])` unchanged** — this is exactly the pattern the deleted
  `EntraProxyOAuthServerProvider.exchangeRefreshToken` already used.
- `skipLocalPkceValidation: boolean` — **defaults to `true` in the constructor**. The bridge
  must explicitly set `this.skipLocalPkceValidation = false` after `super(options)`.
- `interface OAuthServerProvider` —
  `node_modules/@modelcontextprotocol/sdk/dist/esm/server/auth/provider.d.ts`. Declares the
  same five methods plus `get clientsStore()` and optional `revokeToken?`/
  `skipLocalPkceValidation?`.
- `type AuthorizationParams = { state?: string; scopes?: string[]; codeChallenge: string;
  redirectUri: string; resource?: URL }` — this is what the router hands to `authorize()`.
  Note the field is `codeChallenge` (camelCase), not `code_challenge`.
- `type ProxyOptions = { endpoints: { authorizationUrl, tokenUrl, revocationUrl?,
  registrationUrl? }; verifyAccessToken: (token) => Promise<AuthInfo>; getClient: (clientId) =>
  Promise<OAuthClientInformationFull | undefined>; fetch?: FetchLike }`.

### mcpAuthRouter → `/authorize` and `/token` call sequence

`node_modules/@modelcontextprotocol/sdk/dist/esm/server/auth/handlers/authorize.js` and
`.../handlers/token.js` — read directly, this is the exact call sequence the bridge must
satisfy:

**`/authorize` handler (`authorizationHandler`):**
1. Validates `client_id` + `redirect_uri` against the **registered** client (via
   `provider.clientsStore.getClient`) *before* calling `provider.authorize`. Redirect-URI
   validation (including RFC 8252 loopback port relaxation) happens here, not in the bridge.
2. Parses `code_challenge`, `code_challenge_method` (must be literal `S256`), `scope`,
   `state`, `resource` from the query/body.
3. Calls `provider.authorize(client, { state, scopes: requestedScopes, redirectUri:
   redirect_uri, codeChallenge: code_challenge, resource }, res)`.
4. **Any error thrown inside `authorize()` is caught and turned into a 302 redirect to the
   client's `redirect_uri` with `?error=...&error_description=...&state=...`** — so if the
   bridge's `authorize()` throws (e.g. Redis unavailable), the SDK still redirects to the
   client (not a 500), unlike the phase-1 pre-redirect errors.

**`/token` handler (`tokenHandler`), `grant_type=authorization_code` branch:**
```js
const skipLocalPkceValidation = provider.skipLocalPkceValidation;
if (!skipLocalPkceValidation) {
  const codeChallenge = await provider.challengeForAuthorizationCode(client, code);
  if (!(await verifyChallenge(code_verifier, codeChallenge))) {
    throw new InvalidGrantError('code_verifier does not match the challenge');
  }
}
const tokens = await provider.exchangeAuthorizationCode(
  client, code,
  skipLocalPkceValidation ? code_verifier : undefined,  // <-- undefined when NOT skipped
  redirect_uri, resource ? new URL(resource) : undefined,
);
```
With `skipLocalPkceValidation = false` (the bridge's setting): the SDK calls
`challengeForAuthorizationCode` and verifies the client's `code_verifier` itself using
`pkce-challenge`'s `verifyChallenge`, **then calls `exchangeAuthorizationCode` with
`codeVerifier` forced to `undefined`** (not the client's real verifier) — confirming
design.md's note that `codeVerifier` is unused/ignorable in the bridge's override.

### Gotchas

- **Installed version is 1.29.0, not `^1.23.4`.** `package.json` declares
  `"@modelcontextprotocol/sdk": "^1.23.4"` but `package-lock.json` / the installed
  `node_modules/@modelcontextprotocol/sdk/package.json` resolve to **1.29.0**. All snippets
  above were read from the 1.29.0 source. If `npm install` is re-run and the lockfile allows
  a newer 1.x, re-verify `challengeForAuthorizationCode`'s no-op default and the
  `skipLocalPkceValidation` gate in `token.js` before relying on this doc.
- **Throw `InvalidGrantError`, NOT `ServerError`, for unknown/expired/replayed server codes.**
  Both `token.js` and `authorize.js` catch handlers do
  `const status = error instanceof ServerError ? 500 : 400;`, so `ServerError` → HTTP 500
  `{"error":"server_error"}` while `InvalidGrantError` → HTTP 400 `{"error":"invalid_grant"}` —
  the latter is what FR-7 wants. design.md (Component Breakdown §1, Error Handling table, Examples
  4-5) and todo.md (Tasks 2.3, 2.4) already specify `InvalidGrantError` from
  `@modelcontextprotocol/sdk/server/auth/errors.js` for the "code not found / expired / replayed"
  paths — build to that. (This gotcha records *why*; there is no remaining `ServerError`
  instruction in the specs to correct.)
- **`challengeForAuthorizationCode`'s base implementation is a no-op returning `''`.** The
  bridge's override completely replaces this — there is no useful `super.
  challengeForAuthorizationCode()` to delegate to.
- **`OAuthTokensSchema` is `.strip()`**, not strict — extra fields Entra returns (e.g.
  `ext_expires_in`, `id_token`) parse fine and unknown ones are silently dropped; only
  `access_token` (required) and `token_type` (required) must be present, everything else
  (`id_token`, `expires_in`, `scope`, `refresh_token`) is optional. `expires_in` is
  `z.coerce.number()` so a numeric string also passes.
- **`Object.defineProperty(provider, "clientsStore", ...)` is still required** on the new
  `EntraBridgeProvider` instance exactly as it is today on `EntraProxyOAuthServerProvider` —
  subclassing does not change this; `clientsStore` is a `get` accessor defined on the base
  class prototype, not an instance field, so a plain `this.clientsStore = store` assignment
  in the constructor would throw (no setter). Keep the call-site override pattern in
  `build.ts`.
- **Import paths** (already used in `build.ts`, confirmed valid for 1.29.0):
  `@modelcontextprotocol/sdk/server/auth/providers/proxyProvider.js` (class + `ProxyOptions`
  type), `@modelcontextprotocol/sdk/server/auth/provider.js` (`AuthorizationParams`,
  `OAuthServerProvider`, `OAuthTokenVerifier`), `@modelcontextprotocol/sdk/server/auth/errors.js`
  (`ServerError`, `InvalidGrantError`, etc.), `@modelcontextprotocol/sdk/shared/auth.js`
  (`OAuthClientInformationFull`, `OAuthTokens`, `OAuthTokensSchema`).

## Microsoft Entra ID v2 — Authorization Code + PKCE

Canonical doc: [Microsoft identity platform and OAuth 2.0 authorization code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow)

### Authorize request (`GET https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize`)

| Param | Value for this bridge |
|---|---|
| `client_id` | `ENTRA_CLIENT_ID` (the app registration, never the DCR client's id) |
| `response_type` | `code` |
| `redirect_uri` | `{MCP_SERVER_URL}/auth/callback` (server's fixed callback, registered in Entra as a Web platform redirect URI) |
| `scope` | `api://{ENTRA_CLIENT_ID}/{scopeName}` — must be the **fully-qualified App-ID-URI scope**, not a bare scope name (Entra rejects bare scopes with AADSTS errors for custom APIs) |
| `state` | the bridge's own `txn_id` (never the client's `state`) |
| `code_challenge` | the bridge's own server-side S256 challenge |
| `code_challenge_method` | `S256` |

**No `resource` parameter** — Entra v2.0 does not implement RFC 8707 resource indicators;
the audience is determined entirely by the `scope`'s App-ID-URI prefix. Sending `resource`
alongside a `scope` that already encodes a different resource is what produces
`AADSTS9010010` (scope/resource conflict) in the original bug this feature fixes.

### Token request (`POST https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token`)

Body (`application/x-www-form-urlencoded`), authorization_code grant:

| Param | Value |
|---|---|
| `grant_type` | `authorization_code` |
| `client_id` | `ENTRA_CLIENT_ID` |
| `client_secret` | `ENTRA_CLIENT_SECRET` (confidential client — required now that the bridge always uses the server's own identity) |
| `code` | the Entra authorization code from the callback |
| `redirect_uri` | `{MCP_SERVER_URL}/auth/callback` — **must exactly match** the `redirect_uri` sent in the authorize request |
| `code_verifier` | the bridge's own `serverCodeVerifier` (the plaintext verifier whose SHA-256/base64url matches the `code_challenge` sent earlier) |

Refresh-token grant (used by `exchangeRefreshToken`, delegated to
`ProxyOAuthServerProvider.exchangeRefreshToken`): `grant_type=refresh_token`, `client_id`,
`client_secret`, `refresh_token`, `scope` (space-joined, fully-qualified
`api://{ENTRA_CLIENT_ID}/{scopeName}`) — no `resource`, same rule as above.

### Gotchas

- `redirect_uri` in the token request **must byte-for-byte match** the one used in the
  authorize request (this is standard OAuth2, but easy to get wrong with trailing slashes —
  build `callbackUrl` once from `MCP_SERVER_URL` and reuse the same string/constant in both
  the authorize-URL builder and the callback handler's token POST).
- Entra token responses include extra fields beyond the SDK's `OAuthTokensSchema` (e.g.
  `ext_expires_in`); these are silently stripped by `.strip()`, not an error — no special
  handling needed.
- Client secret must be sent as `client_secret` (not `client_assertion`) for this
  password-credential flow — no certificate/assertion auth is in scope here.

## Node `node:crypto` — PKCE pair + random IDs

No new dependency; already a Node built-in (Node 18+ engine, repo runs Node 22 in
containers). All of `randomBytes`, `.toString('base64url')`, `createHash('sha256')`, and
`.digest('base64url')` are stable since Node 15.7+ — safe on this repo's `engines: node
>=18`.

### Code Examples

```typescript
import { randomBytes, createHash } from "node:crypto";

// txn_id / server authorization code — cryptographically random, URL-safe
const txnId = randomBytes(32).toString("base64url"); // 43-char string, no padding

// Server-side PKCE pair for the Entra leg (S256)
const serverVerifier = randomBytes(32).toString("base64url");
const serverChallenge = createHash("sha256")
  .update(serverVerifier)
  .digest("base64url");
```

### Gotchas

- `Buffer.toString("base64url")` and `Hash.digest("base64url")` produce **unpadded**
  URL-safe base64 (`-`/`_` instead of `+`/`/`, no trailing `=`) — this is exactly the RFC
  7636 PKCE encoding Entra (and the SDK's `pkce-challenge` verifier) expects. Do not
  post-process with `encodeURIComponent` or manual replace — it's already URL-safe.
  `randomBytes(32)` yields a 43-character base64url string (32 bytes → 256 bits → 43 base64
  chars without padding), matching design.md's "43-char base64url" expectation for both
  `txn_id`/server codes and the PKCE verifier.
- `createHash("sha256").update(serverVerifier)` — `update()` takes the verifier as a
  **string** (UTF-8 by default), which is correct here since `serverVerifier` is already a
  base64url string, not raw bytes. Do not re-decode it to a Buffer first.

## redis (node-redis v4) — matches `src/http/auth/redis-clients-store.ts`

This repo already has one Redis-backed OAuth store (`RedisOAuthClientsStore`); the new
`RedisOAuthCodeStore` should mirror its constructor-injected narrow-interface pattern
exactly, extended with `del` and the `{ EX }` TTL option.

### Key APIs (confirmed against `@redis/client` type defs and existing usage)

- `redisClient.get(key: string): Promise<string | null>` — returns `null` (not `undefined`)
  for a missing key. Existing code checks `if (raw === null) return undefined;` — follow the
  same null-check, not falsy-check (an empty-string value is falsy but valid).
- `redisClient.set(key: string, value: string, options?: { EX?: number }): Promise<unknown>`
  — `EX` is seconds-based TTL, confirmed in
  `node_modules/@redis/client/dist/lib/commands/SET.d.ts` (`type SetTTL = { EX: number } |
  ...`). This is the exact shape design.md's `RedisCodeInterface` specifies.
- `redisClient.del(key: string): Promise<unknown>` — not currently used by
  `RedisOAuthClientsStore` but is a standard node-redis v4 method; the new store's `del`
  binding is `redisClient.del.bind(redisClient)`, same binding style as `get`/`set` in
  `build.ts` (`get: redisClient.get.bind(redisClient), set: redisClient.set.bind(redisClient)`).
- `redisClient.getDel(key: string): Promise<string | null>` — **confirmed present** on the
  installed client: `node_modules/@redis/client/dist/lib/commands/GETDEL.js` and
  `commands.d.ts` (Redis/Valkey `GETDEL`, 6.2+). This is the **atomic** read-and-delete the
  design relies on for single-use server codes (AC 4): one round-trip, so two concurrent
  redemptions cannot both read the record. Bind as `getDel: redisClient.getDel.bind(redisClient)`.

### Code Examples

Existing pattern to mirror (`src/http/auth/redis-clients-store.ts`):
```typescript
type RedisInterface = {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string) => Promise<unknown>;
};
```

Store shape (per design.md — **four generic methods keyed on the namespace**, not six per-record
methods; the namespace→type mapping makes wrong-type/typo'd-namespace calls fail to compile):
```typescript
type RedisCodeInterface = {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string, options?: { EX?: number }) => Promise<unknown>;
  del: (key: string) => Promise<unknown>;
  getDel: (key: string) => Promise<string | null>; // GETDEL — atomic single-use
};

type NamespaceRecord = { txn: OAuthTransaction; code: OAuthServerCode };

class RedisOAuthCodeStore {
  constructor(private readonly redis: RedisCodeInterface) {}

  private key<K extends keyof NamespaceRecord>(ns: K, id: string) { return `oauth:${ns}:${id}`; }
  private parse<T>(raw: string | null): T | undefined {
    return raw === null ? undefined : (JSON.parse(raw) as T);
  }

  async set<K extends keyof NamespaceRecord>(ns: K, id: string, value: NamespaceRecord[K], ttlSeconds: number) {
    await this.redis.set(this.key(ns, id), JSON.stringify(value), { EX: ttlSeconds });
  }
  async get<K extends keyof NamespaceRecord>(ns: K, id: string): Promise<NamespaceRecord[K] | undefined> {
    return this.parse<NamespaceRecord[K]>(await this.redis.get(this.key(ns, id)));
  }
  async del(ns: keyof NamespaceRecord, id: string) {
    await this.redis.del(this.key(ns, id));
  }
  async getAndDelete<K extends keyof NamespaceRecord>(ns: K, id: string): Promise<NamespaceRecord[K] | undefined> {
    return this.parse<NamespaceRecord[K]>(await this.redis.getDel(this.key(ns, id))); // atomic
  }
}
// Call sites infer the record type from the literal namespace — no explicit <T>:
//   codeStore.get("txn", id)              // => OAuthTransaction | undefined
//   codeStore.getAndDelete("code", code)  // => OAuthServerCode | undefined
```

Binding at the `build.ts` call site (matches the existing `RedisOAuthClientsStore`
instantiation immediately above it):
```typescript
const codeStore = new RedisOAuthCodeStore({
  get: redisClient.get.bind(redisClient),
  set: redisClient.set.bind(redisClient),
  del: redisClient.del.bind(redisClient),
  getDel: redisClient.getDel.bind(redisClient),
});
```

### Gotchas

- `JSON.parse(raw)` will throw if Redis somehow holds a non-JSON value at that key — no
  existing code guards this (same risk already accepted by `RedisOAuthClientsStore`), so no
  new handling is expected here; a throw here surfaces as an unhandled rejection → Express
  error handler → 500, consistent with design.md's "Redis unavailable" row.
- TTL expiry is **Redis-native** — there is nothing to implement for "code expired"; an
  expired key simply returns `null` from `get`, indistinguishable from "never existed" (this
  is why Example 5's expired-code test is really just "missing key returns undefined").

## Cross-Boundary Reference Map

| Source | Output | Format | Consumed By | Input | Expected Format | Match? |
|---|---|---|---|---|---|---|
| `authorizationHandler` (SDK router) | `AuthorizationParams.codeChallenge` | plain string (client's raw `code_challenge` query param, unvalidated as S256 by the SDK) | `EntraBridgeProvider.authorize()` → `codeStore.set("txn", …)` → Redis `oauth:txn:*` | `clientCodeChallenge` field | string | YES |
| `crypto.randomBytes(32)` | txn_id / server code / PKCE verifier | unpadded base64url string, 43 chars | Redis key suffix (`oauth:txn:<id>`, `oauth:code:<id>`) and Entra `state`/`code_challenge` params | URL query value | URL-safe string, no padding | YES — base64url is already URL-safe, no extra encoding needed |
| `crypto.createHash('sha256').digest('base64url')` | server PKCE `code_challenge` | unpadded base64url SHA-256 digest | Entra `/authorize` `code_challenge` param (`code_challenge_method=S256`) | `code_challenge` | RFC 7636 base64url-no-padding SHA-256 | YES |
| Entra `/token` response body | `access_token`, `refresh_token`, `expires_in`, `token_type`, `id_token`, plus extras (`ext_expires_in`, etc.) | JSON object, may include fields beyond the SDK schema | `OAuthTokensSchema.parse()` (`.strip()` mode) | full response object | `{ access_token: string; token_type: string; id_token?; expires_in?: coerced number; scope?; refresh_token? }` | YES — extra fields silently dropped, not an error |
| `EntraBridgeProvider.challengeForAuthorizationCode`/`exchangeAuthorizationCode` throwing `InvalidGrantError` (per design.md/todo.md) | thrown error | `InvalidGrantError` instance (from `…/server/auth/errors.js`) | SDK `tokenHandler`'s catch block | `error instanceof ServerError ? 500 : 400` | maps to **HTTP 400** `{error:"invalid_grant"}` | YES — `InvalidGrantError` is NOT `ServerError`, so it takes the 400 branch, which is what FR-7 wants. (Do NOT throw `ServerError` — that would be HTTP 500.) |
| `Redis.get()` | missing-key result | `null` | `RedisOAuthCodeStore.get`/`getAndDelete` | store checks `=== null` | `string \| null` | YES, as long as the store checks `=== null`, not falsy |
| `AuthorizationParams.redirectUri` (validated by SDK against DCR client's registered `redirect_uris`) | client's original redirect URI | already-validated URL string | `codeStore.set("txn", …)` → Redis `clientRedirectUri` field → later used in `res.redirect()` in the callback handler | base for `new URL(...)` in the callback handler | used as `new URL()` base, params added via `searchParams.set` | YES — build the redirect with `new URL()`/`searchParams.set()`, NOT string concatenation, to preserve any existing query string on `clientRedirectUri` and percent-encode the client's `state` |

## Not Found

None — all four technologies were resolved directly from the installed package sources
(SDK, `@redis/client` types) or official Microsoft documentation; Context7 was not needed
for this small, version-pinned surface.
