import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function proxy(req: NextRequest) {
  const hasAuthCookie = req.cookies
    .getAll()
    .some((c) => c.name.includes("-auth-token"));

  const isLoginPage = req.nextUrl.pathname.startsWith("/login");

  if (!hasAuthCookie && !isLoginPage) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  if (hasAuthCookie && isLoginPage) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|robots.txt|sitemap.xml).*)",
  ],
};