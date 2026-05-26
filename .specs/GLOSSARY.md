# GLOSSARY.md — xero-mcp

The single source of canonical domain vocabulary for this repo. Refinery, foundry, and the build agent all read this file before doing work that involves domain language.

**How to use this file:**

- When writing requirements.md, design.md, todo.md, or production code: use the canonical **Term** verbatim. Never invent synonyms.
- If a discussion surfaces a term that isn't here, refinery appends it to a `## Glossary additions` section in `requirements.md`. Foundry promotes confirmed additions into this file during design.
- Keep definitions short — one sentence ideally, two if a constraint or invariant is essential.

> The seed terms below are deliberately tight. Adjust as the domain evolves; do not bloat with examples or commentary that belongs in the PRD.

---

## MCP

| Term | Definition | Aliases to avoid |
|---|---|---|
| **MCP** | Model Context Protocol — the JSON-RPC-over-stdio protocol this server speaks. | Anthropic protocol (too generic) |
| **MCP Server** | A process that exposes one or more **Tools** to MCP clients. This repo is one. | server (qualify as MCP Server) |
| **MCP Client** | A process that connects to an MCP Server and invokes its tools. Claude Desktop, the MCP Inspector, and custom agents are all clients. | host (ambiguous), consumer |
| **Tool** | A named, schema-typed operation an MCP client can invoke. Lives under `src/tools/{create,list,update,delete,get}/` and is wired into `ToolFactory`. | function, command, action |
| **Handler** | The implementation function for a Tool. Lives under `src/handlers/` as `{verb}-xero-{resource}.handler.ts`. Calls the Xero SDK and returns a `ToolResponse`. | callback, executor |
| **Tool Factory** | `src/tools/tool-factory.ts` — registers every Tool with the singleton `McpServer`. Adding a tool means wiring it here. | registry, registrar |
| **Transport** | The wire protocol between MCP server and client. This server uses **stdio** (`StdioServerTransport`). | channel, IO layer |
| **Inspector** | The `@modelcontextprotocol/inspector` dev tool — a local web UI that connects to an MCP server over stdio and lets you list/invoke tools manually. | playground, debugger |

## Xero

| Term | Definition | Aliases to avoid |
|---|---|---|
| **Xero** | The accounting/payroll SaaS this server integrates with via `xero-node`. | Xero Accounting (qualify only when distinguishing from Xero Payroll) |
| **Custom Connection** | A Xero OAuth 2.0 client-credentials grant scoped to a single Xero organisation. Authenticated with `XERO_CLIENT_ID` + `XERO_CLIENT_SECRET`. Only available in UK, US, and NZ. Removed from this fork by ADR 0001. | client credentials connection |
| **Bearer Token** | A pre-issued OAuth access token passed via `XERO_CLIENT_BEARER_TOKEN`. Used when an external flow (e.g. PKCE) has already obtained a token. Removed from this fork by ADR 0001. | access token (ambiguous), API key |
| **Web Application** | A Xero OAuth 2.0 app type (available to all regions) that uses the `authorization_code` grant. Produces a refresh token that can be exchanged for access tokens. The only app type available to operators outside UK/US/NZ. | "web app" (acceptable in prose, but use full term in code and spec) |
| **Refresh Token mode** | The single auth mode in `xero-client.ts`. Authenticates by exchanging a stored refresh token for an access token via `POST /connect/token` with `grant_type=refresh_token`. Replaces Custom Connection mode and Bearer Token mode. | "OAuth2 mode" (too vague) |
| **Token file** | The local file storing the current (most-recently-rotated) refresh token. Defaults to `~/.xero-mcp/refresh_token`; overridable via `XERO_TOKEN_FILE`. Written with `0600` permissions. | "token cache" (implies access token caching, which is out of scope) |
| **Token rotation** | Xero's behaviour of issuing a new refresh token and immediately invalidating the old one on every token exchange. The server must persist the new token after every exchange to avoid startup failures on subsequent restarts. | "token refresh" (too generic; use "token exchange" for the HTTP call and "token rotation" for Xero's invalidate-and-reissue behaviour) |
| **Scope** | A permission string a Xero token carries (e.g. `accounting.invoices`, `payroll.timesheets`). Scopes are configured on the Xero Web Application, not by this server. | permission, role |
| **Tenant** | A Xero organisation. `XeroClient.tenants[]` carries the list; `tenantId` selects which to call. A Web Application connection has one tenant per authorised org. | org (use "tenant" in code; "organisation" in prose is fine) |
| **Demo Company** | Xero's sandbox tenant with pre-loaded sample data, switchable from the top-left Xero dropdown. The recommended target for any test mutation. | test org, sandbox |

## Fork

| Term | Definition | Aliases to avoid |
|---|---|---|
| **Upstream** | The original [`XeroAPI/xero-mcp-server`](https://github.com/XeroAPI/xero-mcp-server) repository. We track its `main`. | parent, source repo |
| **Fork charter** | The narrow scope this fork exists to serve: security and deployment improvements layered onto upstream. Captured in `.specs/PRD.md`. | mission, mandate |
| **Org-specific** | A change that is valuable only to us and so belongs in this fork, not as an upstream PR. See `.specs/PRD.md` section 8 for the decision rule. | local, private |
| **Upstream sync** | The merge cadence pulling `upstream/main` into our `main`. Documented in `.specs/REPO.md` section Upstream Sync. | merge, rebase (we merge, not rebase) |

---

<!--
Glossary additions land here from foundry as confirmed.
Format: `| **Term** | Definition. | aliases |` under the appropriate section above,
or in a new section if no existing one fits.
-->
