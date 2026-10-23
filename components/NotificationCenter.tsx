import { supabaseServer } from "@/lib/supabase-server";
import NotificationCenterList, { type BookingNotification } from "@/components/NotificationCenterList";

export default async function NotificationCenter() {
  const fields = "id, customer_name, experience_name, notes, booking_date, total_people, booking_source, is_cancelled";
  const result = await supabaseServer
    .from("booking_dashboard_alerts")
    .select(`${fields}, dashboard_event_version, dashboard_acknowledged`)
    .not("notes", "is", null)
    .order("id", { ascending: false });
  let bookings: BookingNotification[] | null = result.data;
  let error = result.error;

  let loadError: string | null = null;
  if (error) {
    // Missing migration or receipt read failure: keep existing alerts visible.
    loadError = "Presa visione temporaneamente non disponibile. Gli avvisi restano visibili.";
    const fallback = await supabaseServer.from("bookings").select(fields)
      .not("notes", "is", null).order("id", { ascending: false });
    bookings = fallback.data;
    error = fallback.error;
  }
  if (error) {
    loadError = "Impossibile caricare gli avvisi. Ricarica la Dashboard e riprova.";
  }

  const alerts =
    bookings?.filter((b) => {
      const notes = b.notes || "";
      // Hide stale alerts without changing the stored notes.
      if (notes.includes("🔴") && b.is_cancelled !== true) return false;
      if (notes.includes("🟢") && b.is_cancelled !== false) return false;
      if (b.dashboard_event_version && b.dashboard_acknowledged) return false;
      return notes.includes("🔴") || notes.includes("🟡") || notes.includes("🟢");
    }) || [];

  return <NotificationCenterList initialAlerts={alerts} loadError={loadError} />;
}
