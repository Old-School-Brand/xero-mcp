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
- **Observed evidence (2026-07-18):** during the feature-004 dev rollout, the outgoing dev pod
  (`xero-mcp/backend:sha-d8f94f4`, namespace `xero-mcp-dev`) had **4 restarts** while the freshly-rolled
  pod (`sha-b70b992`) sat at 0. Restart *count* only — the restart *reason* was not confirmed
  (`kubectl describe pod` / events not checked for `OOMKilled`). Consistent with the large-response →
  OOMKill → 502 hypothesis; run the diagnostics below against the current pod to confirm before scoping.

### Diagnostics to run when this feature starts (owner can provide `kubectl` access)
- `kubectl get pods -l app=xero-mcp` — restart counts.
- `kubectl describe pod <pod>` — look for `OOMKilled` / `Last State: Terminated (reason: OOMKilled)`.
- `kubectl get events --sort-by=.lastTimestamp` — OOM / eviction events.
- `kubectl top pod <pod>` — memory headroom vs the 1 Gi limit during a `list-items` call.
- Correlate a deliberate `list-items` call with pod memory and any restart.

### Post-v0.3.0 tester feedback (2026-07-19) — folds into this item

First-user re-test after the 006-json-everywhere rollout confirmed data accuracy but flagged
format/size issues. Verified measurements (live against the dev instance):

- **Envelope inconsistency:** the 5 report tools never got the `{showing, rows}` envelope
  (ADR-0005 deferred it) — `list-trial-balance` returns 4 content blocks (3 prose lines + Xero's
  raw pretty-printed report tree). Tester asks for one envelope everywhere.
  **Delivered by 007-response-shape**: all 5 report tools now return the structured report
  envelope (`{report, date, updatedAt, columns, sections}`) via a single minified JSON block
  (ADR-0006).
- **Trial balance bloat:** every cell repeats the same account GUID in `attributes` — measured
  **64.4%** of the 441 KB payload (1,795 attribute blocks; 359 rows × 5 cells). A row-level
  transform (account ID once per row) cuts ~60% of the payload.
  **Delivered by 007-response-shape**: `transformReport` hoists and deduplicates per-row
  attributes into one object, and the `jsonResponse` replacer omits empty-string/null values
  globally (ADR-0006).
- **list-accounts:** 609 rows / ~265 KB, no pagination, no `activeOnly` filter (35 rows are
  ARCHIVED). Tester asks for field-trimming (`code, name, ID, type, status` cover most uses)
  and/or a `fields` param.
  **`activeOnly` half delivered by 007-response-shape**: `list-accounts` now defaults to
  `activeOnly=true` (Xero-side `Status=="ACTIVE"` filter), excluding the 35 archived rows by
  default. The field-trimming / `fields`-param request stays **out of scope** (007's explicit
  Non-Goal — no curated per-tool field lists) and remains open here if ever picked up.
- **Sensitive fields for the trimming discussion:** `bankAccountNumber` has real values on the
  26 bank-type account rows; `list-organisation-details` emits PII-adjacent registry data
  (tax number, named contact, phones). Credential redaction (`aPIKey`) already shipped as a
  hotfix (ADR-0005 amendment); these are field-*selection* questions, not redaction.
- **Not a bug:** tester's `"showing":609` vs 608 pre-upgrade — `showing` is exactly
  `rows.length`; the chart of accounts is growing (598 on 2026-07-05 → 609 on 2026-07-19), so
  the delta is a real record.

**Owner's design constraint for scoping (discuss before refinery):** medium-sized responses are
the worst outcome — they dump straight into LLM context. Prefer either **short** responses
(trimmed fields, filters, small pages) or **deliberately large file-spill** responses that
clients analyze via scripts. Don't optimize toward the middle.

## Layers
backend (response-size guarding / pagination messaging) + infra (pod memory limits, replica count,
ingress limits).
