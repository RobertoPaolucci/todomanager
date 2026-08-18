import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase-server";

const HORSEBACK_EXPERIENCE_IDS = [1, 8, 9];

function truthyFlag(value: unknown) {
  if (value === true) return true;
  if (value === false || value == null) return false;

  if (typeof value === "number") return value === 1;

  if (typeof value === "string") {
    return ["true", "1", "yes", "y", "t"].includes(
      value.toLowerCase().trim()
    );
  }

  return false;
}

function isCancelled(row: any) {
  const hasCancelledFlag =
    Boolean(row.deleted_at) ||
    Boolean(row.cancelled_at) ||
    Boolean(row.canceled_at) ||
    truthyFlag(row.is_deleted) ||
    truthyFlag(row.is_cancelled) ||
    truthyFlag(row.is_canceled) ||
    row.active === false ||
    row.active === 0 ||
    row.active === "0" ||
    row.active === "false";

  if (hasCancelledFlag) return true;

  const explicit = String(
    row.status ||
      row.booking_status ||
      row.state ||
      ""
  )
    .toLowerCase()
    .trim();

  return (
    explicit.includes("cancel") ||
    explicit.includes("annull")
  );
}

function getChannelName(channel: any) {
  if (!channel) return "—";

  if (Array.isArray(channel)) {
    return channel[0]?.name || "—";
  }

  return channel.name || "—";
}

function countPeople(row: any) {
  return (
    Number(row.adults || 0) +
    Number(row.children || 0) +
    Number(row.infants || 0)
  );
}

function getMonthDates(month: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(month);

  if (!match) return null;

  const year = Number(match[1]);
  const monthNumber = Number(match[2]);

  if (monthNumber < 1 || monthNumber > 12) return null;

  const days = new Date(year, monthNumber, 0).getDate();

  return {
    firstDate: `${month}-01`,
    lastDate: `${month}-${String(days).padStart(2, "0")}`,
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const month = searchParams.get("month") || "";
  const monthDates = getMonthDates(month);

  if (!monthDates) {
    return NextResponse.json(
      { error: "Mese non valido" },
      { status: 400 }
    );
  }

  const supabase = supabaseServer;

  const [bookingsResult, availabilityResult] = await Promise.all([
    supabase
      .from("bookings")
      .select(
        `
        *,
        channel:channels (
          id,
          name
        )
      `
      )
      .in("experience_id", HORSEBACK_EXPERIENCE_IDS)
      .gte("booking_date", monthDates.firstDate)
      .lte("booking_date", monthDates.lastDate)
      .order("booking_date", { ascending: true })
      .order("booking_time", { ascending: true })
      .order("id", { ascending: true }),

    supabase
      .from("horseback_availability")
      .select(
        "availability_date, morning_open, afternoon_open, updated_at, updated_by"
      )
      .gte("availability_date", monthDates.firstDate)
      .lte("availability_date", monthDates.lastDate)
      .order("availability_date", { ascending: true }),
  ]);

  if (bookingsResult.error) {
    console.error(
      "Errore bookings availability:",
      bookingsResult.error
    );

    return NextResponse.json(
      { error: bookingsResult.error.message },
      { status: 500 }
    );
  }

  if (availabilityResult.error) {
    console.error(
      "Errore horseback_availability:",
      availabilityResult.error
    );

    return NextResponse.json(
      { error: availabilityResult.error.message },
      { status: 500 }
    );
  }

  const activeBookings = (bookingsResult.data || [])
    .filter((row: any) => !isCancelled(row))
    .map((row: any) => ({
      id: row.id,
      booking_reference: row.booking_reference,
      booking_date: row.booking_date,
      booking_time: row.booking_time,
      customer_name: row.customer_name,
      channel_name: getChannelName(row.channel),
      people: countPeople(row),
    }));

  return NextResponse.json({
    bookings: activeBookings,
    availability: availabilityResult.data || [],
  });
}

type UpdateBody = {
  date?: string;
  period?: "day" | "morning" | "afternoon";
  action?: "open" | "close";
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as UpdateBody;

    const date = body.date;
    const period = body.period;
    const action = body.action;

    if (
      !date ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date)
    ) {
      return NextResponse.json(
        { error: "Data non valida" },
        { status: 400 }
      );
    }

    if (
      period !== "day" &&
      period !== "morning" &&
      period !== "afternoon"
    ) {
      return NextResponse.json(
        { error: "Periodo non valido" },
        { status: 400 }
      );
    }

    if (action !== "open" && action !== "close") {
      return NextResponse.json(
        { error: "Azione non valida" },
        { status: 400 }
      );
    }

    const supabase = supabaseServer;

    const { data: current, error: currentError } =
      await supabase
        .from("horseback_availability")
        .select(
          "availability_date, morning_open, afternoon_open"
        )
        .eq("availability_date", date)
        .maybeSingle();

    if (currentError) {
      return NextResponse.json(
        { error: currentError.message },
        { status: 500 }
      );
    }

    let morningOpen =
      current?.morning_open ?? true;

    let afternoonOpen =
      current?.afternoon_open ?? true;

    const opening = action === "open";

    if (period === "day") {
      morningOpen = opening;
      afternoonOpen = opening;
    }

    if (period === "morning") {
      morningOpen = opening;
    }

    if (period === "afternoon") {
      afternoonOpen = opening;
    }

    const updatedAt = new Date().toISOString();

    const { data: updated, error: updateError } =
      await supabase
        .from("horseback_availability")
        .upsert(
          {
            availability_date: date,
            morning_open: morningOpen,
            afternoon_open: afternoonOpen,
            updated_at: updatedAt,
            updated_by: "Cognanello",
          },
          {
            onConflict: "availability_date",
          }
        )
        .select(
          "availability_date, morning_open, afternoon_open, updated_at, updated_by"
        )
        .single();

    if (updateError) {
      return NextResponse.json(
        { error: updateError.message },
        { status: 500 }
      );
    }

    const { error: historyError } = await supabase
      .from("horseback_availability_history")
      .insert({
        availability_date: date,
        period,
        action,
        morning_open: morningOpen,
        afternoon_open: afternoonOpen,
        requested_by: "Cognanello",
      });

    if (historyError) {
      console.error(
        "Errore storico disponibilità:",
        historyError
      );

      return NextResponse.json(
        { error: historyError.message },
        { status: 500 }
      );
    }

    revalidatePath("/cognanello/disponibilita");
    revalidatePath("/disponibilita-cavalli");

    return NextResponse.json({
      success: true,
      availability: updated,
    });
  } catch (error) {
    console.error("Errore availability POST:", error);

    return NextResponse.json(
      { error: "Errore interno" },
      { status: 500 }
    );
  }
}