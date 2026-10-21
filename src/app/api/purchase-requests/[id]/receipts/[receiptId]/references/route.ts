import { requireSession } from "@/server/auth/session";
import { receiptReferenceSchema } from "@/server/purchase-requests/purchase-request.schemas";
import { updatePurchaseRequestReceiptReferences } from "@/server/purchase-requests/purchase-request.service";
import { toErrorResponse } from "@/server/shared/errors";

export async function POST(request: Request, context: { params: Promise<{ id: string; receiptId: string }> }) {
  try {
    const session = await requireSession();
    const { id, receiptId } = await context.params;
    const payload = receiptReferenceSchema.parse(await request.json());
    await updatePurchaseRequestReceiptReferences(id, receiptId, session, payload);
    return Response.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
