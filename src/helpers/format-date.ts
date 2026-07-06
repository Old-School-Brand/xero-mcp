const DATE_PREFIX = /^\d{4}-\d{2}-\d{2}/;

export function formatDate(value: Date | string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (DATE_PREFIX.test(value)) return value.slice(0, 10);

  // Non-ISO strings (e.g. report `reportDate`: "28 June 2026") are parsed by
  // `Date` as local midnight. Read back local components (not `toISOString`,
  // which converts to UTC) so the result matches the string's calendar date
  // regardless of the process timezone.
  const parsed = new Date(value);
  if (isNaN(parsed.getTime())) return String(value);
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatDateTime(value: Date | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value.toISOString();
}
