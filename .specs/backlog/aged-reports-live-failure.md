# Aged Receivables/Payables — live failure on every call

## Idea

Both `list-aged-receivables-by-contact` and `list-aged-payables-by-contact` currently fail on
every invocation against the live org. Root-cause and fix (or, if genuinely unsupportable, remove
the tools from the advertised surface).

## Notes

Discovered 2026-07-20 while scoping feature 007-response-shape.

- Every call errors with `"An unexpected error occurred while communicating with Xero."` — tried 4
  valid contactIDs (customers and suppliers), with and without `reportDate` /
  `invoicesFromDate/ToDate`, plus a deliberately malformed `contactId` ("not-a-uuid"). All produce
  the identical message.
- That message is `formatError`'s **final fallback** (`src/helpers/format-error.ts`): the rejected
  value matched none of AxiosError / Xero-SDK error shape (`response.statusCode`) / `Error`. Even
  the malformed-UUID call (a guaranteed Xero 4xx) hit the fallback, so the SDK's rejection for this
  endpoint is an unrecognized shape end-to-end.
- **Not a permissions/plan gate**: a 403 would have surfaced as "You don't have permission…" (both
  Axios and SDK shapes map it). So this is NOT another Journals-style paid-tier limitation — it
  looks like a code-level bug (in our handler's error path at minimum, possibly in xero-node's
  `getReportAgedReceivablesByContact` response/error deserialization).
- Handler call signature verified correct against `xero-node` typings
  (`getReportAgedReceivablesByContact(tenantId, contactId, date?, fromDate?, toDate?, options?)`).
- Pod logs show nothing (handlers don't log Xero errors; pino-http only logs the HTTP layer).
  First diagnostic step when picking this up: temporarily log the raw rejected value (redacting
  `request.headers.authorization` — see the formatError doc-comment for why) or reproduce against
  a Demo Company with a local build.
- Feature 007 covers these tools' *response shape* via fixture-based unit tests only; the live
  failure is deliberately out of 007's scope (owner decision, 2026-07-20).

## Layers

backend
