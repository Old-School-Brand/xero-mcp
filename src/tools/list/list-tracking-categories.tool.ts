import { z } from "zod";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import { listXeroTrackingCategories } from "../../handlers/list-xero-tracking-categories.handler.js";
import { listResponse } from "../../helpers/json-response.js";

const ListTrackingCategoriesTool = CreateXeroTool(
  "list-tracking-categories",
  "List all tracking categories in Xero, along with their associated tracking options.",
  {
    includeArchived: z.boolean().optional()
      .describe("Determines whether or not archived categories will be returned. By default, no archived categories will be returned.")
  },
  async ({ includeArchived }) => {
    const response = await listXeroTrackingCategories(includeArchived);

    if (response.isError) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error listing tracking categories: ${response.error}`
          }
        ]
      };
    }

    return listResponse(response.result);
  }
);

export default ListTrackingCategoriesTool;
