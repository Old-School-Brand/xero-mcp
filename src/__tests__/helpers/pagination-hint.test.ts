/*
 * Task: 1.1 — `paginationHint` shared helper (B0)
 * Source: .specs/005-xero-usability/backend/todo.md
 *
 * Examples covered:
 *   - Example 12: "showing N" messaging when full page returned (AC 6)
 *   - Example 13: No continuation messaging when partial page (AC 6)
 *
 * Test plan:
 *   - test_fullPage_returnsShowingMessage: count === pageSize returns the hint string
 *   - test_partialPage_returnsNull: count < pageSize returns null
 */

import { describe, it, expect } from "vitest";
import { paginationHint } from "../../helpers/pagination-hint.js";

describe("paginationHint", () => {
  it("test_fullPage_returnsShowingMessage", () => {
    expect(paginationHint(100, 1)).toBe(
      "Showing 100 — call with page 2 for more",
    );
  });

  it("test_partialPage_returnsNull", () => {
    expect(paginationHint(42, 1)).toBeNull();
  });
});
