import { requireSession } from "@/server/auth/session";
import { toErrorResponse } from "@/server/shared/errors";
import { createProductAliasSchema } from "@/server/products/product.schemas";
import { createProductAlias } from "@/server/products/product.service";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await context.params;
    return Response.json(await createProductAlias(session, id, createProductAliasSchema.parse(await request.json())), { status: 201 });
  } catch (error) { return toErrorResponse(error); }
}
