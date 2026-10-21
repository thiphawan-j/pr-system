import { requireSession } from "@/server/auth/session";
import { getPurchaseOrderById } from "@/server/purchase-orders/purchase-order.service";
import { toErrorResponse } from "@/server/shared/errors";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await context.params;
    return Response.json(await getPurchaseOrderById(id, session));
  } catch (error) {
    return toErrorResponse(error);
  }
}
