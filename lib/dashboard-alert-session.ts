"use client";

import { supabase } from "@/lib/supabase";

type AlertResult = { success?: boolean; error?: string; code?: string };

const expired = "Sessione non più rinnovabile. Accedi nuovamente per confermare la lettura. L'avviso resta visibile.";
const unavailable = "Verifica della sessione temporaneamente non disponibile. L'avviso resta visibile. Riprova tra poco.";

function sessionError(error: { status?: number } | null) {
  const temporary = error && (!error.status || error.status === 408 || error.status === 429 || error.status >= 500);
  return { error: temporary ? unavailable : expired };
}

function syncCookie(token: string) {
  // Keep the existing server cookie aligned with Supabase's browser session.
  // Refresh tokens stay in SDK storage and are never sent to a Server Action.
  document.cookie = `tm-auth-token=${token}; path=/; max-age=604800; SameSite=Lax${window.location.protocol === "https:" ? "; Secure" : ""}`;
}

export async function withDashboardAlertSession(action: () => Promise<AlertResult>): Promise<AlertResult> {
  // getSession refreshes an expired local session through the SDK's existing lock.
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) return sessionError(error);
  syncCookie(data.session.access_token);

  const result = await action();
  if (result.code !== "AUTH_REQUIRED") return result;

  // Only retry an authentication failure, never a forbidden or failed write.
  const refreshed = await supabase.auth.refreshSession();
  if (refreshed.error || !refreshed.data.session) return sessionError(refreshed.error);
  syncCookie(refreshed.data.session.access_token);
  return action();
}
