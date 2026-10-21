"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase-server";

export async function acknowledgeGoogleCalendarAlert(alertId: number, eventVersion: string) {
  if (!Number.isSafeInteger(alertId) || alertId <= 0 || !/^v1:[0-9a-f]{32}$/.test(eventVersion)) {
    return { error: "Avviso non valido. Ricarica la Dashboard." };
  }

  try {
    // Cookie presence alone (the legacy proxy check) is not authorization.
    const token = (await cookies()).get("tm-auth-token")?.value;
    if (!token) return { error: "Accedi al gestionale per confermare la lettura." };
    const { data, error: authError } = await supabaseServer.auth.getUser(token);
    const user = data?.user;
    // All non-anonymous Todo Manager login accounts share this operational view.
    // Never trust an actor ID or editable user_metadata supplied by the browser.
    if (authError || !user || user.role !== "authenticated" || user.is_anonymous) {
      return { error: "Sessione non valida o scaduta. Accedi nuovamente al gestionale." };
    }

    const { data: saved, error } = await supabaseServer.rpc("acknowledge_google_calendar_dashboard_alert", {
      alert_id: alertId, expected_version: eventVersion, actor_id: user.id,
    });
    if (error) return { error: "Presa visione non salvata. L'avviso resta visibile. Riprova tra poco." };
    if (saved !== true) return { error: "L'avviso è cambiato. Ricarica la Dashboard e controlla la nuova segnalazione." };

    revalidatePath("/");
    return { success: true };
  } catch {
    return { error: "Impossibile confermare la lettura. L'avviso resta visibile. Riprova." };
  }
}
