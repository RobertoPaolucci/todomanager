import { createHash, timingSafeEqual } from "node:crypto";
import { archiveAndClassifyViatorEmail, validateViatorEmailPayload } from "@/lib/viator-email-imports";

export const runtime = "nodejs";
const MAX_PAYLOAD_BYTES = 2 * 1024 * 1024;

function json(body: unknown, status: number) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...(status === 503 ? { "Retry-After": "30" } : {}) } });
}

export async function POST(request: Request) {
  const secret = process.env.VIATOR_EMAIL_WEBHOOK_SECRET;
  if (!secret?.trim()) return json({ error: "webhook_not_configured" }, 503);
  // /api bypasses application login: authentication is enforced here.
  const authorization = request.headers.get("authorization") ?? "";
  const digest = (value: string) => createHash("sha256").update(value).digest();
  if (!timingSafeEqual(digest(authorization), digest(`Bearer ${secret}`))) return json({ error: "unauthorized" }, 401);
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) return json({ error: "expected_json" }, 415);
  const reader = request.body?.getReader();
  if (!reader) return json({ error: "invalid_payload" }, 400);
  let payload: unknown;
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_PAYLOAD_BYTES) {
        await reader.cancel();
        return json({ error: "payload_too_large" }, 413);
      }
      chunks.push(part.value);
    }
    payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return json({ error: "invalid_json" }, 400);
  } finally {
    reader.releaseLock();
  }
  if (!validateViatorEmailPayload(payload)) return json({ error: "invalid_payload", required: "non_empty_body" }, 400);
  try {
    const { supabaseServer } = await import("@/lib/supabase-server");
    const { http_status, ...result } = await archiveAndClassifyViatorEmail(
      supabaseServer, payload, process.env.VIATOR_EMAIL_PROCESS_BOOKINGS === "true",
    );
    return json(result, http_status);
  } catch {
    return json({ error: "email_archive_unavailable", retryable: true, booking_writes_enabled: false }, 503);
  }
}
