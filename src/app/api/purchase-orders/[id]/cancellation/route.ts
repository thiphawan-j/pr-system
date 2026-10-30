import { revalidatePath } from "next/cache";
import { requireSession } from "@/server/auth/session";
import { cancelPurchaseOrder } from "@/server/purchase-orders/purchase-order-cancellation.service";
import { purchaseOrderCancellationSchema } from "@/server/purchase-orders/purchase-order.schemas";
import { toErrorResponse } from "@/server/shared/errors";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await context.params;
    const payload = purchaseOrderCancellationSchema.parse(await request.json());
    const order = await cancelPurchaseOrder(id, session, payload);
    revalidatePath(`/purchase-orders/${id}`);
    for (const source of order.purchaseRequests ?? [order.purchaseRequest]) revalidatePath(`/purchase-requests/${source.id}`);
    revalidatePath("/purchase-requests");
    revalidatePath("/purchase-orders/new");
    revalidatePath("/dashboard");
    revalidatePath("/reports");
    return Response.json(order);
  } catch (error) {
    return toErrorResponse(error);
  }
}
