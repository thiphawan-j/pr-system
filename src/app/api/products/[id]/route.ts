import { requireSession } from "@/server/auth/session";
import { toErrorResponse } from "@/server/shared/errors";
import { correctProductSchema } from "@/server/products/product.schemas";
import { correctProduct } from "@/server/products/product.service";
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await context.params;
    return Response.json(await correctProduct(session, id, correctProductSchema.parse(await request.json())));
  } catch (error) { return toErrorResponse(error); }
}
