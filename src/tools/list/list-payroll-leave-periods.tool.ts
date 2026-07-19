import { z } from "zod";
import { listXeroPayrollLeavePeriods } from "../../handlers/list-xero-payroll-leave-periods.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import { listResponse } from "../../helpers/json-response.js";

const ListPayrollLeavePeriodsToolTool = CreateXeroTool(
  "list-payroll-leave-periods",
  "List all leave periods for a specific employee in Xero. This shows detailed time off periods including start and end dates, period status, payment dates, and leave types. Provide an employee ID to see their leave periods.",
  {
    employeeId: z.string().describe("The Xero employee ID to fetch leave periods for"),
    startDate: z.string().optional().describe("Optional start date in YYYY-MM-DD format"),
    endDate: z.string().optional().describe("Optional end date in YYYY-MM-DD format"),
  },
  async ({ employeeId, startDate, endDate }) => {
    const response = await listXeroPayrollLeavePeriods(employeeId, startDate, endDate);
    if (response.isError) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error listing employee leave periods: ${response.error}`,
          },
        ],
      };
    }

    return listResponse(response.result);
  },
);

export default ListPayrollLeavePeriodsToolTool;
