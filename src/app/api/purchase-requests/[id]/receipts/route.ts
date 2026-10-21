import { requireSession } from "@/server/auth/session";
import { receiptEntrySchema } from "@/server/purchase-requests/purchase-request.schemas";
import { recordPurchaseRequestReceipt } from "@/server/purchase-requests/purchase-request.service";
import { toErrorResponse } from "@/server/shared/errors";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await context.params;
    const payload = receiptEntrySchema.parse(await request.json());
    const receipt = await recordPurchaseRequestReceipt(id, session, payload);
    return Response.json(receipt);
  } catch (error) {
    return toErrorResponse(error);
  }
}
