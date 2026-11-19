import { requireSession } from "@/server/auth/session";
import { toErrorResponse } from "@/server/shared/errors";
import { deactivateProductAliasSchema } from "@/server/products/product.schemas";
import { deactivateProductAlias } from "@/server/products/product.service";
export async function PATCH(request: Request, context: { params: Promise<{ id: string; aliasId: string }> }) {
  try {
    const session = await requireSession();
    const { id, aliasId } = await context.params;
    return Response.json(await deactivateProductAlias(session, id, aliasId, deactivateProductAliasSchema.parse(await request.json())));
  } catch (error) { return toErrorResponse(error); }
}
