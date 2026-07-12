export const dynamic = "force-dynamic";

import Link from "next/link";
import AppShell from "@/components/AppShell";
import SectionCard from "@/components/SectionCard";
import NotificationCenter from "@/components/NotificationCenter";
import { getDashboardStats } from "@/lib/dashboard";
import { supabaseServer } from "@/lib/supabase-server";

function formatEuro(value: number) {
  return new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDate(value: string | null) {
  if (!value) return "-";

  const [year, month, day] = String(value).split("-").map(Number);
  const d = new Date(year, (month || 1) - 1, day || 1);

  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "2-digit",
  }).format(d);
}

function formatDateFull(value: string | null) {
  if (!value) return "-";

  const [year, month, day] = String(value).split("-").map(Number);
  const d = new Date(year, (month || 1) - 1, day || 1);

  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}

function formatDateTimeRome(value: string | null) {
  if (!value) return "-";

  const d = new Date(value);

  if (Number.isNaN(d.getTime())) return "-";

  return new Intl.DateTimeFormat("it-IT", {
    timeZone: "Europe/Rome",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function formatTime(value: string | null) {
  if (!value) return "-";
  return String(value).slice(0, 5);
}

function formatExperienceDateTime(row: {
  booking_date: string | null;
  booking_time: string | null;
}) {
  const date = formatDateFull(row.booking_date);
  const time = formatTime(row.booking_time);

  if (date === "-" && time === "-") return "-";
  if (time === "-") return date;

  return `${date} ore ${time}`;
}

function getMonthName(monthIndex: number) {
  const date = new Date(2024, monthIndex, 1);
  return new Intl.DateTimeFormat("it-IT", { month: "long" }).format(date);
}

function getShortMonthName(monthIndex: number) {
  const date = new Date(2024, monthIndex, 1);
  return new Intl.DateTimeFormat("it-IT", { month: "short" }).format(date);
}

function formatPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "-";

  return new Intl.NumberFormat("it-IT", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
    signDisplay: "exceptZero",
  }).format(value) + "%";
}

function toLocalDateString(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(
    2,
    "0"
  )}`;
}

function googleImportStatusLabel(status: string | null) {
  switch (status) {
    case "pending":
      return "Nuova";
    case "rolled_back":
      return "Da reimportare";
    case "needs_review":
      return "Da verificare";
    case "possible_duplicate":
      return "Possibile doppione";
    case "gcal_cancelled":
      return "Cancellata da Google Calendar";
    default:
      return status || "Da controllare";
  }
}

function googleImportStatusClass(status: string | null) {
  switch (status) {
    case "pending":
    case "rolled_back":
      return "bg-amber-100 text-amber-900";
    case "needs_review":
    case "possible_duplicate":
    case "gcal_cancelled":
      return "bg-red-100 text-red-800";
    default:
      return "bg-zinc-100 text-zinc-700";
  }
}

function googleImportPeopleLabel(row: {
  adults: number | null;
  children: number | null;
  infants: number | null;
}) {
  const adults = Number(row.adults || 0);
  const children = Number(row.children || 0);
  const infants = Number(row.infants || 0);
  const total = adults + children + infants;

  const parts = [`${total} pax`];

  if (adults > 0) parts.push(`${adults} adulti`);
  if (children > 0) parts.push(`${children} bambini`);
  if (infants > 0) parts.push(`${infants} infanti`);

  return parts.join(" · ");
}

type PageProps = {
  searchParams: Promise<{ m?: string; y?: string }>;
};

type GoogleCalendarImportRow = {
  id: number;
  booking_reference: string | null;
  booking_date: string | null;
  booking_time: string | null;
  customer_name: string | null;
  adults: number | null;
  children: number | null;
  infants: number | null;
  experience_id: number | null;
  channel_id: number | null;
  booking_source: string | null;
  import_status: string | null;
  original_title: string | null;
  notes: string | null;
  import_origin: string | null;
  gcal_updated_at: string | null;
  gcal_html_link: string | null;
};


type DashboardBookingForMatch = {
  id: number;
  booking_reference: string | null;
  booking_date: string | null;
  booking_time: string | null;
  experience_id: number | null;
  channel_id: number | null;
  customer_name: string | null;
  is_cancelled: boolean | null;
};

function normalizeTextForMatch(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type BusinessUnitTotals = {
  entrate: number;
  spese: number;
  totale: number;
  prenotazioni: number;
};

function emptyBusinessUnitTotals(): BusinessUnitTotals {
  return {
    entrate: 0,
    spese: 0,
    totale: 0,
    prenotazioni: 0,
  };
}

function getBookingAmounts(row: any) {
  const entrate = Number(row.total_to_you || 0);
  const spese = Number(row.total_supplier_cost || 0);

  return {
    entrate,
    spese,
    totale: entrate - spese,
  };
}

function addAmounts(target: BusinessUnitTotals, amounts: ReturnType<typeof getBookingAmounts>) {
  target.entrate += amounts.entrate;
  target.spese += amounts.spese;
  target.totale += amounts.totale;
  target.prenotazioni += 1;
}

function getYearMonthFromBookingDate(value: string | null | undefined) {
  if (!value) return null;

  const [year, month] = String(value).split("-").map(Number);

  if (!year || !month) return null;

  return { year, month };
}

function getBusinessUnitKey(
  booking: any,
  businessUnitNameById: Map<number, string>
) {
  const businessUnitName = businessUnitNameById.get(
    Number(booking.business_unit_id)
  );

  const normalized = normalizeTextForMatch(businessUnitName);

  if (normalized.includes("TOD")) return "todointheworld";

  if (
    normalized.includes("FMDQ") ||
    normalized.includes("FATTORIA") ||
    normalized.includes("MADONNA") ||
    normalized.includes("QUERCE")
  ) {
    return "fmdq";
  }

  return "altro";
}

function extractTodoReferenceCodes(value: string | null | undefined) {
  const text = normalizeTextForMatch(value);
  const matches = text.match(/\bT\d{5,}\b/g) ?? [];
  return Array.from(new Set(matches));
}

function googleSearchText(row: GoogleCalendarImportRow) {
  return [
    row.notes,
    row.original_title,
    row.customer_name,
    row.booking_reference,
  ]
    .filter(Boolean)
    .join(" ");
}

function buildReferenceCodeMap(bookings: DashboardBookingForMatch[]) {
  const map = new Map<string, DashboardBookingForMatch[]>();

  for (const booking of bookings) {
    const codes = extractTodoReferenceCodes(booking.booking_reference);

    for (const code of codes) {
      const current = map.get(code) ?? [];
      current.push(booking);
      map.set(code, current);
    }
  }

  return map;
}

function hasReferenceMatchFromGoogleTitle(
  row: GoogleCalendarImportRow,
  referenceCodeMap: Map<string, DashboardBookingForMatch[]>
) {
  const codes = extractTodoReferenceCodes(googleSearchText(row));

  for (const code of codes) {
    const candidates = referenceCodeMap.get(code) ?? [];
    const activeCandidates = candidates.filter(
      (booking) => booking.is_cancelled !== true
    );

    if (activeCandidates.length > 0) {
      return true;
    }
  }

  return false;
}

const DASHBOARD_NAME_STOP_WORDS = new Set([
  "ADULTO",
  "ADULTI",
  "BAMBINO",
  "BAMBINI",
  "BAMBINA",
  "NEONATO",
  "NEONATI",
  "INFANTE",
  "INFANTI",
  "PRANZO",
  "CENA",
  "TOUR",
  "CON",
  "ORE",
  "ALLE",
  "DA",
  "PER",
  "E",
  "IL",
  "LA",
  "LO",
  "GLI",
  "LE",
  "DI",
  "DEL",
  "DELLA",
  "DEI",
  "FATTORIA",
  "MADONNA",
  "QUERCE",
  "GOOGLE",
  "CALENDAR",
  "GCAL",
  "TOD",
]);

function nameTokens(value: string | null | undefined) {
  return normalizeTextForMatch(value)
    .split(" ")
    .filter((token) => {
      if (token.length < 3) return false;
      if (DASHBOARD_NAME_STOP_WORDS.has(token)) return false;
      if (/^\d+$/.test(token)) return false;
      if (/^T\d+$/i.test(token)) return false;
      if (/^GCAL$/i.test(token)) return false;
      return true;
    });
}

function hasUniqueNameMatchFromGoogleTitle(
  row: GoogleCalendarImportRow,
  bookings: DashboardBookingForMatch[]
) {
  const googleTokens = new Set(nameTokens(googleSearchText(row)));

  if (googleTokens.size === 0) return false;

  const candidates = bookings.filter((booking) => {
    if (booking.is_cancelled === true) return false;
    if (booking.booking_date !== row.booking_date) return false;

    const customerTokens = nameTokens(booking.customer_name);

    if (customerTokens.length === 0) return false;

    const matchedNameTokens = customerTokens.filter((token) =>
      googleTokens.has(token)
    );

    const hasStrongNameMatch =
      matchedNameTokens.length >= 2 ||
      (customerTokens.length === 1 && matchedNameTokens.length === 1);

    if (!hasStrongNameMatch) return false;

    const sameExperience =
      row.experience_id !== null && booking.experience_id === row.experience_id;

    const sameChannel =
      row.channel_id !== null && booking.channel_id === row.channel_id;

    return sameExperience || sameChannel;
  });

  return candidates.length === 1;
}

function isGoogleCalendarRowAlreadyManaged(
  row: GoogleCalendarImportRow,
  bookings: DashboardBookingForMatch[],
  referenceCodeMap: Map<string, DashboardBookingForMatch[]>
) {
  if (row.import_status === "gcal_cancelled") {
    return false;
  }

  return (
    hasReferenceMatchFromGoogleTitle(row, referenceCodeMap) ||
    hasUniqueNameMatchFromGoogleTitle(row, bookings)
  );
}


export default async function Home({ searchParams }: PageProps) {
  const params = await searchParams;
  const today = new Date();

  const selectedMonth = params.m ? Number(params.m) : today.getMonth() + 1;
  const selectedYear = params.y ? Number(params.y) : today.getFullYear();

  const prevMonth = selectedMonth === 1 ? 12 : selectedMonth - 1;
  const prevYear = selectedMonth === 1 ? selectedYear - 1 : selectedYear;

  const nextMonth = selectedMonth === 12 ? 1 : selectedMonth + 1;
  const nextYear = selectedMonth === 12 ? selectedYear + 1 : selectedYear;

  const nomeMese = getMonthName(selectedMonth - 1);
  const lastDayOfMonth = new Date(selectedYear, selectedMonth, 0).getDate();

  const todayStr = today.toISOString().split("T")[0];
  const tenDaysFromNow = new Date(today);
  tenDaysFromNow.setDate(today.getDate() + 10);
  const tenDaysFromNowStr = tenDaysFromNow.toISOString().split("T")[0];

  const { bookingsByChannel } = await getDashboardStats();
  const maxChannelCount = Math.max(...bookingsByChannel.map((c) => c.count), 1);

  const { data: bookings, error } = await supabaseServer
    .from("bookings")
    .select("*")
    .order("booking_date", { ascending: true });

  if (error) {
    console.error("Errore caricamento prenotazioni:", error.message);
  }

  const { data: historicalBookingsData, error: historicalBookingsError } =
    await supabaseServer
      .from("historical_bookings")
      .select("booking_date, total_guests")
      .eq("historical_year", 2025)
      .order("booking_date", { ascending: true });

  if (historicalBookingsError) {
    console.error(
      "Errore caricamento storico 2025:",
      historicalBookingsError.message
    );
  }

  const { data: businessUnitsData, error: businessUnitsError } =
    await supabaseServer
      .from("business_units")
      .select("id, name")
      .order("id", { ascending: true });

  if (businessUnitsError) {
    console.error(
      "Errore caricamento contabilità:",
      businessUnitsError.message
    );
  }

  const businessUnitNameById = new Map<number, string>();

  for (const unit of businessUnitsData || []) {
    businessUnitNameById.set(Number(unit.id), String(unit.name || ""));
  }

  const googleImportStatusesToShow = [
    "pending",
    "rolled_back",
    "needs_review",
    "possible_duplicate",
      ];

  const { data: googleCalendarImportData, error: googleCalendarImportError } =
    await supabaseServer
      .from("google_calendar_import_staging")
      .select(
        "id, booking_reference, booking_date, booking_time, customer_name, adults, children, infants, experience_id, channel_id, booking_source, import_status, original_title, notes, import_origin, gcal_updated_at, gcal_html_link"
      )
      .eq("import_origin", "make")
      .in("import_status", googleImportStatusesToShow)
      .order("booking_date", { ascending: true })
      .order("booking_time", { ascending: true })
      .order("id", { ascending: true })
      .limit(30);

  if (googleCalendarImportError) {
    console.error(
      "Errore caricamento import Google Calendar:",
      googleCalendarImportError.message
    );
  }

  const allBookings = bookings || [];
  const historicalBookings2025 = historicalBookingsData || [];

  const monthlyPresence2025 = Array.from({ length: 12 }, () => 0);
  const monthlyBookings2025 = Array.from({ length: 12 }, () => 0);
  const monthlyPresence2026 = Array.from({ length: 12 }, () => 0);
  const monthlyBookings2026 = Array.from({ length: 12 }, () => 0);

  for (const row of historicalBookings2025) {
    if (!row.booking_date) continue;

    const yearMonth = getYearMonthFromBookingDate(row.booking_date);

    if (yearMonth?.year !== 2025) continue;

    monthlyPresence2025[yearMonth.month - 1] += Number(
      row.total_guests || 0
    );
    monthlyBookings2025[yearMonth.month - 1] += 1;
  }

  for (const row of allBookings) {
    if (!row.booking_date || row.is_cancelled) continue;

    const yearMonth = getYearMonthFromBookingDate(row.booking_date);

    if (yearMonth?.year !== 2026) continue;

    monthlyPresence2026[yearMonth.month - 1] += Number(
      row.total_people || 0
    );
    monthlyBookings2026[yearMonth.month - 1] += 1;
  }

  const selectedComparisonIndex = selectedMonth - 1;
  const selectedPresence2025 =
    monthlyPresence2025[selectedComparisonIndex] || 0;
  const selectedPresence2026 =
    monthlyPresence2026[selectedComparisonIndex] || 0;
  const selectedBookings2025 =
    monthlyBookings2025[selectedComparisonIndex] || 0;
  const selectedBookings2026 =
    monthlyBookings2026[selectedComparisonIndex] || 0;

  const selectedPresenceDifference =
    selectedPresence2026 - selectedPresence2025;
  const selectedBookingsDifference =
    selectedBookings2026 - selectedBookings2025;

  const selectedPresencePercent =
    selectedPresence2025 > 0
      ? (selectedPresenceDifference / selectedPresence2025) * 100
      : null;

  const selectedBookingsPercent =
    selectedBookings2025 > 0
      ? (selectedBookingsDifference / selectedBookings2025) * 100
      : null;

  const todayRomeParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(today)
    .split("-")
    .map(Number);

  const currentRomeYear = todayRomeParts[0];
  const currentRomeMonth = todayRomeParts[1];
  const currentRomeDay = todayRomeParts[2];

  const selectedMonthIsCurrent =
    selectedYear === currentRomeYear && selectedMonth === currentRomeMonth;

  const comparisonCutoffDay = selectedMonthIsCurrent
    ? currentRomeDay
    : new Date(selectedYear, selectedMonth, 0).getDate();

  const comparisonCutoff2025 = toLocalDateString(
    2025,
    selectedMonth,
    Math.min(
      comparisonCutoffDay,
      new Date(2025, selectedMonth, 0).getDate()
    )
  );

  const comparisonCutoff2026 = toLocalDateString(
    2026,
    selectedMonth,
    Math.min(
      comparisonCutoffDay,
      new Date(2026, selectedMonth, 0).getDate()
    )
  );

  let monthToDatePresence2025 = 0;
  let monthToDateBookings2025 = 0;
  let monthToDatePresence2026 = 0;
  let monthToDateBookings2026 = 0;

  for (const row of historicalBookings2025) {
    if (!row.booking_date) continue;

    const yearMonth = getYearMonthFromBookingDate(row.booking_date);

    if (
      yearMonth?.year === 2025 &&
      yearMonth.month === selectedMonth &&
      row.booking_date <= comparisonCutoff2025
    ) {
      monthToDatePresence2025 += Number(row.total_guests || 0);
      monthToDateBookings2025 += 1;
    }
  }

  for (const row of allBookings) {
    if (!row.booking_date || row.is_cancelled) continue;

    const yearMonth = getYearMonthFromBookingDate(row.booking_date);

    if (
      yearMonth?.year === 2026 &&
      yearMonth.month === selectedMonth &&
      row.booking_date <= comparisonCutoff2026
    ) {
      monthToDatePresence2026 += Number(row.total_people || 0);
      monthToDateBookings2026 += 1;
    }
  }

  const monthToDatePresenceDifference =
    monthToDatePresence2026 - monthToDatePresence2025;
  const monthToDateBookingsDifference =
    monthToDateBookings2026 - monthToDateBookings2025;

  const monthToDatePresencePercent =
    monthToDatePresence2025 > 0
      ? (monthToDatePresenceDifference / monthToDatePresence2025) * 100
      : null;

  const monthToDateBookingsPercent =
    monthToDateBookings2025 > 0
      ? (monthToDateBookingsDifference / monthToDateBookings2025) * 100
      : null;

  const annualPresence2025 = monthlyPresence2025.reduce(
    (sum, value) => sum + value,
    0
  );
  const annualPresence2026 = monthlyPresence2026.reduce(
    (sum, value) => sum + value,
    0
  );

  const comparisonChartData = Array.from({ length: 12 }, (_, index) => ({
    label: getShortMonthName(index),
    month: index + 1,
    presence2025: monthlyPresence2025[index],
    presence2026: monthlyPresence2026[index],
  }));

  const comparisonMaxPresence = Math.max(
    ...comparisonChartData.flatMap((row) => [
      row.presence2025,
      row.presence2026,
    ]),
    1
  );

  const bookingsForGoogleCalendarMatch =
    allBookings as DashboardBookingForMatch[];

  const bookingsByDateForGoogleCalendarMatch = new Map<
    string,
    DashboardBookingForMatch[]
  >();

  for (const booking of bookingsForGoogleCalendarMatch) {
    if (!booking.booking_date) continue;

    const current =
      bookingsByDateForGoogleCalendarMatch.get(booking.booking_date) ?? [];

    current.push(booking);
    bookingsByDateForGoogleCalendarMatch.set(booking.booking_date, current);
  }

  const googleCalendarImportsRaw =
    (googleCalendarImportData || []) as GoogleCalendarImportRow[];

  const googleCalendarImports = googleCalendarImportsRaw.filter((row) => {
    if (!row.booking_date) return true;

    const bookingsForDate =
      bookingsByDateForGoogleCalendarMatch.get(row.booking_date) ?? [];
    const referenceCodeMap = buildReferenceCodeMap(bookingsForDate);

    return !isGoogleCalendarRowAlreadyManaged(
      row,
      bookingsForDate,
      referenceCodeMap
    );
  });

  const urgentGoogleCalendarImports = googleCalendarImports.filter(
    (row) =>
      row.import_status === "needs_review" ||
      row.import_status === "possible_duplicate" ||
      row.import_status === "gcal_cancelled"
  );


  let meseEntrate = 0;
  let meseSpese = 0;
  let meseTotale = 0;

  const meseTodointheworld = emptyBusinessUnitTotals();
  const meseFmdq = emptyBusinessUnitTotals();
  const meseAltro = emptyBusinessUnitTotals();

  const prossimePrenotazioni: any[] = [];

  const expPaxCounts: Record<string, number> = {};

  allBookings.forEach((b) => {
    if (b.is_cancelled) return;

    const expName = b.experience_name || "Sconosciuta";
    const numPeople = Number(b.total_people || 0);
    expPaxCounts[expName] = (expPaxCounts[expName] || 0) + numPeople;

    if (b.booking_date) {
      const bookingYearMonth = getYearMonthFromBookingDate(b.booking_date);
      const amounts = getBookingAmounts(b);

      if (
        bookingYearMonth?.month === selectedMonth &&
        bookingYearMonth?.year === selectedYear
      ) {
        meseEntrate += amounts.entrate;
        meseSpese += amounts.spese;
        meseTotale += amounts.totale;

        const businessUnitKey = getBusinessUnitKey(b, businessUnitNameById);

        if (businessUnitKey === "todointheworld") {
          addAmounts(meseTodointheworld, amounts);
        } else if (businessUnitKey === "fmdq") {
          addAmounts(meseFmdq, amounts);
        } else {
          addAmounts(meseAltro, amounts);
        }
      }

      if (b.booking_date >= todayStr && b.booking_date <= tenDaysFromNowStr) {
        prossimePrenotazioni.push(b);
      }
    }
  });

  const bookingsByExperience = Object.entries(expPaxCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  const maxExpPax = Math.max(...bookingsByExperience.map((e) => e.count), 1);

  const chartData = Array.from({ length: 12 }, (_, i) => {
    const total = emptyBusinessUnitTotals();
    const todointheworld = emptyBusinessUnitTotals();
    const fmdq = emptyBusinessUnitTotals();

    for (const b of allBookings) {
      if (!b.booking_date || b.is_cancelled) continue;

      const bookingYearMonth = getYearMonthFromBookingDate(b.booking_date);

      if (bookingYearMonth?.year !== selectedYear || bookingYearMonth.month !== i + 1) {
        continue;
      }

      const amounts = getBookingAmounts(b);
      addAmounts(total, amounts);

      const businessUnitKey = getBusinessUnitKey(b, businessUnitNameById);

      if (businessUnitKey === "todointheworld") {
        addAmounts(todointheworld, amounts);
      } else if (businessUnitKey === "fmdq") {
        addAmounts(fmdq, amounts);
      }
    }

    return {
      label: getShortMonthName(i),
      index: i + 1,
      total: total.entrate,
      todointheworld: todointheworld.entrate,
      fmdq: fmdq.entrate,
    };
  });

  const maxAbsChartValue = Math.max(
    ...chartData.flatMap((d) => [
      Math.abs(d.total),
      Math.abs(d.todointheworld),
      Math.abs(d.fmdq),
    ]),
    1
  );

  const selectedMonthChartData = chartData[selectedMonth - 1];

  return (
    <AppShell
      title="Dashboard"
      subtitle="Panoramica economica e operativa del gestionale"
    >
      <div className="grid items-start gap-4 lg:grid-cols-[1fr_360px] lg:gap-6">
        <div className="space-y-4 sm:space-y-6">
          <div className="mx-auto flex w-full max-w-md items-center justify-between rounded-2xl border border-zinc-200 bg-white p-2 shadow-sm">
            <Link
              href={`/?m=${prevMonth}&y=${prevYear}`}
              className="flex h-11 w-11 items-center justify-center rounded-xl transition hover:bg-zinc-100"
              aria-label="Mese precedente"
            >
              ←
            </Link>

            <div className="min-w-0 flex-1 px-2 text-center">
              <h2 className="truncate text-lg font-bold capitalize text-zinc-900">
                {nomeMese} {selectedYear}
              </h2>
              <p className="text-[11px] text-zinc-500 sm:text-xs">
                01/{String(selectedMonth).padStart(2, "0")}/{selectedYear} a{" "}
                {lastDayOfMonth}/{String(selectedMonth).padStart(2, "0")}/
                {selectedYear}
              </p>
            </div>

            <Link
              href={`/?m=${nextMonth}&y=${nextYear}`}
              className="flex h-11 w-11 items-center justify-center rounded-xl transition hover:bg-zinc-100"
              aria-label="Mese successivo"
            >
              →
            </Link>
          </div>

          <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-md">
            <div className="bg-blue-600 px-4 py-3 text-center text-sm font-semibold text-white sm:text-base">
              Bilancio mensile
            </div>

            <div className="space-y-4 p-4 sm:p-6">
              <div className="flex items-center justify-between border-b border-zinc-100 pb-4">
                <span className="text-xl font-bold text-zinc-900 sm:text-2xl">
                  Totale
                </span>
                <span
                  className={`text-xl font-bold sm:text-2xl ${
                    meseTotale >= 0 ? "text-green-600" : "text-red-600"
                  }`}
                >
                  {formatEuro(meseTotale)}
                </span>
              </div>

              <div className="flex items-center justify-between gap-3">
                <span className="text-base font-medium text-zinc-800 sm:text-lg">
                  Entrate
                </span>
                <span className="text-lg font-medium text-green-600 sm:text-xl">
                  {formatEuro(meseEntrate)}
                </span>
              </div>

              <div className="flex items-center justify-between gap-3">
                <span className="text-base font-medium text-zinc-800 sm:text-lg">
                  Spese
                </span>
                <span className="text-lg font-medium text-red-600 sm:text-xl">
                  -{formatEuro(meseSpese)}
                </span>
              </div>

              <div className="grid gap-3 border-t border-dashed border-zinc-200 pt-4 sm:grid-cols-2">
                <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-3">
                  <div className="text-[11px] font-bold uppercase tracking-wide text-emerald-800">
                    Todointheworld
                  </div>
                  <div
                    className={`mt-1 text-lg font-black ${
                      meseTodointheworld.totale >= 0
                        ? "text-emerald-700"
                        : "text-red-600"
                    }`}
                  >
                    {formatEuro(meseTodointheworld.totale)}
                  </div>
                  <div className="mt-1 text-[11px] text-emerald-900/80">
                    Entrate {formatEuro(meseTodointheworld.entrate)} · Spese {formatEuro(meseTodointheworld.spese)}
                  </div>
                </div>

                <div className="rounded-2xl border border-amber-100 bg-amber-50 p-3">
                  <div className="text-[11px] font-bold uppercase tracking-wide text-amber-800">
                    FMDQ
                  </div>
                  <div
                    className={`mt-1 text-lg font-black ${
                      meseFmdq.totale >= 0 ? "text-amber-700" : "text-red-600"
                    }`}
                  >
                    {formatEuro(meseFmdq.totale)}
                  </div>
                  <div className="mt-1 text-[11px] text-amber-900/80">
                    Entrate {formatEuro(meseFmdq.entrate)} · Spese {formatEuro(meseFmdq.spese)}
                  </div>
                </div>
              </div>

              {meseAltro.prenotazioni > 0 ? (
                <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-800">
                  Attenzione: {meseAltro.prenotazioni} prenotazioni del mese non hanno una contabilità riconosciuta. Sono comprese nel Totale, ma non in Todointheworld/FMDQ.
                </div>
              ) : null}

              <div className="mt-4 border-t border-dashed border-zinc-200 pt-5">
                <div className="mb-3 flex flex-wrap items-center gap-3 text-[11px] font-semibold text-zinc-600">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded-sm bg-blue-600" />
                    Totale
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded-sm bg-emerald-500" />
                    Todointheworld
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded-sm bg-amber-500" />
                    FMDQ
                  </span>
                </div>

                <div className="flex h-28 items-stretch justify-between gap-1 sm:h-32">
                  {chartData.map((d, idx) => {
                    const isCurrentMonth = d.index === selectedMonth;
                    const bars = [
                      {
                        key: "total",
                        label: "Totale",
                        value: d.total,
                        className: "bg-blue-600",
                      },
                      {
                        key: "todointheworld",
                        label: "Todointheworld",
                        value: d.todointheworld,
                        className: "bg-emerald-500",
                      },
                      {
                        key: "fmdq",
                        label: "FMDQ",
                        value: d.fmdq,
                        className: "bg-amber-500",
                      },
                    ];

                    return (
                      <div
                        key={idx}
                        className="flex flex-1 flex-col justify-center"
                        title={`${d.label} · Totale ${formatEuro(d.total)} · Todointheworld ${formatEuro(d.todointheworld)} · FMDQ ${formatEuro(d.fmdq)}`}
                      >
                        <div className="flex flex-1 items-end gap-0.5">
                          {bars.map((bar) => {
                            const heightPct =
                              (Math.abs(bar.value) / maxAbsChartValue) * 100;

                            return bar.value > 0 ? (
                              <div
                                key={bar.key}
                                aria-label={`${bar.label} ${d.label}: ${formatEuro(bar.value)}`}
                                className={`w-full rounded-t-sm transition-all ${bar.className}`}
                                style={{ height: `${heightPct}%` }}
                              />
                            ) : (
                              <div key={bar.key} className="w-full" />
                            );
                          })}
                        </div>

                        <div className="my-0.5 h-px w-full bg-zinc-300" />

                        <div className="flex h-6 items-start gap-0.5">
                          {bars.map((bar) => {
                            const heightPct =
                              (Math.abs(bar.value) / maxAbsChartValue) * 100;

                            return bar.value < 0 ? (
                              <div
                                key={bar.key}
                                aria-label={`${bar.label} ${d.label}: ${formatEuro(bar.value)}`}
                                className={`w-full rounded-b-sm transition-all ${bar.className}`}
                                style={{ height: `${Math.min(heightPct, 100)}%` }}
                              />
                            ) : (
                              <div key={bar.key} className="w-full" />
                            );
                          })}
                        </div>

                        <div
                          className={`mt-1 text-center text-[9px] uppercase ${
                            isCurrentMonth
                              ? "font-bold text-blue-600"
                              : "text-zinc-500"
                          }`}
                        >
                          {d.label}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-3 rounded-xl bg-zinc-50 px-3 py-2 text-[11px] text-zinc-500">
                  Mese selezionato: {" "}
                  <span className="font-bold text-zinc-800">
                    Totale {formatEuro(selectedMonthChartData?.total || 0)}
                  </span>
                  {" · "}
                  <span className="font-bold text-emerald-700">
                    Todointheworld {formatEuro(selectedMonthChartData?.todointheworld || 0)}
                  </span>
                  {" · "}
                  <span className="font-bold text-amber-700">
                    FMDQ {formatEuro(selectedMonthChartData?.fmdq || 0)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-md">
            <div className="bg-zinc-800 px-4 py-3 text-center text-sm font-semibold text-white sm:text-base">
              Presenze 2025 vs 2026
            </div>

            <div className="space-y-5 p-4 sm:p-6">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-slate-100 p-4">
                  <div className="text-[11px] font-bold uppercase tracking-wide text-slate-700">
                    {nomeMese} 2025 · mese intero
                  </div>
                  <div className="mt-1 text-3xl font-black text-slate-900">
                    {selectedPresence2025}
                  </div>
                  <div className="mt-1 text-xs text-slate-700">
                    {selectedBookings2025} prenotazioni
                  </div>
                </div>

                <div className="rounded-2xl border border-orange-200 bg-orange-50 p-4">
                  <div className="text-[11px] font-bold uppercase tracking-wide text-orange-800">
                    {nomeMese} 2026 · mese intero
                  </div>
                  <div className="mt-1 text-3xl font-black text-orange-700">
                    {selectedPresence2026}
                  </div>
                  <div className="mt-1 text-xs text-orange-900/80">
                    {selectedBookings2026} prenotazioni
                  </div>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div
                  className={`rounded-2xl border p-4 ${
                    selectedPresenceDifference >= 0
                      ? "border-emerald-100 bg-emerald-50"
                      : "border-red-100 bg-red-50"
                  }`}
                >
                  <div className="text-[11px] font-bold uppercase tracking-wide text-zinc-600">
                    Differenza presenze
                  </div>
                  <div
                    className={`mt-1 text-2xl font-black ${
                      selectedPresenceDifference >= 0
                        ? "text-emerald-700"
                        : "text-red-700"
                    }`}
                  >
                    {selectedPresenceDifference >= 0 ? "+" : ""}
                    {selectedPresenceDifference}
                  </div>
                  <div className="mt-1 text-xs font-semibold text-zinc-600">
                    {formatPercent(selectedPresencePercent)}
                  </div>
                </div>

                <div
                  className={`rounded-2xl border p-4 ${
                    selectedBookingsDifference >= 0
                      ? "border-emerald-100 bg-emerald-50"
                      : "border-red-100 bg-red-50"
                  }`}
                >
                  <div className="text-[11px] font-bold uppercase tracking-wide text-zinc-600">
                    Differenza prenotazioni
                  </div>
                  <div
                    className={`mt-1 text-2xl font-black ${
                      selectedBookingsDifference >= 0
                        ? "text-emerald-700"
                        : "text-red-700"
                    }`}
                  >
                    {selectedBookingsDifference >= 0 ? "+" : ""}
                    {selectedBookingsDifference}
                  </div>
                  <div className="mt-1 text-xs font-semibold text-zinc-600">
                    {formatPercent(selectedBookingsPercent)}
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-black text-zinc-900">
                      Mese alla data di visualizzazione
                    </div>
                    <div className="mt-1 text-xs text-zinc-500">
                      Dal 1° al {comparisonCutoffDay} {nomeMese}, confronto allo stesso giorno
                    </div>
                  </div>

                  <div className="rounded-full bg-white px-3 py-1 text-[11px] font-bold text-zinc-700 ring-1 ring-zinc-200">
                    fino al {String(comparisonCutoffDay).padStart(2, "0")}/
                    {String(selectedMonth).padStart(2, "0")}
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-slate-600">
                      2025 alla stessa data
                    </div>
                    <div className="mt-1 text-xl font-black text-slate-900">
                      {monthToDatePresence2025} presenze
                    </div>
                    <div className="mt-1 text-xs text-slate-600">
                      {monthToDateBookings2025} prenotazioni
                    </div>
                  </div>

                  <div className="rounded-xl border border-orange-200 bg-white p-3">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-orange-700">
                      2026 alla stessa data
                    </div>
                    <div className="mt-1 text-xl font-black text-orange-700">
                      {monthToDatePresence2026} presenze
                    </div>
                    <div className="mt-1 text-xs text-orange-700">
                      {monthToDateBookings2026} prenotazioni
                    </div>
                  </div>
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div
                    className={`rounded-xl px-3 py-3 ${
                      monthToDatePresenceDifference >= 0
                        ? "bg-emerald-50 text-emerald-800"
                        : "bg-red-50 text-red-800"
                    }`}
                  >
                    <div className="text-[10px] font-bold uppercase tracking-wide">
                      Differenza presenze
                    </div>
                    <div className="mt-1 text-lg font-black">
                      {monthToDatePresenceDifference >= 0 ? "+" : ""}
                      {monthToDatePresenceDifference} ·{" "}
                      {formatPercent(monthToDatePresencePercent)}
                    </div>
                  </div>

                  <div
                    className={`rounded-xl px-3 py-3 ${
                      monthToDateBookingsDifference >= 0
                        ? "bg-emerald-50 text-emerald-800"
                        : "bg-red-50 text-red-800"
                    }`}
                  >
                    <div className="text-[10px] font-bold uppercase tracking-wide">
                      Differenza prenotazioni
                    </div>
                    <div className="mt-1 text-lg font-black">
                      {monthToDateBookingsDifference >= 0 ? "+" : ""}
                      {monthToDateBookingsDifference} ·{" "}
                      {formatPercent(monthToDateBookingsPercent)}
                    </div>
                  </div>
                </div>
              </div>

              <div className="border-t border-dashed border-zinc-200 pt-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-black text-zinc-900">
                      Grafico annuale delle presenze
                    </div>
                    <div className="mt-1 text-xs text-zinc-500">
                      Confronto mensile tra storico 2025 e prenotazioni 2026
                    </div>
                  </div>

                  <div className="flex items-center gap-3 text-[11px] font-semibold text-zinc-600">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-3 w-3 rounded-sm bg-slate-500" />
                      2025
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-3 w-3 rounded-sm bg-orange-500" />
                      2026
                    </span>
                  </div>
                </div>

                <div className="flex h-56 items-end justify-between gap-1 border-b border-zinc-200 px-1 sm:h-64 sm:gap-2">
                  {comparisonChartData.map((row) => {
                    const height2025 =
                      (row.presence2025 / comparisonMaxPresence) * 100;
                    const height2026 =
                      (row.presence2026 / comparisonMaxPresence) * 100;
                    const isSelected = row.month === selectedMonth;

                    return (
                      <div
                        key={row.month}
                        className="flex h-full min-w-0 flex-1 flex-col justify-end"
                        title={`${row.label} · 2025: ${row.presence2025} presenze · 2026: ${row.presence2026} presenze`}
                      >
                        <div className="flex flex-1 items-end justify-center gap-0.5 sm:gap-1">
                          <div
                            className="w-1/2 rounded-t bg-slate-500 transition-all"
                            style={{
                              height: `${height2025}%`,
                              minHeight: row.presence2025 > 0 ? "3px" : "0",
                            }}
                          />
                          <div
                            className="w-1/2 rounded-t bg-orange-500 transition-all"
                            style={{
                              height: `${height2026}%`,
                              minHeight: row.presence2026 > 0 ? "3px" : "0",
                            }}
                          />
                        </div>

                        <div
                          className={`mt-2 truncate text-center text-[9px] uppercase sm:text-[10px] ${
                            isSelected
                              ? "font-black text-orange-700"
                              : "text-zinc-500"
                          }`}
                        >
                          {row.label}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl bg-slate-100 px-3 py-3 text-sm text-slate-900">
                    Totale 2025:{" "}
                    <span className="font-black">{annualPresence2025}</span>{" "}
                    presenze
                  </div>

                  <div className="rounded-xl bg-orange-50 px-3 py-3 text-sm text-orange-900">
                    Totale 2026:{" "}
                    <span className="font-black">{annualPresence2026}</span>{" "}
                    presenze
                  </div>
                </div>

                {historicalBookingsError ? (
                  <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-800">
                    Lo storico 2025 non è stato caricato:{" "}
                    {historicalBookingsError.message}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4 sm:space-y-6">
          <SectionCard title="📥 Nuove da Google Calendar">
            <div className="space-y-3">
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-black text-amber-900">
                      {googleCalendarImports.length} da controllare
                    </div>
                    <div className="mt-1 text-xs text-amber-800">
                      {urgentGoogleCalendarImports.length > 0
                        ? `${urgentGoogleCalendarImports.length} richiedono attenzione`
                        : "Solo nuove righe arrivate da Make"}
                    </div>
                  </div>

                  <Link
                    href="/import/google-calendar"
                    className="shrink-0 rounded-xl bg-amber-600 px-3 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-amber-700"
                  >
                    Apri
                  </Link>
                </div>
              </div>

              {googleCalendarImports.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 p-5 text-center text-sm text-zinc-500">
                  Nessuna nuova prenotazione Google Calendar arrivata da Make.
                </div>
              ) : (
                <div className="space-y-2">
                  {googleCalendarImports.slice(0, 8).map((row) => {
                    const title = row.notes || row.original_title || "Senza titolo";
                    const importDateHref = row.booking_date
                      ? `/import/google-calendar?date=${row.booking_date}`
                      : "/import/google-calendar";

                    return (
                      <div
                        key={row.id}
                        className={`rounded-2xl border p-3 ${
                          row.import_status === "needs_review" ||
                          row.import_status === "possible_duplicate" ||
                          row.import_status === "gcal_cancelled"
                            ? "border-red-200 bg-red-50"
                            : "border-zinc-200 bg-white"
                        }`}
                      >
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <span
                            className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${googleImportStatusClass(
                              row.import_status
                            )}`}
                          >
                            {googleImportStatusLabel(row.import_status)}
                          </span>
                        </div>

                        <div className="text-sm font-bold text-zinc-900">
                          {title}
                        </div>

                        <div className="mt-2 rounded-xl bg-white/70 p-2 text-xs text-zinc-700 ring-1 ring-zinc-100">
                          <div>
                            <span className="font-bold text-zinc-900">
                              Evento GCal:
                            </span>{" "}
                            {formatDateTimeRome(row.gcal_updated_at)}
                          </div>

                          <div className="mt-1">
                            <span className="font-bold text-zinc-900">
                              Esperienza:
                            </span>{" "}
                            {formatExperienceDateTime(row)}
                          </div>
                        </div>

                        <div className="mt-2 text-xs text-zinc-500">
                          {googleImportPeopleLabel(row)}
                          {row.booking_source ? ` · ${row.booking_source}` : ""}
                          {row.customer_name ? ` · ${row.customer_name}` : ""}
                        </div>

                        {row.import_status === "gcal_cancelled" ? (
                          <div className="mt-2 rounded-xl bg-red-100 p-2 text-xs font-bold text-red-900">
                            Evento cancellato da Google Calendar. Controlla la
                            prenotazione collegata prima di eliminarla o
                            modificarla.
                          </div>
                        ) : null}

                        <div className="mt-3 flex flex-wrap gap-2">
                          <Link
                            href={importDateHref}
                            className="inline-flex rounded-xl border border-zinc-300 bg-white px-3 py-2 text-xs font-bold text-zinc-800 shadow-sm transition hover:bg-zinc-100"
                          >
                            Apri import del giorno
                          </Link>

                          {row.gcal_html_link ? (
                            <a
                              href={row.gcal_html_link}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-blue-100"
                            >
                              Apri evento GCal
                            </a>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}

                  {googleCalendarImports.length > 8 ? (
                    <Link
                      href="/import/google-calendar"
                      className="block rounded-2xl border border-zinc-200 bg-zinc-50 p-3 text-center text-xs font-bold text-zinc-700 transition hover:bg-zinc-100"
                    >
                      Vedi tutte le altre {googleCalendarImports.length - 8}
                    </Link>
                  ) : null}
                </div>
              )}
            </div>
          </SectionCard>

          <NotificationCenter />

          <SectionCard title="Agenda (Prossimi 10 giorni)">
            <>
              <div className="space-y-3 md:hidden">
                {prossimePrenotazioni.map((booking) => {
                  const isToday = booking.booking_date === todayStr;

                  return (
                    <div
                      key={booking.id}
                      className="rounded-2xl border border-zinc-100 bg-zinc-50/70 p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div
                            className={`text-xs font-black uppercase tracking-wide ${
                              isToday ? "text-slate-900" : "text-zinc-900"
                            }`}
                          >
                            {isToday ? "OGGI" : formatDate(booking.booking_date)}
                          </div>
                          <div className="mt-0.5 text-xs text-zinc-500">
                            {booking.booking_time
                              ? booking.booking_time.slice(0, 5)
                              : "-"}
                          </div>
                        </div>

                        <Link
                          href={`/prenotazioni/${booking.id}/modifica`}
                          className={`rounded-lg px-2.5 py-1 text-[10px] font-bold uppercase ${
                            booking.customer_payment_status === "paid"
                              ? "bg-green-100 text-green-700"
                              : "bg-red-100 text-red-700"
                          }`}
                        >
                          {booking.customer_payment_status === "paid"
                            ? "Pagato"
                            : "Incassa"}
                        </Link>
                      </div>

                      <div className="mt-3 space-y-1">
                        <Link
                          href={`/prenotazioni?highlight=${booking.id}`}
                          className="block text-sm font-bold text-zinc-900"
                        >
                          {booking.customer_name || "Cliente senza nome"}
                        </Link>

                        <div className="text-xs text-zinc-500">
                          {booking.experience_name || "Esperienza"}
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <span className="rounded-lg bg-white px-2 py-1 text-[11px] font-semibold text-zinc-700 ring-1 ring-zinc-200">
                          {booking.total_people || 0} pax
                        </span>

                        {booking.booking_source ? (
                          <span className="rounded-lg border border-slate-200 bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase tracking-tight text-slate-900">
                            {booking.booking_source}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  );
                })}

                {prossimePrenotazioni.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 p-5 text-center text-sm text-zinc-500">
                    Nessun arrivo in programma nei prossimi 10 giorni.
                  </div>
                )}
              </div>

              <div className="hidden overflow-hidden md:block">
                <table className="w-full table-fixed text-left text-sm">
                  <colgroup>
                    <col className="w-[50px]" />
                    <col className="w-[30px]" />
                    <col className="w-auto" />
                    <col className="w-[60px]" />
                  </colgroup>
                  <thead className="border-b border-zinc-200 text-[10px] font-bold uppercase text-zinc-500">
                    <tr>
                      <th className="py-2">Data</th>
                      <th className="py-2 text-center">Pax</th>
                      <th className="py-2">Cliente</th>
                      <th className="py-2 text-right">Stato</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {prossimePrenotazioni.map((booking) => {
                      const isToday = booking.booking_date === todayStr;

                      return (
                        <tr
                          key={booking.id}
                          className="group transition-colors hover:bg-zinc-50"
                        >
                          <td className="py-3 pr-1 align-top">
                            <div
                              className={`text-xs font-bold ${
                                isToday ? "text-slate-900" : "text-zinc-900"
                              }`}
                            >
                              {isToday
                                ? "OGGI"
                                : formatDate(booking.booking_date)}
                            </div>
                            <div className="mt-0.5 text-[10px] text-zinc-500">
                              {booking.booking_time
                                ? booking.booking_time.slice(0, 5)
                                : "-"}
                            </div>
                          </td>

                          <td className="py-3 pr-1 text-center align-top">
                            <div className="text-xs font-bold text-zinc-700">
                              {booking.total_people}
                            </div>
                          </td>

                          <td className="py-3 pr-2 align-top">
                            <div className="flex min-w-0 flex-col">
                              <Link
                                href={`/prenotazioni?highlight=${booking.id}`}
                                className="truncate text-[13px] font-bold text-zinc-900 hover:underline"
                              >
                                {booking.customer_name}
                              </Link>

                              <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1">
                                <span className="max-w-full truncate text-[11px] text-zinc-500">
                                  {booking.experience_name}
                                </span>

                                {booking.booking_source && (
                                  <span className="inline-block shrink-0 rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-tight text-slate-900">
                                    {booking.booking_source}
                                  </span>
                                )}
                              </div>
                            </div>
                          </td>

                          <td className="py-3 text-right align-top">
                            <Link
                              href={`/prenotazioni/${booking.id}/modifica`}
                              className={`inline-block rounded-lg px-2 py-1 text-[9px] font-bold uppercase transition hover:scale-105 ${
                                booking.customer_payment_status === "paid"
                                  ? "bg-green-100 text-green-700"
                                  : "bg-red-100 text-red-700"
                              }`}
                            >
                              {booking.customer_payment_status === "paid"
                                ? "Pagato"
                                : "Incassa"}
                            </Link>
                          </td>
                        </tr>
                      );
                    })}

                    {prossimePrenotazioni.length === 0 && (
                      <tr>
                        <td
                          colSpan={4}
                          className="py-6 text-center text-xs text-zinc-500"
                        >
                          Nessun arrivo in programma nei prossimi 10 giorni.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          </SectionCard>

          <SectionCard title="Prenotazioni per canale (Storico)">
            <div className="space-y-4 pt-1">
              {bookingsByChannel.map((item) => (
                <div key={item.channel} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate font-medium text-zinc-800">
                      {item.channel}
                    </span>
                    <span className="shrink-0 font-bold text-zinc-900">
                      {item.count}
                    </span>
                  </div>
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-zinc-100">
                    <div
                      className="h-full rounded-full bg-zinc-800"
                      style={{
                        width: `${(item.count / maxChannelCount) * 100}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Esperienze più vendute (Pax Totali)">
            <div className="space-y-4 pt-1">
              {bookingsByExperience.map((item) => (
                <div key={item.name} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate pr-2 font-medium text-zinc-800">
                      {item.name}
                    </span>
                    <span className="shrink-0 font-bold text-zinc-900">
                      {item.count} Pax
                    </span>
                  </div>
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-zinc-100">
                    <div
                      className="h-full rounded-full bg-emerald-600"
                      style={{ width: `${(item.count / maxExpPax) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>
      </div>
    </AppShell>
  );
}