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
    if (!token) return { error: "Accedi al gestionale per confermare la lettura." };
    const { data, error: authError } = await supabaseServer.auth.getUser(token);
    const user = data?.user;
    // Same shared operational access as Google Calendar; never trust a browser actor ID.
    if (authError || !user || user.role !== "authenticated" || user.is_anonymous) {
      return { error: "Sessione non valida o scaduta. Accedi nuovamente al gestionale." };
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
