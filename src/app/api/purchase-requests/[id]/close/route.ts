import { requireSession } from "@/server/auth/session";
import { closePurchaseRequestSchema } from "@/server/purchase-requests/purchase-request.schemas";
import { closePurchaseRequest } from "@/server/purchase-requests/purchase-request.service";
import { toErrorResponse } from "@/server/shared/errors";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await context.params;
    const payload = closePurchaseRequestSchema.parse(await request.json());
    await closePurchaseRequest(id, session, payload);
    return Response.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
