/**
 * Wraps a value as the single minified-JSON content block read tools return.
 * `listResponse` adds the `{showing, [hasMore], rows}` envelope for list tools;
 * `hasMore` is only emitted when the caller passes a known page size.
 */
export function jsonResponse(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}

export function listResponse<T>(rows: T[] | null, pageSize?: number) {
  const list = rows ?? [];
  return jsonResponse({
    showing: list.length,
    ...(pageSize != null ? { hasMore: list.length === pageSize } : {}),
    rows: list,
  });
}
