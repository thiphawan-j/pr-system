import { assertRole } from "@/server/auth/authorization";
import { requireSession } from "@/server/auth/session";
import { toErrorResponse } from "@/server/shared/errors";
import { updateSupplierSchema } from "@/server/suppliers/supplier.schemas";
import { getSupplierById, updateSupplier } from "@/server/suppliers/supplier.service";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await context.params;
    return Response.json(await getSupplierById(id, session));
  } catch (error) { return toErrorResponse(error); }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    assertRole(session, ["PURCHASING", "ADMIN"]);
    const { id } = await context.params;
    return Response.json(await updateSupplier(id, session, updateSupplierSchema.parse(await request.json())));
  } catch (error) { return toErrorResponse(error); }
}
