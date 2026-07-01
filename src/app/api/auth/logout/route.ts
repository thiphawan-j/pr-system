import { NextResponse } from "next/server";

import { getSessionCookieConfig } from "@/server/auth/session";

export async function POST() {
  const response = NextResponse.json({ ok: true });

  response.cookies.set({
    ...getSessionCookieConfig(),
    value: "",
    maxAge: 0,
  });

  return response;
}
