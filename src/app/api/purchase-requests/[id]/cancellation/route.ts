import { requireSession } from "@/server/auth/session";
import { purchaseRequestCancellationSchema } from "@/server/purchase-requests/purchase-request.schemas";
import { updatePurchaseRequestCancellation } from "@/server/purchase-requests/purchase-request.service";
import { toErrorResponse } from "@/server/shared/errors";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession();
    const { id } = await context.params;
    const payload = purchaseRequestCancellationSchema.parse(await request.json());

    await updatePurchaseRequestCancellation(id, session, payload);

    return Response.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
