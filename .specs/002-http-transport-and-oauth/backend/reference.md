# Reference: HTTP Transport and OAuth
**Layer:** backend
**Last updated:** 2026-05-26
**Source:** Context7 library documentation / official web docs / installed node_modules type definitions

## Overview

This reference covers the eight libraries the build agent needs for feature 002: the MCP SDK's HTTP transport and OAuth surfaces, `jose` for Entra ID JWT verification, `pino` and `pino-http` for structured logging, `redis` (node-redis v4) for DCR client persistence, `express` v5 for the HTTP server, `zod` v3.25 for environment schema validation, and `vitest` v4 for unit testing. All type definitions were cross-checked against the installed SDK at `node_modules/@modelcontextprotocol/sdk/dist/cjs/server/`.

---

## @modelcontextprotocol/sdk

**Version in use:** `^1.23.4` (installed). All import paths require `.js` extension (Node16 ESM resolution).

### Key APIs

**StreamableHTTPServerTransport** — `server/streamableHttp.js`

- `new StreamableHTTPServerTransport(options?)` — creates a stateful per-session transport. Options are `StreamableHTTPServerTransportOptions` (alias for `WebStandardStreamableHTTPServerTransportOptions`).
- `transport.handleRequest(req, res, parsedBody?)` — handles all inbound MCP HTTP requests. `req` is augmented with `auth?: AuthInfo` by `requireBearerAuth` upstream.
- `transport.sessionId` — `string | undefined`. Set after the first initialize message; use this as the map key.
- `transport.close()` — gracefully closes the transport and its underlying SSE connection.

`WebStandardStreamableHTTPServerTransportOptions`:
- `sessionIdGenerator?: () => string` — omit for stateless mode; supply `() => randomUUID()` for stateful.
- `onsessioninitialized?: (sessionId: string) => void | Promise<void>` — fires when the session is first established.
- `onsessionclosed?: (sessionId: string) => void | Promise<void>` — fires on clean close; use this to remove from the session map.
- `enableJsonResponse?: boolean` — default `false` (SSE preferred). Set `true` only for single-request stateless clients.
- `eventStore?: EventStore` — opt-in for resumability; not required by this feature.

**McpServer** — `server/mcp.js`

- `new McpServer(serverInfo: Implementation, options?: ServerOptions)` — creates an MCP protocol server. `Implementation = { name: string; version: string }`.
- `server.connect(transport: Transport): Promise<void>` — binds the server to a transport. Call once per session.
- `server.close(): Promise<void>` — closes the server and its transport.
- `server.isConnected(): boolean` — returns `true` if the server has an active transport connection.

**ProxyOAuthServerProvider** — `server/auth/providers/proxyProvider.js`

```typescript
import { ProxyOAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/providers/proxyProvider.js";

type ProxyOptions = {
  endpoints: {
    authorizationUrl: string;
    tokenUrl: string;
    revocationUrl?: string;
    registrationUrl?: string;
  };
  verifyAccessToken: (token: string) => Promise<AuthInfo>;
  getClient: (clientId: string) => Promise<OAuthClientInformationFull | undefined>;
  fetch?: FetchLike;
};

const provider = new ProxyOAuthServerProvider({
  endpoints: {
    authorizationUrl: "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token",
    revocationUrl: "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/logout",
  },
  verifyAccessToken: async (token) => entraVerifier.verifyAccessToken(token),
  getClient: async (clientId) => redisStore.getClient(clientId),
});
```

**CRITICAL:** `ProxyOAuthServerProvider` takes `getClient` (read-only lookup), NOT `clientsStore`. The provider's internal `get clientsStore()` getter wraps `getClient` into a minimal `OAuthRegisteredClientsStore` that only implements `getClient`. It does NOT expose `registerClient`. DCR write operations (client registration) are handled by `mcpAuthRouter` via `clientRegistrationOptions` — which sources `clientsStore` from `provider.clientsStore` at router mount time.

**mcpAuthRouter** — `server/auth/router.js`

