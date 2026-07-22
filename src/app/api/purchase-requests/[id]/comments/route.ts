import { requireSession } from "@/server/auth/session";
import { purchaseRequestCommentSchema } from "@/server/purchase-requests/purchase-request.schemas";
import { addPurchaseRequestComment } from "@/server/purchase-requests/purchase-request.service";
import { toErrorResponse } from "@/server/shared/errors";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession();
    const { id } = await context.params;
    const payload = purchaseRequestCommentSchema.parse(await request.json());

    await addPurchaseRequestComment(id, session, payload);

    return Response.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
