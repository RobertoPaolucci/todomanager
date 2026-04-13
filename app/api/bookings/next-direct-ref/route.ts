import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

function isDirectChannel(channel?: { name?: string | null; type?: string | null } | null) {
  const type = String(channel?.type ?? "").trim().toLowerCase();
  const name = String(channel?.name ?? "").trim().toLowerCase();
  return type === "direct" || name === "direct" || name === "diretto";
}

function isAgencyChannel(channel?: { name?: string | null; type?: string | null } | null) {
  const type = String(channel?.type ?? "").trim().toLowerCase();
  return type === "agency";
}

function getPrefixFromChannel(
  channel?: { name?: string | null; type?: string | null } | null
) {
  if (isDirectChannel(channel)) return "DIR";
  if (isAgencyChannel(channel)) return "AGY";
  return null;
}

function extractProgressiveByPrefix(
  value: string | null | undefined,
  prefix: string
) {
  const match = String(value ?? "").match(
    new RegExp(`^${prefix}-(\\d{6})$`, "i")
  );
  return match ? Number(match[1]) : 0;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const channelId = Number(searchParams.get("channelId") || 0);

  if (!channelId) {
    return NextResponse.json({ reference: null }, { status: 400 });
  }

  const { data: channel, error: channelError } = await supabaseServer
    .from("channels")
    .select("id, name, type")
    .eq("id", channelId)
    .single();

  if (channelError || !channel) {
    return NextResponse.json(
      { error: channelError?.message || "Canale non trovato" },
      { status: 404 }
    );
  }

  const prefix = getPrefixFromChannel(channel);

  if (!prefix) {
    return NextResponse.json({ reference: null });
  }

  const { data, error } = await supabaseServer
    .from("bookings")
    .select("booking_reference")
    .ilike("booking_reference", `${prefix}-%`)
    .order("booking_reference", { ascending: false })
    .limit(200);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const maxProgressive = (data ?? []).reduce((max, row) => {
    return Math.max(
      max,
      extractProgressiveByPrefix(row.booking_reference, prefix)
    );
  }, 0);

  const reference = `${prefix}-${String(maxProgressive + 1).padStart(6, "0")}`;

  return NextResponse.json({ reference });
}