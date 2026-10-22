import { Buffer } from "node:buffer";

import { requireSession } from "@/server/auth/session";
import { getCurrentLocale } from "@/server/i18n";
import { buildPurchaseOrderDocument } from "@/server/purchase-orders/purchase-order-document";
import { createPurchaseOrderPdf } from "@/server/purchase-orders/purchase-order-pdf";
import { getPurchaseOrderById } from "@/server/purchase-orders/purchase-order.service";
import { toErrorResponse } from "@/server/shared/errors";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await context.params;
    const [order, locale] = await Promise.all([getPurchaseOrderById(id, session), getCurrentLocale()]);
    const document = await buildPurchaseOrderDocument(order, locale);
    const bytes = await createPurchaseOrderPdf(document);
    const filename = order.poNumber.replace(/[^a-zA-Z0-9_-]/g, "_");
    return new Response(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}.pdf"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
