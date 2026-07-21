/*
Task: 4.2 — activeOnly param (default true) drives the where clause; new list-accounts.tool.test.ts
Source: .specs/007-response-shape/backend/todo.md

Examples covered:
  - Example 10: activeOnly default filters to ACTIVE (AC 5)
  - Example 11: activeOnly false returns all accounts (AC 5)

Test plan:
  - test_noArgs_callsHandlerWithActiveOnlyWhereClause: default activeOnly passes the
    Status=="ACTIVE" where clause, and the response envelope's showing matches the
    mock result length
  - test_activeOnlyFalse_callsHandlerWithUndefinedWhere: explicit activeOnly:false passes
    no where clause
*/
import { describe, it, expect, vi, beforeEach } from "vitest";

const { listXeroAccounts } = vi.hoisted(() => ({ listXeroAccounts: vi.fn() }));

vi.mock("../../handlers/list-xero-accounts.handler.js", () => ({ listXeroAccounts }));

import ListAccountsTool from "../../tools/list/list-accounts.tool.js";

beforeEach(() => {
  listXeroAccounts.mockReset();
  listXeroAccounts.mockResolvedValue({ result: [], isError: false, error: null });
});

describe("list-accounts tool — activeOnly", () => {
  it("test_noArgs_callsHandlerWithActiveOnlyWhereClause", async () => {
    const mockAccounts = [{ accountID: "1" }, { accountID: "2" }];
    listXeroAccounts.mockResolvedValue({ result: mockAccounts, isError: false, error: null });

    const result = await ListAccountsTool().handler({} as never, {} as never);
    const content = result.content as { type: "text"; text: string }[];

    expect(listXeroAccounts).toHaveBeenCalledWith('Status=="ACTIVE"');
    const parsed = JSON.parse(content[0].text) as { showing: number };
    expect(parsed.showing).toBe(mockAccounts.length);
  });

  it("test_activeOnlyFalse_callsHandlerWithUndefinedWhere", async () => {
    await ListAccountsTool().handler({ activeOnly: false } as never, {} as never);

    expect(listXeroAccounts).toHaveBeenCalledWith(undefined);
  });
});
