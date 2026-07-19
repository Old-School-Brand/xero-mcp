/*
Task: 1 — `jsonResponse` + `listResponse` helper
Source: .specs/006-json-everywhere/backend/todo.md

Examples covered:
  - jsonResponse wraps any value as one minified-JSON content block (AC1)
  - listResponse envelope shape, showing count, empty case, 0-value survives,
    hasMore true/false/absent per pageSize (AC1, AC6)

Test plan:
  - test_jsonResponse_wrapsValueAsSingleMinifiedJsonBlock: arbitrary value round-trips through content[0].text
  - test_listResponse_buildsShowingAndRowsEnvelope: rows present, showing === rows.length
  - test_listResponse_emptyRows_showingZeroEmptyArray: null rows renders showing:0, rows:[]
  - test_listResponse_zeroValueField_survives: a 0-valued field on a row is not dropped
  - test_listResponse_hasMoreTrue_whenRowsLengthEqualsPageSize: full page sets hasMore true
  - test_listResponse_hasMoreFalse_whenRowsLengthBelowPageSize: partial page sets hasMore false
  - test_listResponse_hasMoreAbsent_whenNoPageSizeGiven: omitting pageSize omits hasMore entirely
*/
import { describe, it, expect } from "vitest";
import { jsonResponse, listResponse } from "../../helpers/json-response.js";

function parse(result: { content: { type: "text"; text: string }[] }) {
  expect(result.content).toHaveLength(1);
  expect(result.content[0].type).toBe("text");
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

describe("jsonResponse", () => {
  it("test_jsonResponse_wrapsValueAsSingleMinifiedJsonBlock", () => {
    const value = { invoiceID: "inv-1", amountDue: 0 };

    expect(parse(jsonResponse(value))).toEqual(value);
  });

  it("test_jsonResponse_redactsAPIKeyAtAnyDepth_keepsSiblings", () => {
    const value = {
      aPIKey: "top-secret",
      name: "Org",
      nested: { aPIKey: "also-secret", paysTax: false },
    };

    expect(parse(jsonResponse(value))).toEqual({
      name: "Org",
      nested: { paysTax: false },
    });
  });
});

describe("listResponse", () => {
  it("test_listResponse_buildsShowingAndRowsEnvelope", () => {
    const rows = [{ id: "a" }, { id: "b" }];

    expect(parse(listResponse(rows))).toEqual({ showing: 2, rows });
  });

  it("test_listResponse_emptyRows_showingZeroEmptyArray", () => {
    expect(parse(listResponse(null))).toEqual({ showing: 0, rows: [] });
  });

  it("test_listResponse_zeroValueField_survives", () => {
    const rows = [{ invoiceID: "inv-1", amountDue: 0 }];

    expect(parse(listResponse(rows)).rows).toEqual(rows);
  });

  it("test_listResponse_hasMoreTrue_whenRowsLengthEqualsPageSize", () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({ id: i }));

    expect(parse(listResponse(rows, 1000))).toMatchObject({ hasMore: true });
  });

  it("test_listResponse_hasMoreFalse_whenRowsLengthBelowPageSize", () => {
    const rows = [{ id: 1 }];

    expect(parse(listResponse(rows, 1000))).toMatchObject({ hasMore: false });
  });

  it("test_listResponse_hasMoreAbsent_whenNoPageSizeGiven", () => {
    const rows = [{ id: 1 }];

    expect(parse(listResponse(rows))).not.toHaveProperty("hasMore");
  });
});
