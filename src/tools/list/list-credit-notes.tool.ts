import { z } from "zod";
import { listXeroCreditNotes } from "../../handlers/list-xero-credit-notes.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import { listResponse } from "../../helpers/json-response.js";

const ListCreditNotesTool = CreateXeroTool(
  "list-credit-notes",
  `List credit notes in Xero.
  Ask the user if they want to see credit notes for a specific contact,
  or to see all credit notes before running.
  The response's \`hasMore\` is true when a full page of 1000 credit notes
  was returned — ask the user if they want the next page, then call this
  tool again with the next page number and the contact if one was provided
  in the previous call.`,
  {
    page: z.number(),
    contactId: z.string().optional(),
  },
  async ({ page, contactId }) => {
    const response = await listXeroCreditNotes(page, contactId);
    if (response.error !== null) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error listing credit notes: ${response.error}`,
          },
        ],
      };
    }

    return listResponse(response.result, 1000);
  },
);

export default ListCreditNotesTool;
