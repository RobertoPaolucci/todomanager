import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

function extractDirectProgressive(value: string | null | undefined) {
  const match = String(value ?? "").match(/^DIR-(\d{6})$/i);
  return match ? Number(match[1]) : 0;
}

export async function GET() {
  const { data, error } = await supabaseServer
    .from("bookings")
    .select("booking_reference")
    .ilike("booking_reference", "DIR-%")
    .order("booking_reference", { ascending: false })
    .limit(200);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const maxProgressive = (data ?? []).reduce((max, row) => {
    return Math.max(max, extractDirectProgressive(row.booking_reference));
  }, 0);

  const reference = `DIR-${String(maxProgressive + 1).padStart(6, "0")}`;

  return NextResponse.json({ reference });
}