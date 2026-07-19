import { z } from "zod";
import { listXeroContactGroups } from "../../handlers/list-xero-contact-groups.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import { listResponse } from "../../helpers/json-response.js";

const ListContactGroupsTool = CreateXeroTool(
  "list-contact-groups",
  `List all contact groups in Xero.
  You can optionally specify a contact group ID to retrieve details for that specific group, including its contacts.`,
  {
    contactGroupId: z
      .string()
      .optional()
      .describe("Optional ID of the contact group to retrieve"),
  },
  async (args) => {
    const response = await listXeroContactGroups(args?.contactGroupId);

    if (response.error !== null) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error listing contact groups: ${response.error}`,
          },
        ],
      };
    }

    return listResponse(response.result);
  },
);

export default ListContactGroupsTool;
