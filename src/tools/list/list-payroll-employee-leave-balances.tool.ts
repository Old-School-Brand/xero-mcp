import { z } from "zod";
import { listXeroPayrollEmployeeLeaveBalances } from "../../handlers/list-xero-payroll-employee-leave-balances.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import { listResponse } from "../../helpers/json-response.js";

const ListPayrollEmployeeLeaveBalancesTool = CreateXeroTool(
  "list-payroll-employee-leave-balances",
  "List all leave balances for a specific employee in Xero. This shows current leave balances for all leave types available to the employee, including annual, sick, and other leave types.",
  {
    employeeId: z.string().describe("The Xero employee ID to fetch leave balances for"),
  },
  async ({ employeeId }) => {
    const response = await listXeroPayrollEmployeeLeaveBalances(employeeId);
    if (response.isError) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error listing employee leave balances: ${response.error}`,
          },
        ],
      };
    }

    return listResponse(response.result);
  },
);

export default ListPayrollEmployeeLeaveBalancesTool;
