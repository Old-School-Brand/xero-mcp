import { z } from "zod";
import { listXeroQuotes } from "../../handlers/list-xero-quotes.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import { listResponse } from "../../helpers/json-response.js";

const ListQuotesTool = CreateXeroTool(
  "list-quotes",
  `List all quotes in Xero.
  Ask the user if they want to see quotes for a specific contact before running.
  Ask the user if they want the next page of quotes after running this tool if 10 quotes are returned.
  If they do, call this tool again with the page number and the contact provided in the previous call.`,
  {
    page: z.number(),
    contactId: z.string().optional(),
    quoteNumber: z.string().optional(),
  },
  async ({ page, contactId, quoteNumber }) => {
    const response = await listXeroQuotes(page, contactId, quoteNumber);
    if (response.error !== null) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error listing quotes: ${response.error}`,
          },
        ],
      };
    }

    return listResponse(response.result);
  },
);

export default ListQuotesTool;
