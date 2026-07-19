import { listXeroAccounts } from "../../handlers/list-xero-accounts.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import { listResponse } from "../../helpers/json-response.js";

const ListAccountsTool = CreateXeroTool(
  "list-accounts",
  "Lists all accounts in Xero. Use this tool to get the account codes and names to be used when creating invoices in Xero",
  {},
  async () => {
    const response = await listXeroAccounts();
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
