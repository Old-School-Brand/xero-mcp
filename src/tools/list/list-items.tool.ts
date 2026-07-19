import { z } from "zod";
import { listXeroItems } from "../../handlers/list-xero-items.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import { listResponse } from "../../helpers/json-response.js";

const ListItemsTool = CreateXeroTool(
  "list-items",
  "Lists all items in Xero. Use this tool to get the item codes and descriptions to be used when creating invoices in Xero",
  {
    page: z.number(),
  },
  async ({ page }) => {
    const response = await listXeroItems(page);

    if (response.isError) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error listing items: ${response.error}`,
          },
        ],
      };
    }

    return listResponse(response.result);
  },
);

export default ListItemsTool;
