# 0002. MCP HTTP transport and OAuth model

| Field       | Value                                                                        |
|-------------|------------------------------------------------------------------------------|
| Status      | Accepted                                                                     |
| Date        | 2026-05-26                                                                   |
| Decided by  | Llewellyn Strydom (CTO)                                                      |
| Source      | `.specs/002-http-transport-and-oauth/backend/requirements.md`, cin7-mcp ADR-0001, [MCP Authorization spec 2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization) |
| Supersedes  | --                                                                           |

## Context

xero-mcp communicates over stdio -- one process per user, credentials in the environment, no inbound authentication. This model fits a developer running the binary under Claude Desktop but does not fit a deployed, multi-user service. The fork charter (PRD section 4.2) calls for a containerised runtime with identity-based access control.

The MCP Authorization spec (2025-06-18) mandates specific behaviour for HTTP-based transports: the MCP server acts as an OAuth 2.1 Resource Server, advertises authorization-server location via RFC 9728 Protected Resource Metadata, returns `WWW-Authenticate: Bearer` on 401, and requires clients to use PKCE. A traditional perimeter OAuth2 proxy (oauth2-proxy, Traefik ForwardAuth) cannot fulfil this -- MCP clients are not browsers and do not render login pages or follow HTML 302 redirects. The MCP server itself must host the OAuth surface.

The org's sibling MCP server (cin7-mcp, Python, FastMCP) already solves this problem with Entra ID OAuth implemented inside the server (cin7-mcp ADR-0001). We want the same posture here, adapted for the Node.js MCP TS SDK.

The MCP TS SDK v1.x provides the building blocks: `StreamableHTTPServerTransport` for the wire protocol, `ProxyOAuthServerProvider` to proxy DCR/authorize/token to an upstream IdP, `mcpAuthRouter` to mount the OAuth endpoints, and `requireBearerAuth` middleware for per-request token validation.

## Decision

1. **Transport** -- Streamable HTTP, mounted at `/mcp`. The MCP TS SDK's `StreamableHTTPServerTransport` handles JSON-RPC over `POST /mcp` and server-to-client SSE on `GET /mcp`. Session management is per-`Mcp-Session-Id`, with each session getting its own transport and `McpServer` instance. The existing stdio entry (`src/index.ts` -> `dist/index.js`) remains unchanged.

2. **Auth (non-local)** -- OAuth 2.1 via Entra ID single-tenant. `ProxyOAuthServerProvider` proxies `/authorize` and `/token` to Entra while hosting DCR locally. `requireBearerAuth` validates inbound bearer tokens. Token verification is done locally via `jose.jwtVerify` against Entra's published JWKS (no per-request round-trip to Entra). Required claims: issuer, audience, expiry, and configurable scope(s).

3. **Auth (local)** -- Static bearer matching `DEV_BEARER_TOKEN` via a `LocalBearerVerifier`. No DCR, no `mcpAuthRouter`. Parity with cin7-mcp's `StaticTokenVerifier`.

4. **App framework** -- Express 5 (not Express 4). The SDK's `mcpAuthRouter` and bearer middleware declare `express@^5.2.1` as a peer dependency. Express 5's native async error propagation (rejected promises in route handlers automatically call `next(err)`) also aligns with the design's error-handling approach.

5. **Upstream isolation** -- All new code lives under `src/http/`. No existing upstream file is modified. The existing `tsconfig.json` glob (`src/**/*`) includes `src/http/` automatically. Merge conflicts with upstream are limited to alphabetical additions in `package.json`.

## Consequences

**Positive:**
- MCP Authorization spec compliance is SDK-handled -- discovery endpoints, DCR, PKCE validation, and bearer enforcement are not code we own or maintain.
- Claude Desktop, Claude Code, the MCP Inspector, and other spec-compliant clients connect with no bespoke configuration; users authenticate via their normal Old School Brand Microsoft sign-in.
- Entra single-tenant restriction means only org members can access the server.
- The stdio path is completely untouched, maintaining upstream merge cleanliness.
- Consistent auth posture across cin7-mcp and xero-mcp -- same Entra app registration can serve both servers if the `mcp` scope convention is shared.
- `ENTRA_CLIENT_SECRET` is not required as a server env var — removed in iteration 3 of the feature build. Token exchange in the DCR flow uses the DCR-issued client secret managed by `ProxyOAuthServerProvider` and persisted in Redis. Inbound token verification uses Entra's JWKS public keys; no shared secret is needed. This minimises the server's credential surface area.

**Negative:**
- Entra App registration becomes an operational concern (client ID, scope configuration).
- Per-session `McpServer` + `ToolFactory` instantiation has a one-time cost per session (~70 tool registrations). Acceptable at the 100-session default cap.
- The SDK's `ProxyOAuthServerProvider` owns the OAuth handshake flow. If the MCP spec or SDK changes the OAuth surface, we take the SDK upgrade rather than making a code change.
- Local development requires `DEV_BEARER_TOKEN` in the environment and passing it as a bearer on every request, which is more friction than bare stdio. The MCP Inspector supports custom headers, mitigating this.

## Alternatives Considered

- **External OAuth proxy (oauth2-proxy / Traefik ForwardAuth)** -- rejected. MCP clients are not browsers. They do not render HTML login pages or follow 302 redirects. The MCP Authorization spec requires the server itself to host the OAuth surface (RFC 9728 metadata, DCR, token endpoint). An external proxy cannot fulfil this.

- **supergateway (npm package that wraps a stdio MCP binary in HTTP)** -- rejected. supergateway adds a process boundary, has no OAuth support, and creates a token-rotation race condition when multiple gateway processes share one Xero refresh token. The MCP TS SDK provides in-process HTTP transport natively.

- **SSE-only transport (the deprecated MCP HTTP transport)** -- rejected. The MCP spec deprecated SSE-only in favour of Streamable HTTP. The SDK's `StreamableHTTPServerTransport` supports both SSE (for server-to-client notifications) and direct HTTP responses. Using SSE-only would require the deprecated `SSEServerTransport` and forfeit session management.

- **Modify upstream files to add HTTP mode** -- rejected. The fork tracks upstream and merges regularly. Modifying `src/index.ts` or `src/server/xero-mcp-server.ts` would create permanent merge conflicts. The `src/http/` subdirectory approach isolates all new code at zero upstream conflict cost.
