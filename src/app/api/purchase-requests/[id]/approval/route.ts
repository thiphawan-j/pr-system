import { requireSession } from "@/server/auth/session";
import { approvalDecisionSchema } from "@/server/purchase-requests/purchase-request.schemas";
import { reviewPurchaseRequest } from "@/server/purchase-requests/purchase-request.service";
import { toErrorResponse } from "@/server/shared/errors";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession();
    const { id } = await context.params;
    const payload = approvalDecisionSchema.parse(await request.json());

    await reviewPurchaseRequest(id, session, payload);

    return Response.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
