import { requireSession } from "@/server/auth/session";
import { toErrorResponse } from "@/server/shared/errors";
import { changePasswordSchema } from "@/server/users/user.schemas";
import { changeOwnPassword } from "@/server/users/user.service";

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const payload = changePasswordSchema.parse(await request.json());

    await changeOwnPassword(session, payload);

    return Response.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
