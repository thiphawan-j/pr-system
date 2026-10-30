import { requireSession } from "@/server/auth/session";
import { isPurchasing } from "@/server/auth/authorization";
import { getCurrentLocale } from "@/server/i18n";
import { previewPurchaseRequestOrders } from "@/server/purchase-orders/purchase-order-creation.service";
import { purchaseOrderConversionSchema } from "@/server/purchase-orders/purchase-order.schemas";
import { AppError, invariant, toErrorResponse } from "@/server/shared/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    invariant(isPurchasing(session), "เฉพาะฝ่ายจัดซื้อเท่านั้นที่ดำเนินการได้", 403);
    const { id } = await context.params;
    const payload = purchaseOrderConversionSchema.parse(await request.json().catch(() => { throw new AppError("ข้อมูลที่ส่งมาไม่ถูกต้อง", 400); }));
    const preview = await previewPurchaseRequestOrders(id, session, payload, await getCurrentLocale());
    return Response.json(preview, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const response = toErrorResponse(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
