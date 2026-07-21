import { z } from "zod";
import { listXeroAccounts } from "../../handlers/list-xero-accounts.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import { listResponse } from "../../helpers/json-response.js";

const ListAccountsTool = CreateXeroTool(
  "list-accounts",
  "Lists accounts in Xero. Use this tool to get the account codes and names to be used when " +
    "creating invoices in Xero. Returns only active accounts by default (activeOnly=true); " +
    "set activeOnly=false to include archived accounts.",
  {
    activeOnly: z.boolean().optional().default(true)
      .describe("When true (default), returns only ACTIVE accounts. Set false to include ARCHIVED."),
  },
  async ({ activeOnly }) => {
    const where = activeOnly !== false ? 'Status=="ACTIVE"' : undefined;
    const response = await listXeroAccounts(where);
    if (response.error !== null) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error listing accounts: ${response.error}`,
          },
        ],
      };
    }

    return listResponse(response.result);
  },
);

export default ListAccountsTool;
