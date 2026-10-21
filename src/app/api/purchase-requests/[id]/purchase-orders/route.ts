import { requireSession } from "@/server/auth/session";
import { purchaseOrderConversionSchema } from "@/server/purchase-orders/purchase-order.schemas";
import { convertPurchaseRequestToOrders } from "@/server/purchase-orders/purchase-order.service";
import { toErrorResponse } from "@/server/shared/errors";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await context.params;
    const payload = purchaseOrderConversionSchema.parse(await request.json());
    const purchaseOrders = await convertPurchaseRequestToOrders(id, session, payload);
    return Response.json({ purchaseOrders }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
