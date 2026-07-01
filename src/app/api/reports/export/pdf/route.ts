import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import path from "node:path";

import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { NextRequest } from "next/server";

import { requireSession } from "@/server/auth/session";
import { formatCurrency, formatNumber } from "@/lib/format";
import { getCurrentDictionary, getCurrentLocale } from "@/server/i18n";
import { purchaseRequestFiltersSchema } from "@/server/purchase-requests/purchase-request.schemas";
import { getReportSummary } from "@/server/purchase-requests/purchase-request.service";
import { toErrorResponse } from "@/server/shared/errors";

export const runtime = "nodejs";

const pdfMargin = 48;

function containsThai(text: string) {
  return /[\u0E00-\u0E7F]/.test(text);
}

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
    const [summary, locale, dictionary] = await Promise.all([
      getReportSummary(session, filters),
      getCurrentLocale(),
      getCurrentDictionary(),
    ]);

    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit);
    const pageSize: [number, number] = [595.28, 841.89];
    let page = pdf.addPage(pageSize);
    let y = pageSize[1] - pdfMargin;

    const thaiFontBytes = await readFile(
      path.join(
        process.cwd(),
        "node_modules/@fontsource/noto-sans-thai/files/noto-sans-thai-thai-400-normal.woff",
      ),
    );

    const thaiFont = await pdf.embedFont(thaiFontBytes);
    const latinFont = await pdf.embedFont(StandardFonts.Helvetica);
    const latinBold = await pdf.embedFont(StandardFonts.HelveticaBold);

    const drawLine = (
      text: string,
      options?: {
        size?: number;
        bold?: boolean;
        color?: ReturnType<typeof rgb>;
        indent?: number;
      },
    ) => {
      if (y < 70) {
        page = pdf.addPage(pageSize);
        y = pageSize[1] - pdfMargin;
      }

      const size = options?.size ?? 11;
      const font = containsThai(text)
        ? thaiFont
        : options?.bold
          ? latinBold
          : latinFont;

      page.drawText(text, {
        x: pdfMargin + (options?.indent ?? 0),
        y,
        size,
        font,
        color: options?.color ?? rgb(0.12, 0.17, 0.29),
      });
      y -= size + 8;
    };

    drawLine("PR Flow Report", { size: 18, bold: true });
    drawLine(dictionary.reports.pdfTitle, { size: 15 });
    drawLine(`${dictionary.reports.generatedAt}: ${new Date().toISOString()}`, {
      size: 10,
      color: rgb(0.45, 0.49, 0.56),
    });
    y -= 8;
    drawLine(
      `${dictionary.reports.totalRequests}: ${formatNumber(summary.totalRequests, locale)}`,
      { bold: true },
    );
    drawLine(
      `${dictionary.reports.totalAmount}: ${formatCurrency(summary.totalAmount, locale)}`,
      { bold: true },
    );
    y -= 12;

    drawLine(dictionary.reports.byMonth, { size: 13 });
    summary.byMonth.forEach((item) => {
      drawLine(
        `${dictionary.reports.month} ${item.month} | ${
          dictionary.reports.requests
        } ${formatNumber(item.count, locale)} | ${
          dictionary.reports.amount
        } ${formatCurrency(item.totalAmount, locale)}`,
        { indent: 8 },
      );
    });

    y -= 12;
    drawLine(dictionary.reports.byDepartment, { size: 13 });
    summary.byDepartment.forEach((item) => {
      drawLine(
        `${dictionary.common.department} ${item.department} | ${
          dictionary.reports.requests
        } ${formatNumber(item.count, locale)} | ${
          dictionary.reports.amount
        } ${formatCurrency(item.totalAmount, locale)}`,
        { indent: 8 },
      );
    });

    y -= 12;
    drawLine(dictionary.reports.byRequester, { size: 13 });
    summary.byRequester.forEach((item) => {
      drawLine(item.requesterName, { indent: 8 });
      drawLine(
        `${dictionary.reports.requests} ${formatNumber(item.count, locale)} | ${
          dictionary.reports.amount
        } ${formatCurrency(item.totalAmount, locale)}`,
        { indent: 20, color: rgb(0.45, 0.49, 0.56) },
      );
    });

    const bytes = await pdf.save();

    return new Response(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="pr-report-${Date.now()}.pdf"`,
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
