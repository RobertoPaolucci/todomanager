import type { Session } from "@supabase/supabase-js";

// Keep the existing Todo Manager cookie aligned with the browser's refreshed
// Supabase session. The refresh token stays in Supabase SDK storage.
export function syncAuthCookie(session: Pick<Session, "access_token"> | null) {
  if (typeof document === "undefined") return;

  const secure = window.location.protocol === "https:" ? "; Secure" : "";

  if (!session?.access_token) {
    document.cookie = `tm-auth-token=; path=/; max-age=0; SameSite=Lax${secure}`;
    return;
  }

  document.cookie = `tm-auth-token=${session.access_token}; path=/; max-age=604800; SameSite=Lax${secure}`;
}