```typescript
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";

type AuthRouterOptions = {
  provider: OAuthServerProvider;
  issuerUrl: URL;
  baseUrl?: URL;
  resourceServerUrl?: URL;
  scopesSupported?: string[];
  resourceName?: string;
  clientRegistrationOptions?: Omit<ClientRegistrationHandlerOptions, "clientsStore">;
};

app.use(
  mcpAuthRouter({
    provider,
    issuerUrl: new URL(settings.ENTRA_ISSUER_URL),
    resourceServerUrl: new URL(settings.MCP_SERVER_URL),
    scopesSupported: ["openid", "profile", "offline_access"],
    clientRegistrationOptions: {
      // clientsStore is injected from provider.clientsStore — do NOT pass it here
    },
  })
);
```

`clientRegistrationOptions` is typed as `Omit<ClientRegistrationHandlerOptions, 'clientsStore'>` — `clientsStore` is intentionally excluded and is sourced from `provider.clientsStore`.

**requireBearerAuth** — `server/auth/middleware/bearerAuth.js`

```typescript
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";

app.use(
  "/mcp",
  requireBearerAuth({
    verifier: entraVerifier,         // implements OAuthTokenVerifier
    requiredScopes: ["openid"],
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(new URL(settings.MCP_SERVER_URL)),
  })
);
```

After this middleware, `req.auth` is populated with `AuthInfo`.

**OAuthTokenVerifier interface** — `server/auth/provider.js`

```typescript
interface OAuthTokenVerifier {
  verifyAccessToken(token: string): Promise<AuthInfo>;
}
```

**AuthInfo** — `server/auth/types.js`

```typescript
interface AuthInfo {
  token: string;
  clientId: string;
  scopes: string[];
  expiresAt?: number;   // Unix timestamp in seconds
  resource?: URL;
  extra?: Record<string, unknown>;
}
```

**OAuthRegisteredClientsStore** — `server/auth/clients.js`

```typescript
interface OAuthRegisteredClientsStore {
  getClient(clientId: string): OAuthClientInformationFull | undefined | Promise<OAuthClientInformationFull | undefined>;
  registerClient?(
    client: Omit<OAuthClientInformationFull, "client_id" | "client_id_issued_at">
  ): OAuthClientInformationFull | Promise<OAuthClientInformationFull>;
}
```

**Error classes** — `server/auth/errors.js`

```typescript
import { InvalidTokenError, InsufficientScopeError } from "@modelcontextprotocol/sdk/server/auth/errors.js";

// throw in verifyAccessToken for expired or malformed tokens
throw new InvalidTokenError("Token expired");

// throw when required scopes are missing
throw new InsufficientScopeError("Missing required scope: openid");
```

Both extend `OAuthError extends Error`. `requireBearerAuth` catches these and returns appropriate HTTP 401/403 responses automatically.

**getOAuthProtectedResourceMetadataUrl** — `server/auth/router.js`

```typescript
import { getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/sdk/server/auth/router.js";

const metadataUrl = getOAuthProtectedResourceMetadataUrl(new URL(settings.MCP_SERVER_URL));
```

### Gotchas

- All import paths MUST include `.js` extension, e.g. `@modelcontextprotocol/sdk/server/mcp.js`. TypeScript with `moduleResolution: Node16` requires this even for `.ts` source files.
- `StreamableHTTPServerTransport.sessionId` is `undefined` until after the first initialize message completes. The `onsessioninitialized` callback is the safe place to insert into the session map.
- `ProxyOAuthServerProvider` wraps `getClient` into a read-only `clientsStore`. Never pass `clientsStore` in `clientRegistrationOptions` to `mcpAuthRouter` — the type `Omit<ClientRegistrationHandlerOptions, 'clientsStore'>` enforces this. The write side (`registerClient`) must be implemented on the store that backs `getClient`.
- `McpServer.connect()` must be called after `requireBearerAuth` has run, because the transport's `handleRequest` augments `req` with `auth`. The MCP server does not receive auth directly; it reads from `req.auth`.

---

## jose

**Version:** latest stable (currently v6.x). ESM-only — no CommonJS build. Install as `jose` from npm.

### Key APIs

