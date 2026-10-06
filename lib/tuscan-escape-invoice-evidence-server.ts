import { supabaseServer } from "@/lib/supabase-server";
import type { TuscanEscapeGuideEvidence } from "@/lib/booking-pricing";
import { resolveTuscanEscapeInvoiceEvidence } from "./tuscan-escape-invoice-evidence.mjs";

type EvidenceBooking = {
  id: number | string; channel_id?: number | null; is_cancelled?: boolean | null;
  adults?: number | null; children?: number | null; infants?: number | null;
  booking_reference?: string | null; booking_date?: string | null;
};

/** Read-only, paginated server acquisition; no credentials/data passed to clients.
 * Read all identities to detect truncated-reference collisions across months.
 */
export async function getTuscanEscapeInvoiceEvidence(bookings: EvidenceBooking[]) {
  if (!bookings.some(row => Number(row.channel_id) === 7 && row.is_cancelled !== true
    && Number(row.adults ?? 0) + Number(row.children ?? 0) === 8)) {
    return new Map<string, TuscanEscapeGuideEvidence>();
  }
  async function read(table: string, columns: string) {
    const rows: Record<string, unknown>[] = [];
    let lastId = 0;
    for (;;) {
      const response = await supabaseServer.from(table).select(columns)
        .gt("id", lastId).order("id").limit(500);
      if (response.error) throw new Error("Impossibile verificare l'evidenza Google per la tariffa Tuscan Escape.");
      const page = response.data as unknown as Record<string, unknown>[];
      if (!page.length) return rows;
      rows.push(...page);
      lastId = Number(page[page.length - 1].id);
    }
  }
  const [staging, events, aliases] = await Promise.all([
    read("google_calendar_import_staging", "id,gcal_uid,booking_date,original_title,channel_id,import_status,imported_booking_id,notes"),
    read("google_calendar_events", "id,identity_namespace,occurrence_id,canonical_uid,original_uid,original_title,event_date,gcal_event_status"),
    read("google_calendar_event_aliases", "id,event_id,identity_namespace,occurrence_id,canonical_uid,original_uid,verified"),
  ]);
  return resolveTuscanEscapeInvoiceEvidence(bookings, staging, events, aliases) as Map<string, TuscanEscapeGuideEvidence>;
}
