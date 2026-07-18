/*
 * Read-only tool gating for ToolFactory.
 *
 * Read-only is the default posture: only Get + List tools are registered.
 * Write tools (Create/Update/Delete) register only when XERO_READONLY=false.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { ToolFactory } from "../../tools/tool-factory.js";

function registeredToolNames(): string[] {
  const tool = vi.fn();
  const server = { tool } as unknown as McpServer;
  ToolFactory(server);
  return tool.mock.calls.map((call) => call[0] as string);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("ToolFactory read-only gating", () => {
  it("registers only read tools by default (XERO_READONLY unset)", () => {
    vi.stubEnv("XERO_READONLY", "");
    const names = registeredToolNames();

    expect(names).toContain("list-invoices");
    expect(names).toContain("list-account-transactions"); // Example 17 — new GL tool registered
    expect(names).toContain("get-timesheet");
    expect(names).not.toContain("create-invoice");
    expect(names).not.toContain("update-contact");
    expect(names).not.toContain("delete-timesheet");
  });

  it("registers only read tools when XERO_READONLY=true", () => {
    vi.stubEnv("XERO_READONLY", "true");
    const names = registeredToolNames();

    expect(names).toContain("list-contacts");
    expect(names).not.toContain("create-invoice");
  });

  it("registers write tools when XERO_READONLY=false", () => {
    vi.stubEnv("XERO_READONLY", "false");
    const names = registeredToolNames();

    expect(names).toContain("list-invoices");
    expect(names).toContain("create-invoice");
    expect(names).toContain("update-contact");
    expect(names).toContain("delete-timesheet");
  });
});
