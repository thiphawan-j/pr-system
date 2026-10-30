import { Buffer } from "node:buffer";

import { getCurrentLocale } from "@/server/i18n";
import { createPurchaseOrderPdf } from "@/server/purchase-orders/purchase-order-pdf";
import {
  getSharedPurchaseOrderDocument, purchaseOrderShareResponseHeaders, sharedPurchaseOrderUnavailableMessage,
} from "@/server/purchase-orders/purchase-order-share.service";
import { isAppError } from "@/server/shared/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const shared = await getSharedPurchaseOrderDocument(token, await getCurrentLocale());
    const bytes = await createPurchaseOrderPdf(shared.document);
    const filename = shared.poNumber.replace(/[^a-zA-Z0-9_-]/g, "_");
    return new Response(Buffer.from(bytes), { headers: {
      ...purchaseOrderShareResponseHeaders,
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}.pdf"`,
    } });
  } catch (error) {
    if (isAppError(error) && error.statusCode === 404) {
      return Response.json({ error: sharedPurchaseOrderUnavailableMessage }, { status: 404, headers: purchaseOrderShareResponseHeaders });
    }
    // Neither the capability nor a database error containing it belongs in logs.
    console.error("[shared-purchase-order-pdf]", { type: error instanceof Error ? error.name : typeof error });
    return Response.json({ error: "ไม่สามารถโหลดเอกสารได้" }, { status: 500, headers: purchaseOrderShareResponseHeaders });
  }
}
