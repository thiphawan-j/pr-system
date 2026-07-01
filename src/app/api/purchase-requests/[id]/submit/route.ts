import { requireSession } from "@/server/auth/session";
import { submitPurchaseRequest } from "@/server/purchase-requests/purchase-request.service";
import { toErrorResponse } from "@/server/shared/errors";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession();
    const { id } = await context.params;
    await submitPurchaseRequest(id, session);

    return Response.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
