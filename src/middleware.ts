import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  getPurchaseRequestReturnPath,
  LOGIN_RETURN_PATH_HEADER,
} from "@/lib/auth-redirect";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const requestHeaders = new Headers(request.headers);
  // The layout verifies the session and redirects using a relative login path.
  // Forward the original PR path for guests and expired sessions alike, always
  // overwriting any caller-supplied value. Never infer a public redirect host
  // from Next's internal request URL when running behind a proxy.
  requestHeaders.set(
    LOGIN_RETURN_PATH_HEADER,
    getPurchaseRequestReturnPath(pathname) ?? "",
  );
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  if (pathname.startsWith("/shared/purchase-orders/")) {
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
    response.headers.set("X-Content-Type-Options", "nosniff");
  }
  return response;
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
