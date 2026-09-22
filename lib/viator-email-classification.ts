import { parseViatorTime, type ParsedViatorEmail } from "./viator-email-parser";

export const VIATOR_EMAIL_SCOPE = { business_unit_id: 1, channel_id: 2, booking_source: "Viator" } as const;
export const VIATOR_IMPORT_STATUSES = ["archived", "processing", "processing_failed", "ready", "needs_mapping", "duplicate_candidate", "needs_review", "modified", "cancelled", "modification_unmatched", "cancellation_unmatched"] as const;
export type ViatorImportStatus = typeof VIATOR_IMPORT_STATUSES[number];
export type ViatorBookingCandidate = { id: number; business_unit_id: number; booking_reference: string | null };
export type ViatorProductMapping = {
  id: number; business_unit_id: number; viator_product_code: string; viator_tour_grade_code: string;
  experience_id: number; default_time: string | null; active: boolean;
};

export function findViatorHistoricalNumericCandidates(reference: string, bookings: ViatorBookingCandidate[]) {
  if (!/^BR-\d+$/.test(reference)) return [];
  return bookings.filter(b => b.business_unit_id === 1 && b.booking_reference === reference.slice(3));
}

export function classifyViatorEmail(parsed: ParsedViatorEmail, bookings: ViatorBookingCandidate[], mappings: ViatorProductMapping[]) {
  const base = { ...VIATOR_EMAIL_SCOPE, booking_writes_enabled: false, booking_id: null };
  const outcome = (status: ViatorImportStatus, reason: string, extra: Record<string, unknown> = {}) => ({ ...base, status, reason, would_do: "none", ...extra });
  if (parsed.event_type === "unknown") return outcome("needs_review", "unrecognized_email");
  if (!parsed.booking_reference || parsed.warnings.length) return outcome("needs_review", "missing_or_ambiguous_fields", { warnings: parsed.warnings });
  const exact = bookings.filter(b => b.business_unit_id === 1 && b.booking_reference === parsed.booking_reference);
  if (exact.length > 1) return outcome("needs_review", "multiple_canonical_bookings", { candidate_booking_ids: exact.map(b => b.id) });
  if (parsed.event_type === "modified" || parsed.event_type === "cancelled") {
    if (!exact.length) return outcome(parsed.event_type === "modified" ? "modification_unmatched" : "cancellation_unmatched", "canonical_booking_not_found");
    return outcome(parsed.event_type, "canonical_booking_found_dry_run", {
      would_do: parsed.event_type === "modified" ? "review_modification" : "cancel_booking",
      // Conceptual match only; no live link is written during Phase 1.
      candidate_booking_ids: [exact[0].id],
    });
  }
  const numeric = findViatorHistoricalNumericCandidates(parsed.booking_reference, bookings);
  if (exact.length || numeric.length) return outcome("duplicate_candidate", numeric.length ? "historical_numeric_reference" : "canonical_reference_exists", {
    candidate_booking_ids: [...exact, ...numeric].map(b => b.id),
  });
  const mapping = mappings.filter(m => m.active && m.business_unit_id === 1 && m.viator_product_code === parsed.product_code && m.viator_tour_grade_code === parsed.tour_grade);
  if (mapping.length > 1) return outcome("needs_review", "multiple_product_mappings");
  if (!mapping.length) return outcome("needs_mapping", "exact_product_mapping_missing");
  const time = parsed.activity_time ?? parseViatorTime(mapping[0].default_time);
  const missing = [!parsed.activity_date && "activity_date", !time && "activity_time", !parsed.lead_traveller && "lead_traveller", !(parsed.total_travellers && parsed.total_travellers > 0) && "travellers"].filter(Boolean);
  if (missing.length) return outcome("needs_review", "incomplete_confirmation", { missing_fields: missing, mapping_id: mapping[0].id });
  return outcome("ready", "confirmation_ready_dry_run", {
    would_do: "create_booking", mapping_id: mapping[0].id,
    proposed_booking: {
      ...VIATOR_EMAIL_SCOPE, experience_id: mapping[0].experience_id,
      booking_reference: parsed.booking_reference, booking_date: parsed.activity_date,
      booking_time: time, customer_name: parsed.lead_traveller,
      adults: parsed.adults, children: parsed.children, infants: parsed.infants, total_people: parsed.total_travellers,
      // Economics deliberately absent until separately verified.
    },
  });
}
