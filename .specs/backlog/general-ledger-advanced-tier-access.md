# General Ledger tool — blocked on Xero Advanced-tier access

## Status

**Deferred / blocked.** The `list-account-transactions` GL tool was built as workstream A of
feature **005-xero-usability**, merged, deployed to dev, then **reverted** (branch
`revert/005-gl-tool`) after live testing proved the Xero Journals endpoint is access-gated. The
pagination (`pageSize 10→100`) and `offline_access` fixes from 005 shipped and stayed.

## Why it was reverted (verified 2026-07-18)

Live call on dev (`sha-2964151`) returned a Xero error. The Xero developer portal confirmed the
cause: **the developer app is on the Starter plan, and the Journals endpoint is an *Advanced* plan
feature.** This is an **app-tier** gate (the developer-platform plan), not the org's Xero accounting
subscription.

Per Xero's own docs (verified):
- **Advanced developer-app plan** required — ~**AUD $1,445/month** (Journals is *not* on the $35 AUD
  Core plan; Core only raises connections/egress/rate-limits).
- **Security assessment** required — initial **and** annual.
- **Use-case approval** required from Xero (via My App → request Journals; Developer Platform
  Support: https://developer.xero.com/contact-xero-developer-platform-support).
- Effective **2 March 2026**. Sources:
  - https://developer.xero.com/documentation/api/accounting/journals ("requires a security
    assessment (initial and annual) and use case approval, and is only available starting at the
    Advanced tier")
  - https://developer.xero.com/faq/pricing-and-policy-updates

## Open blocker beyond cost — AI data-usage policy

Also effective 2 March 2026: *"the use of data obtained through Xero's APIs to train or contribute
to the creation of any AI or machine learning model"* is prohibited. This is an MCP server feeding
an LLM. Inference (answering in the moment) is likely fine and Anthropic doesn't train on API
inputs by default, but "contribute to the creation of any AI model" can be read broadly — **raise
the MCP/LLM-inference use case explicitly with Xero during use-case approval** before assuming it
clears. There is also a "Building for internal use" path worth asking about (our app is
internal-only).

## If we revive this (only if the org buys Advanced access)

1. Confirm the **correct app** (the xero-mcp connector's `XERO_CLIENT_ID`, not the Airbyte app) is
   on the Advanced plan and its refresh token carries `accounting.journals.read`.
2. **Build it on feature 006 (Valkey journal-store/cache), not standalone.** Xero's own docs say
   `If-Modified-Since` "may cause missing journals" and recommend syncing by **offset** — an
   incremental offset sync into a local store is both lossless and fast. Filtering the store by
   `JournalDate` gives correct-and-fast GL; the standalone `ifModifiedSince` tool cannot.
3. **Two known bugs to fix in the reverted code before reuse** (see git history of the reverted
   `src/handlers/list-xero-account-transactions.handler.ts`):
   - **Partial-page truncation:** the handler stopped and marked complete on a `<100` page. Xero
     documents that a partial page does **not** indicate end-of-data; the end signal is an **empty**
     response. Stopping on a short page can silently truncate a ledger.
   - **Opaque error:** `formatError` returned the generic "unexpected error" for the Journals 403
     because the rejection shape carried `response.status` (axios), not `response.statusCode`.
     Teach `formatError` the axios shape so denials surface clearly.
4. The reverted implementation (deep module, account code/UUID detection, continuation cursor,
   `complete`/`warning` envelope) is a good starting point — recover it from the 005 merge commit.

## Layers
backend (tool) + a business decision (Advanced-tier subscription + Xero approval).
