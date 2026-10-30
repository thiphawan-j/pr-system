import { revalidatePath } from "next/cache";
import { requireSession } from "@/server/auth/session";
import { reviewPurchaseOrderChange } from "@/server/purchase-orders/purchase-order-change.service";
import { purchaseOrderChangeReviewSchema } from "@/server/purchase-orders/purchase-order.schemas";
import { toErrorResponse } from "@/server/shared/errors";

export async function POST(request: Request, context: { params: Promise<{ id: string; changeId: string }> }) {
  try {
    const session = await requireSession();
    const { id, changeId } = await context.params;
    const payload = purchaseOrderChangeReviewSchema.parse(await request.json());
    const order = await reviewPurchaseOrderChange(id, changeId, session, payload);
    revalidatePath(`/purchase-orders/${id}`);
    for (const source of order.purchaseRequests ?? [order.purchaseRequest]) revalidatePath(`/purchase-requests/${source.id}`);
    revalidatePath("/purchase-orders/new");
    revalidatePath("/purchase-requests");
    revalidatePath("/dashboard");
    revalidatePath("/reports");
    return Response.json(order);
  } catch (error) {
    return toErrorResponse(error);
  }
}