- `createRemoteJWKSet(url: URL, options?)` — creates a function that fetches and caches JWKS from the given URL. Returns a `RemoteJWKSet` function suitable for use as the `key` argument to `jwtVerify`.
- `jwtVerify(token, key, options?)` — verifies a JWT's signature, expiry, issuer, and audience. Returns `{ payload, protectedHeader }` on success. Throws on failure.

### Code Examples

```typescript
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { JWTPayload } from "jose";

const JWKS = createRemoteJWKSet(
  new URL("https://login.microsoftonline.com/{tenant}/discovery/v2.0/keys")
);

async function verifyEntraToken(token: string): Promise<JWTPayload> {
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: "https://login.microsoftonline.com/{tenant}/v2.0",
    audience: "api://{client-id}",
  });
  return payload;
}
```

**Scope verification** (manual, since `jwtVerify` does not check scopes):

```typescript
import { jwtVerify, errors } from "jose";

async function verifyWithScopes(token: string, requiredScopes: string[]): Promise<JWTPayload> {
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: settings.ENTRA_ISSUER_URL,
    audience: settings.ENTRA_CLIENT_ID,
  });

  const scp = typeof payload["scp"] === "string" ? payload["scp"].split(" ") : [];
  const hasAllScopes = requiredScopes.every((s) => scp.includes(s));
  if (!hasAllScopes) {
    throw new InsufficientScopeError("Missing required scopes");
  }

  return payload;
}
```

**Error handling:**

```typescript
import { errors } from "jose";

try {
  await jwtVerify(token, JWKS, { issuer, audience });
} catch (err) {
  if (err instanceof errors.JWTExpired) {
    throw new InvalidTokenError("Token expired");
  }
  if (err instanceof errors.JWTClaimValidationFailed) {
    throw new InvalidTokenError("Token claim validation failed");
  }
  if (err instanceof errors.JWSSignatureVerificationFailed) {
    throw new InvalidTokenError("Token signature invalid");
  }
  if (err instanceof errors.JOSEError) {
    throw new InvalidTokenError("Token verification failed");
  }
  throw err;
}
```

### Configuration

`createRemoteJWKSet` options:
- `timeoutDuration?: number` — fetch timeout in ms (default: 5000)
- `cooldownDuration?: number` — minimum ms between JWKS re-fetches on cache miss (default: 30000)
- `cacheMaxAge?: number` — max ms to cache the JWKS before refresh (default: 600000)

`jwtVerify` options:
- `issuer?: string | string[]` — validates `iss` claim
- `audience?: string | string[]` — validates `aud` claim
- `algorithms?: string[]` — restricts allowed signing algorithms (e.g. `["RS256"]`)
- `clockTolerance?: number` — seconds of tolerance for `exp`/`nbf` checks
- `maxTokenAge?: string` — max age string (e.g. `"15 minutes"`)

### Gotchas

- `jose` is ESM-only. With `"type": "module"` in package.json this is fine. Do NOT use `require()`.
- `jwtVerify` does NOT verify scope claims — scope checking must be done manually on `payload.scp` after verification.
- Entra ID tokens use `scp` (space-delimited string) for delegated permissions, not `scope` or `scopes`. Check `typeof payload.scp === "string"` before splitting.
- The `errors` namespace is a named export: `import { errors } from "jose"`. Individual error classes: `errors.JWTExpired`, `errors.JWTClaimValidationFailed`, `errors.JWSSignatureVerificationFailed`, `errors.JOSEError` (base class).
- Context7 resolution for `jose` was blocked by a tool error; documentation sourced from official web docs (`https://github.com/panva/jose`).

---

## pino

**Version:** `^9.x` (to be installed). ESM and CJS supported.

### Key APIs

- `pino(options?)` — creates a root logger. Returns a `Logger` instance.
- `logger.child(bindings, options?)` — creates a child logger with additional bound fields.
- `logger.info/warn/error/debug/trace/fatal(obj, msg?)` — log at a level.

### Code Examples

**Logger creation with redaction:**

```typescript
import pino from "pino";

export const logger = pino({
  level: process.env["LOG_LEVEL"] ?? "info",
  redact: {
    paths: ["req.headers.authorization", "req.headers.cookie", "*.token", "*.accessToken"],
    censor: "[REDACTED]",
  },
  base: {
    service: "xero-mcp",
    env: process.env["ENVIRONMENT"] ?? "local",
  },
});
```

