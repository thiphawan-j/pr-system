import { requireSession } from "@/server/auth/session";
import { listPurchaseOrderCandidates } from "@/server/purchase-orders/purchase-order.service";
import { toErrorResponse } from "@/server/shared/errors";

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const params = new URL(request.url).searchParams;
    const page = Number(params.get("page") ?? 1);
    return Response.json(await listPurchaseOrderCandidates(session, {
      query: (params.get("query") ?? "").slice(0, 200), page: Number.isSafeInteger(page) && page > 0 ? page : 1,
    }));
  } catch (error) {
    return toErrorResponse(error);
  }
}
