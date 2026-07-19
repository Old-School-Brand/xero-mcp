import { listXeroTaxRates } from "../../handlers/list-xero-tax-rates.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import { listResponse } from "../../helpers/json-response.js";

const ListTaxRatesTool = CreateXeroTool(
  "list-tax-rates",
  "Lists all tax rates in Xero. Use this tool to get the tax rates to be used when creating invoices in Xero",
  {},
  async () => {
    const response = await listXeroTaxRates();
    if (response.error !== null) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error listing tax rates: ${response.error}`,
          },
        ],
      };
    }

    return listResponse(response.result);
  },
);

export default ListTaxRatesTool;
