# Response Size & 502 Stability

## Idea

Some list tools return enormous, unpaginated responses, and the deployed origin intermittently returns
502s. We want the tool surface to stay within safe response sizes and the deployment to serve reliably
under normal use. Split out of feature 004 (which handled response *formatting* only, now merged in PR #8)
because this spans backend + infra and needs live pod logs to root-cause.

> **Related backlog item:** *General Ledger Access & Connector Session Persistence* covers the **opposite**
> symptom — tools that return too *little* (handlers hard-code `pageSize: 10`, and there is no GL tool at
> all). This item is about responses that are too *big*. Both are facets of one pagination/response-size
> strategy — whoever picks up either should design them together so the tool surface ends up coherent
> (sensible page sizes, consistent "showing N of M, call with page X" messaging, and a size ceiling).

## Notes

Discovered 2026-07-05 while exercising the deployed `Xero MCP` server for feature 004.

### Response size (backend)
- `list-items` returns **19,789 items ≈ 8.3 MB** in a single call. The tool exposes a `page` param, but
  **Xero's Items endpoint does not paginate** — `getItems(...page...)` returns everything, so `page` is a
  no-op. Handler: `src/handlers/list-xero-items.handler.ts`; tool: `src/tools/list/list-items.tool.ts`.
- `list-accounts` returns **598 accounts ≈ 116 KB**, no `page` param at all. Handler:
  `src/handlers/list-xero-accounts.handler.ts`; tool: `src/tools/list/list-accounts.tool.ts`.
- Both exceed the harness per-response token cap (results had to be spilled to disk). An 8.3 MB response
  will break/blow the context of most MCP clients.
- Options to weigh: server-side page-slicing + honest "showing N of M, call with page X" messaging;
  a hard response-size guard with truncation notice; field trimming (the verbose raw-`Date` suffix alone
  was ~9% of the items payload — **now trimmed by feature 004's ISO date fix, merged in PR #8**, so a
  fresh size measurement is worth taking before scoping); or a `search`/filter-first pattern so clients
  don't pull the whole catalogue.
- Symptom mapping (from first-user feedback): the "keeps disconnecting mid-use" complaint is most likely
  the **502s** below (large response → origin crash), as distinct from the *session-expiry re-login*
  complaint, which is the connector-session issue in the GL/session backlog item.
- Note: some of this is arguably upstream behaviour (PR to `XeroAPI/xero-mcp-server`); decide upstream-vs-
  fork per PRD §8 when scoping.

### Origin 502s (infra)
- Intermittent `502 Bad Gateway` from Cloudflare ("origin returned an invalid or incomplete response")
  hitting `list-tracking-categories`, `list-contact-groups`, `list-contacts` during the survey — several
  coincided with concurrent (parallel) tool calls and/or large responses.
- **Hypotheses (unconfirmed — need live data):** (1) large-response memory spikes hitting the pod's
  **1 Gi** limit (`charts/xero-mcp/values.yaml:27-29`) → OOMKill → restart → 502; (2) single-replica
  origin overwhelmed by concurrent requests; (3) ingress/Cloudflare response-size or time limits.
- `express.json()` in `src/http/server.ts:106` sets no explicit limit (default 100 KB) — inbound only, so
  not the cause of outbound 502s, but worth setting explicitly while here.

### Diagnostics to run when this feature starts (owner can provide `kubectl` access)
- `kubectl get pods -l app=xero-mcp` — restart counts.
- `kubectl describe pod <pod>` — look for `OOMKilled` / `Last State: Terminated (reason: OOMKilled)`.
- `kubectl get events --sort-by=.lastTimestamp` — OOM / eviction events.
- `kubectl top pod <pod>` — memory headroom vs the 1 Gi limit during a `list-items` call.
- Correlate a deliberate `list-items` call with pod memory and any restart.

## Layers
backend (response-size guarding / pagination messaging) + infra (pod memory limits, replica count,
ingress limits).
