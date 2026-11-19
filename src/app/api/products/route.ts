import { requireSession } from "@/server/auth/session";
import { toErrorResponse } from "@/server/shared/errors";
import { createProductSchema, productFiltersSchema } from "@/server/products/product.schemas";
import { createProduct, listProducts } from "@/server/products/product.service";

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const search = new URL(request.url).searchParams;
    const filters = productFiltersSchema.parse({ status: search.get("status") ?? undefined, query: search.get("query") ?? undefined, page: search.get("page") ?? undefined, limit: search.get("limit") ?? undefined });
    return Response.json(await listProducts(session, filters));
  } catch (error) { return toErrorResponse(error); }
}
export async function POST(request: Request) {
  try {
    const session = await requireSession();
    return Response.json(await createProduct(session, createProductSchema.parse(await request.json())), { status: 201 });
  } catch (error) { return toErrorResponse(error); }
}
