import type { NextRequest } from "next/server";
import * as XLSX from "xlsx";

import { requireSession } from "@/server/auth/session";
import { getCurrentDictionary } from "@/server/i18n";
import { purchaseRequestFiltersSchema } from "@/server/purchase-requests/purchase-request.schemas";
import { getReportSummary } from "@/server/purchase-requests/purchase-request.service";
import { toErrorResponse } from "@/server/shared/errors";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const session = await requireSession();
    const filters = purchaseRequestFiltersSchema.parse({
      query: request.nextUrl.searchParams.get("query") ?? undefined,
      status: request.nextUrl.searchParams.get("status") ?? undefined,
      department: request.nextUrl.searchParams.get("department") ?? undefined,
      from: request.nextUrl.searchParams.get("from") ?? undefined,
      to: request.nextUrl.searchParams.get("to") ?? undefined,
      sort: request.nextUrl.searchParams.get("sort") ?? undefined,
    });
    const [summary, dictionary] = await Promise.all([
      getReportSummary(session, filters),
      getCurrentDictionary(),
    ]);

    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(
        summary.byMonth.map((item) => ({
          [dictionary.reports.month]: item.month,
          [dictionary.reports.requests]: item.count,
          [dictionary.reports.amount]: item.totalAmount,
        })),
      ),
      dictionary.reports.byMonth,
    );

    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(
        summary.byDepartment.map((item) => ({
          [dictionary.common.department]: item.department,
          [dictionary.reports.requests]: item.count,
          [dictionary.reports.amount]: item.totalAmount,
        })),
      ),
      dictionary.reports.byDepartment,
    );

    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(
        summary.byRequester.map((item) => ({
          [dictionary.reports.requester]: item.requesterName,
          [dictionary.reports.requests]: item.count,
          [dictionary.reports.amount]: item.totalAmount,
        })),
      ),
      dictionary.reports.byRequester,
    );

    const buffer = XLSX.write(workbook, {
      type: "buffer",
      bookType: "xlsx",
    });

    return new Response(buffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="pr-report-${Date.now()}.xlsx"`,
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
