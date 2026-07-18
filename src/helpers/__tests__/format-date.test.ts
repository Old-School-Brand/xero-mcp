/*
Task: 1.1-1.4 formatDate and formatDateTime: full pure-function coverage
Source: .specs/004-response-formatting-fixes/backend/todo.md

Examples covered:
  - Example 7: formatDate with Date object (AC 10)
  - Example 9: formatDate with undefined (AC 10)
  - Example 8: formatDate with tz-naive Xero datetime string (AC 10)
  - Example 14: formatDate with non-date-prefixed parseable string (AC 10)
  - Example 10: formatDate with unparseable string (AC 10)
  - Example 11: formatDateTime with Date object (AC 11)
  - Example 12: formatDateTime with undefined (AC 11)

Test plan:
  - test_date_object_input_returns_calendar_date: formatDate(Date) returns YYYY-MM-DD
  - test_undefined_input_returns_undefined: formatDate(undefined) returns undefined
  - test_bare_date_string_returns_same_date: formatDate("2022-07-22") slice passthrough
  - test_tz_naive_datetime_string_returns_calendar_date: formatDate("2022-07-22T00:00:00") returns "2022-07-22" regardless of process TZ
  - test_non_prefixed_parseable_string_returns_calendar_date: formatDate("28 June 2026") returns "2026-06-28"
  - test_unparseable_string_returns_passthrough: formatDate("not-a-date") returns "not-a-date"
  - test_date_prefixed_string_is_tz_immune: regex-slice branch unaffected by process TZ (guards against toISOString regression)
  - test_non_prefixed_parse_is_tz_immune: parse branch uses local components, unaffected by process TZ
  - test_datetime_date_object_input_returns_iso_8601: formatDateTime(Date) returns full ISO 8601
  - test_datetime_undefined_input_returns_undefined: formatDateTime(undefined) returns undefined
*/
import { describe, it, expect } from "vitest";
import { formatDate, formatDateTime } from "../format-date.js";

describe("formatDate", () => {
  it("test_date_object_input_returns_calendar_date", () => {
    const value = new Date("2026-07-04T00:00:00.000Z");
    expect(formatDate(value)).toBe("2026-07-04");
  });

  it("test_undefined_input_returns_undefined", () => {
    expect(formatDate(undefined)).toBeUndefined();
  });

  it("test_bare_date_string_returns_same_date", () => {
    expect(formatDate("2022-07-22")).toBe("2022-07-22");
  });

  it("test_tz_naive_datetime_string_returns_calendar_date", () => {
    expect(formatDate("2022-07-22T00:00:00")).toBe("2022-07-22");
  });

  it("test_non_prefixed_parseable_string_returns_calendar_date", () => {
    expect(formatDate("28 June 2026")).toBe("2026-06-28");
  });

  it("test_unparseable_string_returns_passthrough", () => {
    expect(formatDate("not-a-date")).toBe("not-a-date");
  });

  // Timezone-regression guards. Both cases force a positive-UTC-offset process
  // timezone so they FAIL if the implementation is ever refactored to build the
  // calendar date via `new Date(value).toISOString().slice(0,10)` (which shifts
  // the day backwards under UTC+n). The correct impl (regex-slice / local
  // components) is tz-immune, so these pass in every CI timezone — the forced TZ
  // is what makes the test able to catch the regression even when CI runs at UTC.
  it("test_date_prefixed_string_is_tz_immune", () => {
    const orig = process.env.TZ;
    process.env.TZ = "Pacific/Kiritimati"; // UTC+14
    try {
      expect(formatDate("2022-01-01T00:30:00")).toBe("2022-01-01");
    } finally {
      process.env.TZ = orig;
    }
  });

  it("test_non_prefixed_parse_is_tz_immune", () => {
    const orig = process.env.TZ;
    process.env.TZ = "Pacific/Kiritimati"; // UTC+14
    try {
      expect(formatDate("Jan 1 2022 00:30:00")).toBe("2022-01-01");
    } finally {
      process.env.TZ = orig;
    }
  });
});

describe("formatDateTime", () => {
  it("test_datetime_date_object_input_returns_iso_8601", () => {
    const value = new Date("2026-07-05T15:07:49.000Z");
    expect(formatDateTime(value)).toBe("2026-07-05T15:07:49.000Z");
  });

  it("test_datetime_undefined_input_returns_undefined", () => {
    expect(formatDateTime(undefined)).toBeUndefined();
  });
});
