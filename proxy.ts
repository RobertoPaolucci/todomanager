import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const COGNANELLO_PATH = "/cognanello";
const COGNANELLO_SUMMARY_PATH = "/prenotazioni/riepilogo";
const COGNANELLO_AVAILABILITY_API = "/api/cognanello/availability";
const COGNANELLO_AVAILABILITY_ALIAS = "/cognanello/api/availability";
const NEXT_DIRECT_REFERENCE_API = "/api/bookings/next-direct-ref";
const AUTH_COOKIE = "tm-auth-token";

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

async function hasVerifiedSupabaseSession(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get(AUTH_COOKIE)?.value;

  if (!token) return false;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) return false;

  try {
    // Checking cookie presence or decoding its JWT payload is not authentication.
    // getUser(token) verifies the signed-in account with the Supabase Auth server.
    const client = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.auth.getUser(token);

    return (
      !error &&
      data.user?.role === "authenticated" &&
      data.user.is_anonymous !== true
    );
  } catch {
    // Fail closed on network errors or invalid credentials.
    return false;
  }
}

export async function proxy(req: NextRequest) {
  const pathname = req.nextUrl.pathname;
  const isCognanelloArea =
    pathname.startsWith(COGNANELLO_PATH) ||
    isCognanelloSummaryRequest(req) ||
    pathname === COGNANELLO_AVAILABILITY_API;

  // Cognanello keeps its independent Basic Auth, including its privileged API.
  if (isCognanelloArea) {
    if (!isValidCognanelloBasicAuth(req)) {
      return buildBasicAuthResponse();
    }

    // Use the same browser Basic Auth protection space for the portal's fetches.
    if (pathname === COGNANELLO_AVAILABILITY_ALIAS) {
      const target = req.nextUrl.clone();
      target.pathname = COGNANELLO_AVAILABILITY_API;
      return NextResponse.rewrite(target);
    }

    return NextResponse.next();
  }

  const isLoginPage = pathname === "/login";
  const isProtectedApi = pathname === NEXT_DIRECT_REFERENCE_API;
  const authenticated = await hasVerifiedSupabaseSession(req);

  if (!authenticated) {
    if (isLoginPage) return NextResponse.next();

    if (isProtectedApi) {
      return NextResponse.json(
        { error: "Sessione non valida o scaduta" },
        { status: 401, headers: { "Cache-Control": "no-store" } }
      );
    }

    const response = NextResponse.redirect(new URL("/login", req.url));
    response.headers.set("Cache-Control", "no-store");
    return response;
  }

  if (isLoginPage) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|robots.txt|sitemap.xml).*)",
    NEXT_DIRECT_REFERENCE_API,
    COGNANELLO_AVAILABILITY_API,
  ],
};
