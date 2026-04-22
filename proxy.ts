import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const COGNANELLO_PATH = "/cognanello";
const COGNANELLO_SUMMARY_PATH = "/prenotazioni/riepilogo";

function hasSupabaseAuthCookie(req: NextRequest) {
  return req.cookies.getAll().some((c) => c.name.includes("-auth-token"));
}

function getBasicAuthCredentials(req: NextRequest) {
  const authHeader = req.headers.get("authorization");

  if (!authHeader || !authHeader.startsWith("Basic ")) {
    return null;
  }

  const encoded = authHeader.slice(6).trim();

  try {
    const decoded = atob(encoded);
    const separatorIndex = decoded.indexOf(":");

    if (separatorIndex === -1) return null;

    const username = decoded.slice(0, separatorIndex);
    const password = decoded.slice(separatorIndex + 1);

    return { username, password };
  } catch {
    return null;
  }
}

function isValidCognanelloBasicAuth(req: NextRequest) {
  const expectedUser = process.env.COGNANELLO_BASIC_USER ?? "";
  const expectedPassword = process.env.COGNANELLO_BASIC_PASSWORD ?? "";

  if (!expectedUser || !expectedPassword) {
    return false;
  }

  const credentials = getBasicAuthCredentials(req);
  if (!credentials) {
    return false;
  }

  return (
    credentials.username === expectedUser &&
    credentials.password === expectedPassword
  );
}

function buildBasicAuthResponse() {
  return new NextResponse("Autenticazione richiesta", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Cognanello Live"',
      "Cache-Control": "no-store",
    },
  });
}

function isCognanelloSummaryRequest(req: NextRequest) {
  return (
    req.nextUrl.pathname === COGNANELLO_SUMMARY_PATH &&
    req.nextUrl.searchParams.get("source") === "cognanello"
  );
}

export function proxy(req: NextRequest) {
  const pathname = req.nextUrl.pathname;

  const isCognanelloArea =
    pathname.startsWith(COGNANELLO_PATH) || isCognanelloSummaryRequest(req);

  // Area Cognanello: usa sempre Basic Auth dedicata
  if (isCognanelloArea) {
    if (!isValidCognanelloBasicAuth(req)) {
      return buildBasicAuthResponse();
    }

    return NextResponse.next();
  }

  // Resto di Todo Manager: usa il login normale Supabase
  const hasAuthCookie = hasSupabaseAuthCookie(req);
  const isLoginPage = pathname.startsWith("/login");

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