**Child logger for request-scoped context:**

```typescript
const reqLogger = logger.child({ requestId: req.id, sessionId });
reqLogger.info("Session created");
```

**Structured error logging:**

```typescript
logger.error({ err }, "Unhandled error");
// pino serialises Error objects when bound as `err`
```

### Configuration

Key options for `pino(options)`:
- `level: string` — minimum log level (`"trace" | "debug" | "info" | "warn" | "error" | "fatal"`)
- `redact: RedactOptions | string[]` — field path redaction. Use object form for `censor` override.
- `base: Record<string, unknown> | null` — always-present fields. Set `null` to omit `pid`/`hostname`.
- `timestamp: pino.TimeFn | false` — default is ISO timestamp. Use `pino.stdTimeFunctions.isoTime` for ISO 8601.
- `serializers` — custom serialisers for `err`, `req`, `res`.
- `transport` — pino v9 transport for pretty-printing in development: `{ target: "pino-pretty" }`.

### Gotchas

- Always pass an object as the first argument and the message string as the second: `logger.info({ sessionId }, "Session started")`. Reversing the order logs the object as the message.
- The `err` serialiser is built-in; log errors as `logger.error({ err }, "message")` — NOT `logger.error(err, "message")`.
- `redact` paths use dot-notation and support wildcards. Test redaction in dev before deploying to avoid leaking tokens.

---

## pino-http

**Version:** `^10.x` (to be installed). Express middleware that integrates pino with HTTP request/response logging.

### Key APIs

- `pinoHttp(options?)` — returns an Express `RequestHandler` that logs each request/response pair. Attaches `req.log` (child logger with request context) for use in downstream handlers.

### Code Examples

**Basic setup with ignore and redaction:**

```typescript
import pinoHttp from "pino-http";
import { logger } from "./logger.js";

export const httpLogger = pinoHttp({
  logger,                            // reuse the root pino instance
  autoLogging: {
    ignore: (req) => req.url === "/health",   // skip health check logs
  },
  customLogLevel: (req, res, err) => {
    if (res.statusCode >= 500 || err) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },
  serializers: {
    req: (req) => ({
      method: req.method,
      url: req.url,
      remoteAddress: req.remoteAddress,
    }),
  },
});

// In the Express app:
app.use(httpLogger);
```

**Using req.log in route handlers:**

```typescript
app.get("/health", (req, res) => {
  // autoLogging.ignore suppresses the automatic log for this route
  res.json({ status: "ok" });
});

app.post("/mcp", requireBearerAuth({ verifier }), async (req, res) => {
  req.log.info({ sessionId: req.headers["mcp-session-id"] }, "MCP request received");
  await transport.handleRequest(req, res);
});
```

### Configuration

Key `pinoHttp` options:
- `logger` — existing pino logger instance to use (avoids double-instantiation)
- `autoLogging: boolean | { ignore: (req) => boolean }` — set `false` to disable all auto-logging, or supply `ignore` to suppress specific routes
- `customLogLevel: (req, res, err?) => string` — derive log level from response status
- `serializers` — override `req`/`res` serialisers. Only serialize fields you actually need.
- `genReqId: (req, res) => string` — custom request ID generation; default uses `X-Request-Id` header or increments counter

### Gotchas

- `pino-http` attaches `req.log` (a child logger). For TypeScript, the type augmentation is included in `pino-http` types — but you may need `import "pino-http"` in a type-declaration file to pick it up globally.
- `autoLogging.ignore` must be a synchronous function; do not make it async.
- Pass the root `logger` instance via the `logger` option to avoid creating a second pino instance with different config.

---

## redis (node-redis v4)

**Version:** `^4` (to be installed). Async/await API throughout.

### Key APIs

- `createClient(options?)` — creates a disconnected client. Must call `client.connect()` before use.
- `client.connect()` — connects to Redis. Returns a Promise.
- `client.quit()` — gracefully disconnects (sends QUIT command, drains pending commands). Use for shutdown. **v4 method.**
- `client.ping()` — sends PING, returns `"PONG"`. Use for health checks.
- `client.get(key)` — returns `string | null`.
- `client.set(key, value, options?)` — sets a string value. Options include `{ EX: seconds }` for TTL.
- `client.del(key | key[])` — deletes one or more keys.
- `client.isReady` — `boolean` property; `true` when connected and ready.

