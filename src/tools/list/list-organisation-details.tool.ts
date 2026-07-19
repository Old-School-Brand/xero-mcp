import { listXeroOrganisationDetails } from "../../handlers/list-xero-organisation-details.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import { jsonResponse } from "../../helpers/json-response.js";

const ListOrganisationDetailsTool = CreateXeroTool(
  "list-organisation-details",
  "Lists the organisation details from Xero. Use this tool to get information about the current Xero organisation.",
  {},
  async () => {
    const response = await listXeroOrganisationDetails();
    if (response.error !== null) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error fetching organisation details: ${response.error}`,
          },
        ],
      };
    }

    return jsonResponse(response.result);
  },
);

export default ListOrganisationDetailsTool;
