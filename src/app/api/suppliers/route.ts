import { assertRole } from "@/server/auth/authorization";
import { requireSession } from "@/server/auth/session";
import { toErrorResponse } from "@/server/shared/errors";
import { createSupplierSchema, supplierFiltersSchema } from "@/server/suppliers/supplier.schemas";
import { createSupplier, listSuppliersPage } from "@/server/suppliers/supplier.service";

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    assertRole(session, ["PURCHASING", "ADMIN"]);
    const search = new URL(request.url).searchParams;
    const filters = supplierFiltersSchema.parse({
      query: search.get("query") ?? undefined,
      status: search.get("status") ?? undefined,
      page: search.get("page") ?? undefined,
      limit: search.get("limit") ?? undefined,
    });
    return Response.json(await listSuppliersPage(session, filters));
  } catch (error) { return toErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    assertRole(session, ["PURCHASING", "ADMIN"]);
    return Response.json(await createSupplier(session, createSupplierSchema.parse(await request.json())), { status: 201 });
  } catch (error) { return toErrorResponse(error); }
}
