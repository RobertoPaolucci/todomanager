import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseViatorEmail, VIATOR_EMAIL_PARSER_VERSION, type ParsedViatorEmail } from "./viator-email-parser";
import { classifyViatorEmail, isViatorBookingRequest, VIATOR_IMPORT_STATUSES, type ViatorImportStatus, type ViatorBookingCandidate, type ViatorProductMapping } from "./viator-email-classification";

export type ViatorEmailPayload = {
  message_id?: string | null; received_at?: string | null; subject?: string | null; sender?: string | null;
  body: string; [key: string]: unknown;
};
const trimOrNull = (value: string | null | undefined) => value?.trim() || null;
const LEASE_MS = 5 * 60 * 1000;

export function validateViatorEmailPayload(value: unknown): value is ViatorEmailPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const p = value as Record<string, unknown>;
  return typeof p.body === "string" && p.body.trim().length > 0 &&
    ["message_id", "received_at", "subject", "sender"].every(k => p[k] == null || typeof p[k] === "string");
}

export async function archiveAndClassifyViatorEmail(db: SupabaseClient, payload: ViatorEmailPayload, processingRequested = false) {
  const messageId = trimOrNull(payload.message_id);
  // received_at is excluded: a redelivery may use another transport timestamp.
  const contentHash = createHash("sha256").update(JSON.stringify([payload.body, payload.subject ?? null, payload.sender ?? null])).digest("hex");
  const received = trimOrNull(payload.received_at);
  const receivedAt = received && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(received) && Number.isFinite(Date.parse(received))
    ? new Date(received).toISOString() : null;
  const stored = {
    business_unit_id: 1, message_id: messageId, received_at: receivedAt,
    subject: payload.subject ?? null, sender: payload.sender ?? null,
    raw_body: payload.body, raw_payload: payload, event_type: "unknown", status: "archived",
    parser_version: VIATOR_EMAIL_PARSER_VERSION, content_hash: contentHash, attempts: 0,
  };
  // FIRST database operation. Never parse or query bookings before archiving.
  const inserted = await db.from("viator_email_imports").insert(stored).select("*").single();
  let row = inserted.data;
  let duplicate = false;
  if (inserted.error) {
    if (inserted.error.code !== "23505" || !messageId) throw new Error("email_archive_failed");
    const existing = await db.from("viator_email_imports").select("*").eq("business_unit_id", 1).eq("message_id", messageId).maybeSingle();
    if (existing.error || !existing.data) throw new Error("email_archive_conflict_unresolved");
    row = existing.data;
    duplicate = true;
    if (row.content_hash !== contentHash) return {
      http_status: 409, import_id: row.id, status: row.status, duplicate: true, retryable: false,
      error: "message_id_content_conflict", booking_writes_enabled: false,
    };
  }
  if (!row) throw new Error("email_archive_failed");
  const response = (status: string, http_status = 200, retryable = false, bookingId: number | null = null) => ({
    http_status, import_id: row.id, status, duplicate, retryable, booking_writes_enabled: bookingId !== null,
    ...(bookingId !== null ? { booking_id: bookingId, action: "create_booking" } : {}),
  });
  if (!["archived", "processing", "processing_failed"].includes(row.status)) return response(row.status, 200, false,
    row.parsed_data?.classification?.action === "create_booking" ? row.booking_id : null);
  if (row.status === "processing" && Date.now() - Date.parse(row.processing_started_at) < LEASE_MS) return response("processing", 503, true);

  const attempts = row.attempts + 1;
  const startedAt = new Date().toISOString();
  // Compare-and-set claim. Retries can recover abandoned processing after 5 min.
  let claim = db.from("viator_email_imports").update({ status: "processing", attempts, processing_started_at: startedAt, error_message: null })
    .eq("id", row.id).eq("business_unit_id", 1).eq("attempts", row.attempts).eq("status", row.status);
  claim = row.processing_started_at ? claim.eq("processing_started_at", row.processing_started_at) : claim.is("processing_started_at", null);
  const claimed = await claim.select("id").maybeSingle();
  if (claimed.error || !claimed.data) return response("processing", 503, true);
  let parsed: ParsedViatorEmail | null = null;
  const parsingColumns = () => parsed ? {
    event_type: parsed.event_type, booking_reference: parsed.booking_reference,
    viator_product_code: parsed.product_code, viator_tour_grade_code: parsed.tour_grade,
    parser_version: parsed.parser_version,
  } : {};
  const save = (data: Record<string, unknown>) => db.from("viator_email_imports").update(data)
    .eq("id", row.id).eq("business_unit_id", 1).eq("status", "processing")
    .eq("attempts", attempts).eq("processing_started_at", startedAt).select("id").maybeSingle();
  try {
    parsed = parseViatorEmail(payload.body, payload.subject ?? "");
    // Pending requests are not booking events, even if the body quotes a confirmation.
    // Keep the existing DB event type; the classification reason identifies the request.
    if (isViatorBookingRequest(payload.subject ?? "")) parsed.event_type = "unknown";
    let bookings: ViatorBookingCandidate[] = [];
    let mappings: ViatorProductMapping[] = [];
    if (parsed.booking_reference && parsed.event_type !== "unknown" && !parsed.warnings.length) {
      const lookup = await db.from("bookings").select("id, business_unit_id, booking_reference")
        .eq("business_unit_id", 1).eq("booking_reference", parsed.booking_reference).limit(2);
      if (lookup.error) throw new Error("booking_lookup_failed");
      bookings = lookup.data ?? [];
      if (parsed.event_type === "confirmed") {
        // Separate bounded query: numerous numeric variants cannot hide multiple
        // canonical bookings behind a shared LIMIT.
        const historical = await db.from("bookings").select("id, business_unit_id, booking_reference")
          .eq("business_unit_id", 1).eq("booking_reference", parsed.booking_reference.slice(3)).limit(1);
        if (historical.error) throw new Error("booking_lookup_failed");
        bookings.push(...(historical.data ?? []));
      }
      if (parsed.event_type === "confirmed" && parsed.product_code && parsed.tour_grade) {
        const mapping = await db.from("viator_product_mappings").select("id, business_unit_id, viator_product_code, viator_tour_grade_code, experience_id, default_time, active")
          .eq("business_unit_id", 1).eq("viator_product_code", parsed.product_code)
          .eq("viator_tour_grade_code", parsed.tour_grade).eq("active", true).limit(2);
        if (mapping.error) throw new Error("mapping_lookup_failed");
        mappings = mapping.data ?? [];
        if (mappings.length === 1) {
          // Defensive check even before the database's composite FK is installed.
          const experience = await db.from("experiences").select("id").eq("id", mappings[0].experience_id).eq("business_unit_id", 1).maybeSingle();
          if (experience.error || !experience.data) throw new Error("mapping_business_unit_mismatch");
        }
      }
    }
    let classification = classifyViatorEmail(parsed, bookings, mappings, payload.subject ?? "");
    // Envelope scope never overrides the fixed FMDQ scope. In live mode a
    // contradictory scope is reviewed rather than silently used for a write.
    if (processingRequested && ((payload.business_unit_id != null && payload.business_unit_id !== 1) ||
        (payload.channel_id != null && payload.channel_id !== 2))) {
      classification = { ...classification, status: "needs_review", reason: "scope_mismatch", would_do: "none" };
    }
    const parsedData = {
      ...parsed, classification, processing_requested: processingRequested,
      processing_mode: "dry_run", booking_writes_blocked_reason: "phase_1_historical_transition_pending",
      transport_warnings: received && !receivedAt ? ["invalid_received_at"] : [],
    };
    if (processingRequested && parsed.event_type === "confirmed" && classification.status === "ready" &&
        classification.would_do === "create_booking" && /^BR-\d+$/.test(parsed.booking_reference ?? "")) {
      // Persist the plan while retaining the lease. The RPC revalidates it and
      // commits the INSERT + import link together; never fall back to REST INSERT.
      const prepared = await save({ ...parsingColumns(), parsed_data: {
        ...parsedData, processing_mode: "create_confirmed", booking_writes_blocked_reason: null,
      } });
      if (prepared.error || !prepared.data) throw new Error("classification_save_failed");
      const created = await db.rpc("create_viator_email_booking", {
        p_import_id: row.id, p_attempts: attempts, p_started_at: startedAt,
      });
      if (created.error || !created.data) throw new Error("booking_creation_failed");
      const result = created.data;
      if (result.status === "processing_failed") return {
        ...response(result.status, 503, true), error: "booking_creation_failed",
      };
      return response(result.status, 200, false, result.action === "create_booking" ? result.booking_id : null);
    }
    const result = await save({
      ...parsingColumns(), status: classification.status, booking_id: null,
      parsed_data: parsedData,
      error_message: null, processed_at: new Date().toISOString(), processing_started_at: null,
    });
    if (result.error || !result.data) throw new Error("classification_save_failed");
    return response(classification.status);
  } catch (error) {
    // Store only controlled error codes; never database messages, raw emails or secrets in HTTP/logs.
    const allowed = ["booking_lookup_failed", "mapping_lookup_failed", "mapping_business_unit_mismatch", "classification_save_failed", "booking_creation_failed"];
    const code = error instanceof Error && allowed.includes(error.message) ? error.message : "email_processing_failed";
    const saved = await save({
      ...parsingColumns(), parsed_data: parsed ?? {}, status: "processing_failed",
      error_message: code, processed_at: null, processing_started_at: null,
    });
    return { ...response(saved.error || !saved.data ? "processing" : "processing_failed", 503, true), error: code };
  }
}

