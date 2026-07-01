import { requireSession } from "@/server/auth/session";
import { toErrorResponse } from "@/server/shared/errors";
import { getDashboardSummary } from "@/server/purchase-requests/purchase-request.service";

export async function GET() {
  try {
    const session = await requireSession();
    const summary = await getDashboardSummary(session);

    return Response.json(summary);
  } catch (error) {
    return toErrorResponse(error);
  }
}
