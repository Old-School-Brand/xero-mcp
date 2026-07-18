/**
 * Single source of truth for the "there may be more" pagination message
 * appended to the five transaction list tools (invoices, manual journals,
 * bank transactions, credit notes, payments) when a full page is returned.
 */
export function paginationHint(
  count: number,
  page: number,
  pageSize = 100,
): string | null {
  return count === pageSize
    ? `Showing ${count} — call with page ${page + 1} for more`
    : null;
}
