import { assertRole } from "@/server/auth/authorization";
import { requireSession } from "@/server/auth/session";
import { toErrorResponse } from "@/server/shared/errors";
import { createUserSchema } from "@/server/users/user.schemas";
import { createUser, listAllUsers } from "@/server/users/user.service";

export async function GET() {
  try {
    const session = await requireSession();

    assertRole(session, ["ADMIN"]);

    const users = await listAllUsers();

    return Response.json({ users });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();

    assertRole(session, ["ADMIN"]);

    const payload = createUserSchema.parse(await request.json());
    const user = await createUser(payload);

    return Response.json({ user }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
