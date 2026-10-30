import { requireSession } from "@/server/auth/session";
import { getPurchaseOrderById } from "@/server/purchase-orders/purchase-order.service";
import { toErrorResponse } from "@/server/shared/errors";
import { proposePurchaseOrderChange } from "@/server/purchase-orders/purchase-order-change.service";
import { purchaseOrderChangeSchema } from "@/server/purchase-orders/purchase-order.schemas";
import { revalidatePath } from "next/cache";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await context.params;
    return Response.json(await getPurchaseOrderById(id, session));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await context.params;
    const payload = purchaseOrderChangeSchema.parse(await request.json());
    const order = await proposePurchaseOrderChange(id, session, payload);
    revalidatePath(`/purchase-orders/${id}`);
    for (const source of order.purchaseRequests ?? [order.purchaseRequest]) revalidatePath(`/purchase-requests/${source.id}`);
    revalidatePath("/purchase-orders/new");
    return Response.json(order);
  } catch (error) {
    return toErrorResponse(error);
  }
}