### Code Examples

**Client creation and connection:**

```typescript
import { createClient } from "redis";

const client = createClient({
  url: settings.REDIS_URL,   // e.g. "redis://localhost:6379"
  socket: {
    reconnectStrategy: (retries) => Math.min(retries * 100, 3000),
  },
});

client.on("error", (err) => logger.error({ err }, "Redis client error"));
client.on("connect", () => logger.info("Redis connected"));

await client.connect();
```

**Get and set with JSON serialisation:**

```typescript
// Store an OAuth client registration
async function setClient(clientId: string, client: OAuthClientInformationFull): Promise<void> {
  await redisClient.set(
    `oauth:client:${clientId}`,
    JSON.stringify(client),
    { EX: 86400 }   // 24-hour TTL
  );
}

async function getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
  const raw = await redisClient.get(`oauth:client:${clientId}`);
  if (raw === null) return undefined;
  return JSON.parse(raw) as OAuthClientInformationFull;
}
```

**Health check:**

```typescript
async function checkRedisHealth(): Promise<boolean> {
  try {
    const pong = await client.ping();
    return pong === "PONG";
  } catch {
    return false;
  }
}
```

**Graceful shutdown (v4):**

```typescript
process.on("SIGTERM", async () => {
  await client.quit();   // NOT client.disconnect() or client.destroy()
  process.exit(0);
});
```

### Configuration

`createClient` options:
- `url: string` — Redis connection URL (`redis://host:port`, `rediss://` for TLS)
- `password?: string` — AUTH password
- `database?: number` — Redis DB index (default 0)
- `socket.reconnectStrategy: (retries: number) => number | Error` — return delay ms or `Error` to stop reconnecting
- `socket.tls: boolean` — enable TLS (also enabled implicitly by `rediss://` URL)

### Gotchas

- **v4 shutdown method is `client.quit()`** — NOT `client.destroy()` (that is v5/v6 API). `client.disconnect()` exists in v4 but forces immediate disconnection without draining.
- `createClient` does NOT auto-connect. Always await `client.connect()` before issuing commands.
- `client.get()` returns `string | null`, never `undefined`. Check `!== null`, not truthiness (empty string `""` is a valid value).
- Error events are emitted even when the client auto-reconnects. Always attach an `"error"` listener to prevent unhandled rejection crashes.
- The Context7 docs for node-redis showed v5/v6 API patterns (`client.destroy()`). This reference uses v4 API aligned with `design.md`'s `redis ^4` constraint.

---

## express

**Version:** `^5.2.1` (to be installed). Express 5 is a peer dependency of the MCP SDK's `mcpAuthRouter`.

### Key APIs

- `express()` — creates an application. Returns `Application` which extends `Router`.
- `app.use(path?, ...handlers)` — mounts middleware or sub-routers.
- `app.get/post/delete(path, ...handlers)` — route registration.
- `app.listen(port, callback?)` — starts the HTTP server.

### Code Examples

**Express 5 app with async error handling:**

```typescript
import express from "express";

const app = express();
app.use(express.json());

// Express 5: async route handlers are natively supported —
// rejected promises automatically propagate to the error handler.
app.post("/mcp", requireBearerAuth({ verifier }), async (req, res) => {
  const transport = sessions.get(req.headers["mcp-session-id"] as string);
  if (!transport) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  await transport.handleRequest(req, res);
});

// Central error handler — must be declared last with 4 arguments
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error({ err }, "Unhandled error");
  res.status(500).json({ error: "Internal server error" });
});
```

**Health endpoint:**

```typescript
app.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});
```

**Starting the server:**

```typescript
const server = app.listen(settings.PORT, () => {
  logger.info({ port: settings.PORT }, "Server listening");
});

// Graceful shutdown
process.on("SIGTERM", () => {
  server.close(() => {
    logger.info("HTTP server closed");
    process.exit(0);
  });
});
```

