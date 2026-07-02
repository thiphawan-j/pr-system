import { assertRole } from "@/server/auth/authorization";
import { requireSession } from "@/server/auth/session";
import { toErrorResponse } from "@/server/shared/errors";
import { updateUserSchema } from "@/server/users/user.schemas";
import { updateUser } from "@/server/users/user.service";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession();

    assertRole(session, ["ADMIN"]);

    const { id } = await context.params;
    const payload = updateUserSchema.parse(await request.json());
    const user = await updateUser(id, payload);

    return Response.json({ user });
  } catch (error) {
    return toErrorResponse(error);
  }
}
