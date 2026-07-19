import { listXeroPayrollLeaveTypes } from "../../handlers/list-xero-payroll-leave-types.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import { listResponse } from "../../helpers/json-response.js";

const ListPayrollLeaveTypesTool = CreateXeroTool(
  "list-payroll-leave-types",
  "Lists all available leave types in Xero Payroll. This provides information about all the leave categories configured in your Xero system, including statutory and organization-specific leave types.",
  {},
  async () => {
    const response = await listXeroPayrollLeaveTypes();
    if (response.isError) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error listing payroll leave types: ${response.error}`,
          },
        ],
      };
    }

    return listResponse(response.result);
  },
);

export default ListPayrollLeaveTypesTool;