### Configuration

- `express.json(options?)` — body-parser middleware for JSON. Use `{ limit: "1mb" }` to cap payload size.
- `app.set("trust proxy", 1)` — required if behind a reverse proxy (e.g., for correct IP in logs).

### Gotchas

- **Express 5 key difference:** Async route handlers no longer require `try/catch` — rejected promises automatically call `next(err)`. This is the primary reason the design specifies Express 5.
- **Express 4 vs 5:** In Express 4, `async (req, res) => { await something() }` would silently swallow the rejection. In Express 5, the rejection becomes a 500 response via the error handler. The MCP SDK's `mcpAuthRouter` requires Express 5 as a peer (`"express": "^5.2.1"`).
- Error handler middleware **must** have exactly 4 parameters `(err, req, res, next)` — Express detects it by arity.
- `res.json()` sets `Content-Type: application/json` and calls `JSON.stringify`. Use this over `res.send(JSON.stringify(...))`.
- Route handlers that call `res.send()` / `res.json()` do NOT need to `return` unless control flow requires it, but explicit `return` after sending prevents accidental double-send in branching logic.

---

## zod

**Version:** `3.25` (installed). No changes in v3.25 that affect these patterns.

### Key APIs

- `z.object(shape)` — object schema. `.parse(val)` throws `ZodError`; `.safeParse(val)` returns `{ success, data } | { success: false, error }`.
- `z.string()`, `z.number()`, `z.boolean()`, `z.enum([...])` — primitives.
- `z.discriminatedUnion(discriminator, options[])` — efficient union on a literal field.
- `.optional()`, `.default(val)` — optional fields and defaults.
- `.superRefine((val, ctx) => {...})` — attach custom cross-field validation; call `ctx.addIssue(...)` to report errors.
- `z.infer<typeof Schema>` — extract TypeScript type from a schema.

### Code Examples

**Environment schema with discriminated union and conditional required fields:**

```typescript
import { z } from "zod";

const BaseSettingsSchema = z.object({
  PORT: z.string().default("3000"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  ENVIRONMENT: z.enum(["local", "development", "staging", "production"]),
  MCP_SERVER_URL: z.string().url(),
  XERO_CLIENT_ID: z.string(),
  XERO_CLIENT_SECRET: z.string(),
  REDIS_URL: z.string().optional(),
  ENTRA_TENANT_ID: z.string().optional(),
  ENTRA_CLIENT_ID: z.string().optional(),
  LOCAL_BEARER_TOKEN: z.string().optional(),
});

export const SettingsSchema = BaseSettingsSchema.superRefine((val, ctx) => {
  if (val.ENVIRONMENT !== "local") {
    if (!val.REDIS_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["REDIS_URL"],
        message: "REDIS_URL is required in non-local environments",
      });
    }
    if (!val.ENTRA_TENANT_ID) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ENTRA_TENANT_ID"],
        message: "ENTRA_TENANT_ID is required in non-local environments",
      });
    }
    if (!val.ENTRA_CLIENT_ID) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ENTRA_CLIENT_ID"],
        message: "ENTRA_CLIENT_ID is required in non-local environments",
      });
    }
  }
  if (val.ENVIRONMENT === "local" && !val.LOCAL_BEARER_TOKEN) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["LOCAL_BEARER_TOKEN"],
      message: "LOCAL_BEARER_TOKEN is required in local environment",
    });
  }
});

export type Settings = z.infer<typeof SettingsSchema>;
```

**Safe parse with error reporting:**

```typescript
const result = SettingsSchema.safeParse(process.env);
if (!result.success) {
  console.error("Invalid environment configuration:");
  for (const issue of result.error.issues) {
    console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}
export const settings: Settings = result.data;
```

**Discriminated union** (for typed result shapes, if needed):

```typescript
const VerifyResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), authInfo: AuthInfoSchema }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
```

### Configuration

- `z.string().url()` — validates URL format.
- `z.string().min(1)` — non-empty string.
- `z.coerce.number()` — coerces string env vars to numbers (useful for `PORT`).
- `z.string().default("value")` — applied before validation; use on optional fields with known defaults.

