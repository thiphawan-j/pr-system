import { NextResponse } from "next/server";

import { getSessionCookieConfig, signSession } from "@/server/auth/session";
import { toErrorResponse } from "@/server/shared/errors";
import { loginSchema } from "@/server/purchase-requests/purchase-request.schemas";
import { authenticateUser } from "@/server/users/user.service";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const credentials = loginSchema.parse(body);
    const sessionUser = await authenticateUser(
      credentials.identifier,
      credentials.password,
    );

    const token = await signSession(sessionUser);
    const response = NextResponse.json({ user: sessionUser });

    response.cookies.set({
      ...getSessionCookieConfig(),
      value: token,
    });

    return response;
  } catch (error) {
    return toErrorResponse(error);
  }
}
