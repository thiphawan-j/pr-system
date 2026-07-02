import { assertRole } from "@/server/auth/authorization";
import { requireSession } from "@/server/auth/session";
import { toErrorResponse } from "@/server/shared/errors";
import { setUserActiveSchema } from "@/server/users/user.schemas";
import { setUserActiveStatus } from "@/server/users/user.service";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession();

    assertRole(session, ["ADMIN"]);

    const { id } = await context.params;
    const payload = setUserActiveSchema.parse(await request.json());
    const user = await setUserActiveStatus(id, session.id, payload.isActive);

    return Response.json({ user });
  } catch (error) {
    return toErrorResponse(error);
  }
}
