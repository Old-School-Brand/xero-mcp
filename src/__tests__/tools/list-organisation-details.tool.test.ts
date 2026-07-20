/*
Hotfix: redact Organisation.aPIKey (Xero-to-Xero network key) from tool output.
Regression introduced by 006-json-everywhere's raw-JSON passthrough — see ADR-0005.

Test plan:
  - test_aPIKey_redactedFromResponse: mocked Organisation with aPIKey emits no aPIKey
  - test_businessFields_surviveRedaction: name/organisationID/shortCode remain intact
*/

import { describe, it, expect, vi, beforeEach } from "vitest";

const { listXeroOrganisationDetails } = vi.hoisted(() => ({
  listXeroOrganisationDetails: vi.fn(),
}));

vi.mock("../../handlers/list-xero-organisation-details.handler.js", () => ({
  listXeroOrganisationDetails,
}));

import ListOrganisationDetailsTool from "../../tools/list/list-organisation-details.tool.js";

const organisation = {
  organisationID: "org-1",
  aPIKey: "RSXP-FAKE-NETWORK-KEY",
  name: "Old School Brand (Pty) Ltd",
  shortCode: "!abc12",
  paysTax: true,
};

async function run() {
  const result = await ListOrganisationDetailsTool().handler(
    {} as never,
    {} as never,
  );
  const content = result.content as { type: "text"; text: string }[];
  expect(content).toHaveLength(1);
  return JSON.parse(content[0].text) as Record<string, unknown>;
}

beforeEach(() => {
  listXeroOrganisationDetails.mockReset();
  listXeroOrganisationDetails.mockResolvedValue({
    result: organisation,
    isError: false,
    error: null,
  });
});

describe("list-organisation-details tool — aPIKey redaction", () => {
  it("test_aPIKey_redactedFromResponse", async () => {
    const details = await run();

    expect(details).not.toHaveProperty("aPIKey");
    expect(JSON.stringify(details)).not.toContain("RSXP-FAKE-NETWORK-KEY");
  });

  it("test_businessFields_surviveRedaction", async () => {
    const details = await run();

    expect(details).toMatchObject({
      organisationID: "org-1",
      name: "Old School Brand (Pty) Ltd",
      shortCode: "!abc12",
      paysTax: true,
    });
  });
});
