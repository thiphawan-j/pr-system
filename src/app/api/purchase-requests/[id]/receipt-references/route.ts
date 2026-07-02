import { requireSession } from "@/server/auth/session";
import { receiptReferenceSchema } from "@/server/purchase-requests/purchase-request.schemas";
import { updateReceiptReferences } from "@/server/purchase-requests/purchase-request.service";
import { toErrorResponse } from "@/server/shared/errors";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession();
    const { id } = await context.params;
    const payload = receiptReferenceSchema.parse(await request.json());

    await updateReceiptReferences(id, session, payload);

    return Response.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
