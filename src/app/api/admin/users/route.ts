import { assertRole } from "@/server/auth/authorization";
import { requireSession } from "@/server/auth/session";
import { toErrorResponse } from "@/server/shared/errors";
import {
  adminUsersPaginationSchema,
  createUserSchema,
} from "@/server/users/user.schemas";
import { createUser, listUsersPage } from "@/server/users/user.service";

export async function GET(request: Request) {
  try {
    const session = await requireSession();

    assertRole(session, ["ADMIN"]);

    const { searchParams } = new URL(request.url);
    const pagination = adminUsersPaginationSchema.parse({
      page: searchParams.get("page"),
      limit: searchParams.get("limit"),
    });
    const users = await listUsersPage(pagination);

    return Response.json(users);
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