// Internal server API for the future authenticated review page. No public GET
// route, credentials, acknowledgement mutation or NotificationCenter integration.
export async function listViatorEmailImports(db: SupabaseClient, options: { status?: ViatorImportStatus; beforeId?: number; limit?: number } = {}) {
  const limit = options.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 ||
      (options.beforeId !== undefined && (!Number.isSafeInteger(options.beforeId) || options.beforeId < 1)) ||
      (options.status && !VIATOR_IMPORT_STATUSES.includes(options.status))) throw new Error("invalid_review_filter");
  let query = db.from("viator_email_imports")
    .select("id, business_unit_id, received_at, created_at, subject, sender, event_type, booking_reference, viator_product_code, viator_tour_grade_code, status, booking_id, error_message, parser_version, attempts, processed_at")
    .eq("business_unit_id", 1).order("id", { ascending: false }).limit(limit);
  if (options.status) query = query.eq("status", options.status);
  if (options.beforeId) query = query.lt("id", options.beforeId);
  const result = await query;
  if (result.error) throw new Error("review_read_failed");
  return result.data;
}

export async function getViatorEmailImport(db: SupabaseClient, id: number) {
  if (!Number.isSafeInteger(id) || id < 1) throw new Error("invalid_import_id");
  const result = await db.from("viator_email_imports").select("*").eq("business_unit_id", 1).eq("id", id).maybeSingle();
  if (result.error) throw new Error("review_read_failed");
  return result.data;
}
