import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Todo Manager verifies the exact server session cookie with Supabase", () => {
  const proxy = source("proxy.ts");
  assert.match(proxy, /req\.cookies\.get\(AUTH_COOKIE\)/);
  assert.match(proxy, /client\.auth\.getUser\(token\)/);
  assert.match(proxy, /data\.user\?\.role === "authenticated"/);
  assert.match(proxy, /data\.user\.is_anonymous !== true/);
  assert.doesNotMatch(proxy, /cookies\.getAll\(\)/);
});

test("Business APIs are explicitly covered, while webhooks remain separate", () => {
  const proxy = source("proxy.ts");
  assert.match(proxy, /"\/api\/bookings\/next-direct-ref",/);
  assert.match(proxy, /"\/api\/cognanello\/availability",/);
  assert.match(proxy, /NextResponse\.json\([\s\S]*?status: 401/);
  assert.match(source("app/api/bookings/next-direct-ref/route.ts"), /supabaseServer\.auth\.getUser\(token\)/);
});

test("Cognanello availability keeps Basic Auth, including direct API calls", () => {
  const proxy = source("proxy.ts");
  const api = source("app/api/cognanello/availability/route.ts");
  const portal = source("app/cognanello/disponibilita/page.tsx");
  assert.match(proxy, /COGNANELLO_AVAILABILITY_ALIAS/);
  assert.match(proxy, /NextResponse\.rewrite\(target\)/);
  assert.match(api, /hasCognanelloAuthorization\(request\)/);
  assert.match(api, /export async function GET\(request: Request\) \{\n  if \(!hasCognanelloAuthorization/);
  assert.match(api, /export async function POST\(request: Request\) \{\n  if \(!hasCognanelloAuthorization/);
  assert.equal(portal.split("/cognanello/api/availability").length - 1, 2);
});

test("Client renewals synchronize the proxy cookie and login restores sessions", () => {
  const sync = source("components/SessionCookieSync.tsx");
  const login = source("app/login/page.tsx");
  assert.match(sync, /TOKEN_REFRESHED/);
  assert.match(sync, /syncAuthCookie\(session\)/);
  assert.match(login, /supabase\.auth\.getUser\(\)/);
  assert.match(login, /syncAuthCookie\(result\.data\.session\)/);
  assert.match(source("app/layout.tsx"), /<SessionCookieSync \/>/);
});
