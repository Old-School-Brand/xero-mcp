import { listXeroContacts } from "../../handlers/list-xero-contacts.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import { listResponse } from "../../helpers/json-response.js";
import { z } from "zod";

const ListContactsTool = CreateXeroTool(
  "list-contacts",
  "List all contacts in Xero. This includes Suppliers and Customers.",
  {
    page: z.number().optional().describe("Optional page number to retrieve for pagination. \
      If not provided, the first page will be returned. If 100 contacts are returned, \
      call this tool again with the next page number."),
    searchTerm: z.string().optional().describe("Search parameter that performs a case-insensitive text search across the Name, FirstName, LastName, ContactNumber and EmailAddress fields"),
  },
  async (params) => {
    const { page, searchTerm } = params;
    const response = await listXeroContacts(page, searchTerm);

    if (response.isError) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error listing contacts: ${response.error}`,
          },
        ],
      };
    }

    return listResponse(response.result);
  },
);

export default ListContactsTool;
