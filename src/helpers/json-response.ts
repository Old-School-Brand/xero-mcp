/**
 * Wraps a value as the single minified-JSON content block read tools return.
 * `listResponse` adds the `{showing, [hasMore], rows}` envelope for list tools;
 * `hasMore` is only emitted when the caller passes a known page size.
 */
// Xero models carry credential fields (e.g. Organisation.aPIKey, the Xero-to-Xero
// network key) that must never reach tool output. Redacted here so every read tool
// is covered at the single serialization choke point.
const REDACTED_KEYS = new Set(["aPIKey"]);

export function jsonResponse(value: unknown) {
  const text = JSON.stringify(value, (key, v: unknown) =>
    REDACTED_KEYS.has(key) ? undefined : v,
  );
  return { content: [{ type: "text" as const, text }] };
}

export function listResponse<T>(rows: T[] | null, pageSize?: number) {
  const list = rows ?? [];
  return jsonResponse({
    showing: list.length,
    ...(pageSize != null ? { hasMore: list.length === pageSize } : {}),
    rows: list,
  });
}
