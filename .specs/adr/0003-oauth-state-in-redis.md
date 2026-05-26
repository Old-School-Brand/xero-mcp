# 0003. OAuth state persistence in Redis

| Field       | Value                                                                        |
|-------------|------------------------------------------------------------------------------|
| Status      | Accepted                                                                     |
| Date        | 2026-05-26                                                                   |
| Decided by  | Llewellyn Strydom (CTO)                                                      |
| Source      | `.specs/002-http-transport-and-oauth/backend/requirements.md`, cin7-mcp ADR-0002, `src/http/auth/redis-clients-store.ts` |
| Supersedes  | --                                                                           |

## Context

ADR-0002 set the auth model: `ProxyOAuthServerProvider` from the MCP TS SDK proxies OAuth to Entra ID and hosts Dynamic Client Registration (DCR) locally. The SDK's `mcpAuthRouter` accepts an `OAuthRegisteredClientsStore` for persisting DCR client records (client_id, client_secret, redirect URIs, metadata).

Without an explicit store, the only option is an in-memory `Map` (the SDK's example pattern). In-memory state is lost on every pod restart, every rolling deploy, and (once we scale past one replica) every load-balancer hop. Previously-connected MCP clients present a `client_id` the server no longer knows, the server returns `invalid_client`, and the client forces every user through the Entra consent flow again.

The sibling server cin7-mcp solved the same problem (cin7-mcp ADR-0002) by persisting OAuth state in Valkey via the `py-key-value-aio` Redis store with Fernet encryption at rest. That server uses FastMCP's `AzureProvider` which has a richer state surface (six collections). The MCP TS SDK's `ProxyOAuthServerProvider` has a narrower surface -- only DCR client registrations need external storage (authorization codes, tokens, and PKCE state are Entra's responsibility since the proxy forwards those operations upstream).

## Decision

1. **Persist DCR client registrations in Redis** via a `RedisOAuthClientsStore` class implementing `OAuthRegisteredClientsStore`. Keys: `oauth:clients:{client_id}`. Values: JSON-serialised `OAuthClientInformationFull`. No TTL -- registrations persist until manually evicted.

2. **Use node-redis v4** (`redis` npm package), the same client library used for the `/readyz` health probe. One shared `RedisClientType` instance for the process -- health checks and DCR storage use the same connection pool.

3. **No encryption at rest in v0.** cin7-mcp wraps its Redis store with a Fernet encryption layer. This fork explicitly defers encryption at rest as a follow-up (documented in requirements Non-Goals). The trade-off is accepted because:
   - DCR client records contain `client_id`, `client_secret`, `redirect_uris`, and metadata. The `client_secret` is the most sensitive field, but it is a machine-generated credential that is only meaningful to the MCP client that registered it -- not a user credential.
   - The deployment's Redis instance is not internet-exposed; access requires cluster-internal connectivity.
   - Adding encryption at rest is additive -- the `RedisOAuthClientsStore` interface does not change. A wrapper can be inserted later without touching callers.

4. **`oauth:` key prefix** for namespace hygiene, matching cin7-mcp's convention. Distinct from any future response cache or rate-limit keys.

5. **Redis is a hard dependency in non-local mode.** Startup probes Redis with `PING`; failure crashes the process. `/readyz` checks Redis health continuously. In `ENVIRONMENT=local`, Redis is not used (the `LocalBearerVerifier` has no DCR state).

6. **`RedisOAuthClientsStore` uses a narrow Redis interface (`get`/`set`).** The constructor accepts `{ get: (key: string) => Promise<string | null>, set: (key: string, value: string) => Promise<unknown> }` rather than the full `RedisClientType`. This keeps the class independently testable with a plain in-memory fake and avoids coupling the store's interface to node-redis's full API surface. The caller (`buildAuth` in `src/http/auth/build.ts`) binds the concrete client's methods at the callsite.

## Consequences

**Positive:**
- Pod restarts and rolling deploys no longer force MCP clients to re-register. DCR client registrations survive the restart.
- Multi-replica scale-out is unblocked. Any replica can serve any registered client because the state is shared.
- One connection pool for the whole process (health + DCR). No new client library beyond `redis` which is already needed for health probes.
- `oauth:clients:*` keyspace is visible via `redis-cli KEYS "oauth:clients:*"` for operational debugging.
- The narrow `{ get, set }` interface makes `RedisOAuthClientsStore` testable without a running Redis instance, without testcontainers, and without importing the full node-redis type.

**Negative:**
- Redis availability becomes part of the auth critical path in non-local mode. A Redis outage means new DCR registrations fail and existing client lookups fail. Mitigation: Redis was already a requirement for health probes; this adds DCR to the same dependency.
- No encryption at rest means anyone with Redis read access can see DCR client records in plaintext. Mitigation: cluster-internal Redis, not internet-exposed. Encryption is a follow-up.
- `redis` npm package is a new runtime dependency (though it was already required for the `/readyz` health check).

## Alternatives Considered

- **In-memory Map (SDK example pattern)** -- rejected. State is lost on pod restart. Every deploy forces every connected MCP client to re-register, which interrupts the Entra consent flow for every user. Pain scales with deploy cadence and active user count.

- **Filesystem persistence (write JSON to a PVC)** -- rejected. The state is shaped like a key-value store, not a filesystem. Mounting a PVC for JSON files uses the wrong tool. RWO disks (the default on AKS) bind to a single pod, blocking rolling deploys. RWX (Azure Files) adds latency and cost. Either way, multi-replica requires migrating to a shared store later.

- **External managed store (Azure Cache for Redis, Cosmos DB)** -- rejected. Over-engineered for the data volume (a handful of DCR registrations). Adds an infrastructure ownership boundary. The self-hosted Valkey instance already runs in the stack.

- **Encrypt at rest in v0 (match cin7-mcp)** -- deferred, not rejected. cin7-mcp uses `py-key-value-aio`'s Fernet wrapper, which derives a key from `ENTRA_CLIENT_SECRET`. The Node.js equivalent would require implementing PBKDF2 + Fernet-compatible symmetric encryption or pulling in a new dependency. The incremental security value is low given cluster-internal Redis. This is explicitly tracked as a follow-up in the requirements Non-Goals.
