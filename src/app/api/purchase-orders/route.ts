import { requireSession } from "@/server/auth/session";
import { purchaseOrderCombinedConversionSchema } from "@/server/purchase-orders/purchase-order.schemas";
import { combinePurchaseRequestsToOrders } from "@/server/purchase-orders/purchase-order.service";
import { PurchaseOrderPreviewChangedError } from "@/server/purchase-orders/purchase-order-creation.service";
import { toErrorResponse } from "@/server/shared/errors";

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const payload = purchaseOrderCombinedConversionSchema.parse(await request.json());
    return Response.json({ purchaseOrders: await combinePurchaseRequestsToOrders(session, payload) }, { status: 201 });
  } catch (error) {
    if (error instanceof PurchaseOrderPreviewChangedError) {
      return Response.json({ error: error.message, code: error.code }, { status: 409 });
    }
    return toErrorResponse(error);
  }
}