### Gotchas

- `superRefine` receives the full parsed object. Use it for cross-field validation that cannot be expressed with field-level constraints.
- `ctx.addIssue` does NOT throw; multiple issues can be accumulated in one `superRefine` call. Zod collects them all before surfacing as `ZodError`.
- `z.infer<typeof Schema>` gives you the output type (after defaults and transforms), not the input type. Use `z.input<typeof Schema>` for the raw input type if needed.
- `.safeParse()` never throws — always returns a tagged union. Use this at application startup to fail fast with helpful messages.
- Zod 3.25 is aligned with the installed version; no migration concerns.

---

## vitest

**Version:** `^4.1.7` (installed). ESM-native test runner; no configuration needed for ESM projects.

### Key APIs

- `describe(name, fn)` — groups tests.
- `it(name, fn)` / `test(name, fn)` — defines a test case.
- `expect(val).toBe/toEqual/toThrow/resolves/rejects...` — assertions.
- `vi.mock(modulePath, factory?)` — hoisted module mock. Must be called at module top-level (not inside `beforeEach`).
- `vi.fn(impl?)` — creates a mock function. `.mockResolvedValue(val)`, `.mockRejectedValue(err)`, `.mockReturnValue(val)`.
- `vi.stubEnv(key, value)` — stubs `process.env[key]` for the test; auto-restored after the test.
- `vi.resetAllMocks()` / `vi.clearAllMocks()` — reset mock state.
- `beforeEach/afterEach/beforeAll/afterAll` — lifecycle hooks.

### Code Examples

**Mocking a module with vi.mock (hoisted):**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock is hoisted to the top of the file by vitest's transform —
// even though it appears here, it runs before imports.
vi.mock("../settings.js", () => ({
  settings: {
    ENVIRONMENT: "local",
    LOCAL_BEARER_TOKEN: "test-token",
    PORT: "3000",
  },
}));

vi.mock("redis", () => ({
  createClient: vi.fn(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue("OK"),
    quit: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    isReady: true,
  })),
}));

describe("RedisOAuthClientsStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns undefined for unknown client", async () => {
    const store = new RedisOAuthClientsStore(mockRedisClient);
    const result = await store.getClient("unknown");
    expect(result).toBeUndefined();
  });
});
```

**Stubbing environment variables:**

```typescript
import { describe, it, expect, vi } from "vitest";

describe("settings validation", () => {
  it("throws when ENTRA_TENANT_ID missing in non-local env", () => {
    vi.stubEnv("ENVIRONMENT", "production");
    vi.stubEnv("ENTRA_TENANT_ID", "");

    const result = SettingsSchema.safeParse(process.env);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toContain("ENTRA_TENANT_ID");
    }
  });
});
```

**Mocking async verifier:**

```typescript
const mockVerifier = {
  verifyAccessToken: vi.fn<[string], Promise<AuthInfo>>(),
};

it("returns 401 for invalid token", async () => {
  mockVerifier.verifyAccessToken.mockRejectedValue(new InvalidTokenError("expired"));
  // ... make request, assert 401
});
```

**Testing with resolves/rejects:**

```typescript
it("verifyAccessToken resolves AuthInfo for valid token", async () => {
  mockVerifier.verifyAccessToken.mockResolvedValue({
    token: "tok",
    clientId: "client-1",
    scopes: ["openid"],
  });
  await expect(verifier.verifyAccessToken("tok")).resolves.toMatchObject({
    clientId: "client-1",
  });
});
```

### Configuration

`vitest.config.ts` (if needed — the project may use `vite.config.ts`):

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,          // explicit imports preferred
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
    },
  },
});
```

### Gotchas

- `vi.mock` is **hoisted** by vitest's transform to run before imports, even if written after `import` statements. This means mock factories cannot close over variables defined in the module scope — define mocks inline or use `vi.hoisted()` to initialise shared variables that the mock factory references.
- `vi.stubEnv` requires `vi.unstubAllEnvs()` or `restoreMocks: true` in config to clean up — or it auto-restores after each test if `unstubEnvs: true` is set in config.
- `vi.fn()` mock state (call counts, return values) persists between tests unless `clearAllMocks: true` is set in config or `vi.clearAllMocks()` is called in `beforeEach`.
- For ESM modules, `vi.mock` path must match the import path exactly — use `.js` extension for local modules (e.g., `vi.mock("../settings.js")`).
- `vi.mock` with a factory replaces the entire module. If you only want to spy on one export, use `vi.spyOn(module, "method")` instead.

