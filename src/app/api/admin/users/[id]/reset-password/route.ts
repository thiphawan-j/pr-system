import { assertRole } from "@/server/auth/authorization";
import { requireSession } from "@/server/auth/session";
import { toErrorResponse } from "@/server/shared/errors";
import { adminResetPasswordSchema } from "@/server/users/user.schemas";
import { resetUserPasswordByAdmin } from "@/server/users/user.service";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession();

    assertRole(session, ["ADMIN"]);

    const { id } = await context.params;
    const payload = adminResetPasswordSchema.parse(await request.json());

    await resetUserPasswordByAdmin(id, payload);

    return Response.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
