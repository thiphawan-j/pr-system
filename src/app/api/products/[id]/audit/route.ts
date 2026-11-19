import { requireSession } from "@/server/auth/session";
import { toErrorResponse } from "@/server/shared/errors";
import { productAuditFiltersSchema } from "@/server/products/product.schemas";
import { getProductAudit } from "@/server/products/product.service";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await context.params;
    return Response.json(await getProductAudit(session, id, productAuditFiltersSchema.parse({ page: new URL(request.url).searchParams.get("page") ?? undefined })));
  } catch (error) { return toErrorResponse(error); }
}
