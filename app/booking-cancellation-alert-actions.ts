"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase-server";

export async function acknowledgeBookingCancellationAlert(alertId: number, eventVersion: string) {
  if (!Number.isSafeInteger(alertId) || alertId <= 0 ||
      typeof eventVersion !== "string" || !/^v1:[0-9a-f]{32}$/.test(eventVersion)) {
    return { error: "Avviso non valido. Ricarica la Dashboard." };
  }

  try {
    const token = (await cookies()).get("tm-auth-token")?.value;
    if (!token) return { code: "AUTH_REQUIRED", error: "Accedi al gestionale per confermare la lettura. L'avviso resta visibile." };
    const { data, error: authError } = await supabaseServer.auth.getUser(token);
    const user = data?.user;
    // Same shared operational access as Google Calendar; never trust a browser actor ID.
    if (authError) {
      if (authError.status === 401 || ["bad_jwt", "session_not_found", "session_expired", "user_not_found"].includes(authError.code ?? "")) {
        return { code: "AUTH_REQUIRED", error: "Sessione non valida o scaduta. Accedi nuovamente per confermare la lettura. L'avviso resta visibile." };
      }
      if (authError.status === 403) {
        return { code: "FORBIDDEN", error: "Account non autorizzato a confermare la lettura." };
      }
      return { code: "AUTH_UNAVAILABLE", error: "Verifica della sessione temporaneamente non disponibile. L'avviso resta visibile. Riprova tra poco." };
    }
    if (!user) {
      return { code: "AUTH_REQUIRED", error: "Sessione non valida o scaduta. Accedi nuovamente per confermare la lettura. L'avviso resta visibile." };
    }
    if (user.role !== "authenticated" || user.is_anonymous) {
      return { code: "FORBIDDEN", error: "Account non autorizzato a confermare la lettura." };
    }

    const { data: saved, error } = await supabaseServer.rpc("acknowledge_booking_cancellation_alert", {
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