---

## Cross-Boundary Reference Map

| Source | Output | Format | Consumed By | Input | Expected Format | Match? |
|---|---|---|---|---|---|---|
| `jose.jwtVerify` | `payload` object | `JWTPayload` — plain object with `string` fields | `EntraVerifier.verifyAccessToken` | return value | `AuthInfo` — `{ token, clientId, scopes, expiresAt? }` | NO — manual mapping required: `clientId` from `payload.azp ?? payload.sub`, `scopes` from `payload.scp.split(" ")`, `expiresAt` from `payload.exp` |
| `EntraVerifier.verifyAccessToken` | `AuthInfo` | `{ token: string; clientId: string; scopes: string[]; expiresAt?: number }` | `requireBearerAuth` (SDK middleware) | `req.auth` | `AuthInfo` (SDK interface exact shape) | YES — shapes are identical; implement `OAuthTokenVerifier` interface |
| `requireBearerAuth` | `req.auth` | `AuthInfo` (attached to Express Request) | `StreamableHTTPServerTransport.handleRequest` | `req.auth` (passed through) | `AuthInfo \| undefined` on `IncomingMessage & { auth?: AuthInfo }` | YES — same type, same property name |
| `StreamableHTTPServerTransport` | `transport.sessionId` | `string \| undefined` — UUID (from `crypto.randomUUID()`) | Session `Map<string, SessionEntry>` key | map key | `string` | YES — but only access after `onsessioninitialized` fires; `undefined` before that |
| HTTP client | `Mcp-Session-Id` header | UUID string | Session `Map<string, SessionEntry>` lookup | `req.headers["mcp-session-id"]` | `string` | YES — same UUID value; header is lowercase per Node.js HTTP convention |
| `RedisOAuthClientsStore.getClient` | `OAuthClientInformationFull \| undefined` | SDK-defined `OAuthClientInformationFull` object | `ProxyOAuthServerProvider` `getClient` option | argument return value | `OAuthClientInformationFull \| undefined` | YES — same type |
| `ProxyOAuthServerProvider` | `provider.clientsStore` | Read-only `OAuthRegisteredClientsStore` wrapping `getClient` only | `mcpAuthRouter` (internal, via `provider`) | `provider.clientsStore` | `OAuthRegisteredClientsStore` with optional `registerClient` | PARTIAL — `registerClient` is missing; DCR write path must be wired separately through `clientRegistrationOptions`'s `clientsStore` (which `mcpAuthRouter` sources from `provider.clientsStore`) — see SDK type: `Omit<ClientRegistrationHandlerOptions, 'clientsStore'>` |
| `RedisOAuthClientsStore.registerClient` | `OAuthClientInformationFull` | Full client object with generated `client_id` | `mcpAuthRouter` registration handler | return value | `OAuthClientInformationFull` | YES — must assign `client_id` (UUID) and `client_id_issued_at` (Unix seconds) before storing |
| `jose.jwtVerify` payload | `payload.exp` | `number` — Unix timestamp in **seconds** | `AuthInfo.expiresAt` | `expiresAt?: number` | Unix timestamp in seconds | YES — no conversion needed |
| `redis.client.get` | raw JSON string | `string \| null` | `RedisOAuthClientsStore.getClient` | deserialised `OAuthClientInformationFull` | typed object | NO — `JSON.parse()` required; returns `null` (not `undefined`) for missing keys |

---

## Not Found

- **jose**: `resolve-library-id` returned `/panva/jose` (trust score 9.3) but `get-library-docs` failed with an internal tool error ("a secret is being returned by the get-library-docs tool"). Documentation sourced from official web docs (`https://github.com/panva/jose`) via `WebSearch` + `WebFetch`. All key APIs, error types, and ESM constraints are accurately reflected in the section above.
