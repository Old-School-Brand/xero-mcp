import { z } from "zod";
import { listXeroPayrollEmployeeLeave } from "../../handlers/list-xero-payroll-employee-leave.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import { listResponse } from "../../helpers/json-response.js";

const ListPayrollEmployeeLeaveTool = CreateXeroTool(
  "list-payroll-employee-leave",
  "List all leave records for a specific employee in Xero. This shows all leave transactions including approved, pending, and processed time off. Provide an employee ID to see their leave history.",
  {
    employeeId: z.string().describe("The Xero employee ID to fetch leave records for"),
  },
  async ({ employeeId }) => {
    const response = await listXeroPayrollEmployeeLeave(employeeId);
    if (response.isError) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error listing employee leave: ${response.error}`,
          },
        ],
      };
    }

    return listResponse(response.result);
  },
);

export default ListPayrollEmployeeLeaveTool;
