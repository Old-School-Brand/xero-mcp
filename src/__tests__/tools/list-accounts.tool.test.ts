/*
Task: 4.2 — activeOnly param (default true) drives the where clause; new list-accounts.tool.test.ts
Source: .specs/007-response-shape/backend/todo.md

Examples covered:
  - Example 10: activeOnly default filters to ACTIVE (AC 5)
  - Example 11: activeOnly false returns all accounts (AC 5)

Test plan:
  - test_noArgs_callsHandlerWithActiveOnlyWhereClause: default activeOnly passes the
    Status=="ACTIVE" where clause
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
    await ListAccountsTool().handler({} as never, {} as never);

    expect(listXeroAccounts).toHaveBeenCalledWith('Status=="ACTIVE"');
  });

  it("test_activeOnlyFalse_callsHandlerWithUndefinedWhere", async () => {
    await ListAccountsTool().handler({ activeOnly: false } as never, {} as never);

    expect(listXeroAccounts).toHaveBeenCalledWith(undefined);
  });
});
