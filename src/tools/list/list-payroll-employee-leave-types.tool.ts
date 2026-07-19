import { z } from "zod";
import { listXeroPayrollEmployeeLeaveTypes } from "../../handlers/list-xero-payroll-employee-leave-types.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import { listResponse } from "../../helpers/json-response.js";

const ListPayrollEmployeeLeaveTypesTool = CreateXeroTool(
  "list-payroll-employee-leave-types",
  "List all leave types available for a specific employee in Xero. This shows detailed information about the types of leave an employee can take, including schedule of accrual, leave type name, and entitlement.",
  {
    employeeId: z
      .string()
      .describe("The Xero employee ID to fetch leave types for"),
  },
  async ({ employeeId }) => {
    const response = await listXeroPayrollEmployeeLeaveTypes(employeeId);
    if (response.isError) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error listing employee leave types: ${response.error}`,
          },
        ],
      };
    }

    return listResponse(response.result);
  },
);

export default ListPayrollEmployeeLeaveTypesTool;
