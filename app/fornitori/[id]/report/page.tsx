export const dynamic = "force-dynamic";

import Link from "next/link";
import AppShell from "@/components/AppShell";
import SectionCard from "@/components/SectionCard";
import { supabaseServer } from "@/lib/supabase-server";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    from?: string;
    to?: string;
    month?: string;
  }>;
};

type BookingRow = {
  id: number;
  booking_date: string | null;
  total_people: number | null;
  adults: number | null;
  children: number | null;
  infants: number | null;
  non_paying_adults: number | null;
  is_cancelled: boolean | null;
};

type EconomicBookingRow = BookingRow & {
  booking_time: string | null;
  customer_name: string | null;
  experience_name: string | null;
  booking_reference: string | null;
  booking_source: string | null;
  total_to_you: number | null;
  total_customer: number | null;
  total_supplier_cost: number | null;
  supplier_amount_paid: number | null;
  customer_payment_status: string | null;
  supplier_payment_status: string | null;
};

function toYmd(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isValidYmd(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isValidYearMonth(value: string) {
  return /^\d{4}-\d{2}$/.test(value);
}

function formatDateIt(value: string) {
  const parts = value.split("-").map(Number);
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];

  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(y, (m || 1) - 1, d || 1));
}

function formatYearMonthIt(value: string) {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));

  return new Intl.DateTimeFormat("it-IT", {
    month: "long",
    year: "numeric",
  }).format(new Date(year, month - 1, 1));
}

function formatTime(value: string | null) {
  if (!value) return "-";
  return value.slice(0, 5);
}

function moneyValue(value: number | string | null | undefined) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCurrency(value: number | string | null | undefined) {
  return new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR",
  }).format(moneyValue(value));
}

function formatCurrencyCompact(value: number | string | null | undefined) {
  const amount = moneyValue(value);

  if (amount >= 1000) {
    return `€${Math.round(amount).toLocaleString("it-IT")}`;
  }

  return `€${Math.round(amount)}`;
}

function getPeopleCount(booking: BookingRow) {
  const totalPeople = Number(booking.total_people || 0);
  if (totalPeople > 0) return totalPeople;

  return (
    Number(booking.adults || 0) +
    Number(booking.children || 0) +
    Number(booking.infants || 0) +
    Number(booking.non_paying_adults || 0)
  );
}

function getPeopleBreakdown(booking: BookingRow) {
  const adults = Number(booking.adults || 0);
  const children = Number(booking.children || 0);
  const infants = Number(booking.infants || 0);
  const nonPayingAdults = Number(booking.non_paying_adults || 0);

  const base = `${adults}+${children}+${infants}`;

  if (nonPayingAdults > 0) {
    return `${base}+${nonPayingAdults} NP`;
  }

  return base;
}

function getPayingPeopleCount(booking: BookingRow) {
  return Number(booking.adults || 0) + Number(booking.children || 0);
}

function getMonthLabel(index: number) {
  return [
    "Gen",
    "Feb",
    "Mar",
    "Apr",
    "Mag",
    "Giu",
    "Lug",
    "Ago",
    "Set",
    "Ott",
    "Nov",
    "Dic",
  ][index];
}

function getRangeMonths(from: string, to: string) {
  const fromYear = Number(from.slice(0, 4));
  const fromMonth = Number(from.slice(5, 7));
  const toYear = Number(to.slice(0, 4));
  const toMonth = Number(to.slice(5, 7));

  const months: number[] = [];

  if (fromYear !== toYear) {
    for (let i = 0; i < 12; i++) months.push(i);
    return months;
  }

  for (let m = fromMonth; m <= toMonth; m++) {
    months.push(m - 1);
  }

  return months;
}

function getDaysInYearMonth(yearMonth: string) {
  const year = Number(yearMonth.slice(0, 4));
  const month = Number(yearMonth.slice(5, 7));

  return new Date(year, month, 0).getDate();
}

function getMonthDates(yearMonth: string) {
  const days = getDaysInYearMonth(yearMonth);

  return Array.from({ length: days }, (_, index) => {
    const day = String(index + 1).padStart(2, "0");
    return `${yearMonth}-${day}`;
  });
}

function addMonthsToYearMonth(yearMonth: string, delta: number) {
  const year = Number(yearMonth.slice(0, 4));
  const monthIndex = Number(yearMonth.slice(5, 7)) - 1;
  const date = new Date(year, monthIndex + delta, 1);

  const newYear = date.getFullYear();
  const newMonth = String(date.getMonth() + 1).padStart(2, "0");

  return `${newYear}-${newMonth}`;
}

function niceCeil(value: number) {
  if (value <= 0) return 10;
  if (value <= 10) return 10;
  if (value <= 20) return 20;
  if (value <= 50) return 50;
  if (value <= 100) return 100;
  if (value <= 500) return Math.ceil(value / 50) * 50;
  return Math.ceil(value / 100) * 100;
}

function getStatusLabel(value: string | null) {
  if (!value) return "-";

  const normalized = value.toLowerCase();

  if (normalized === "paid") return "Pagato";
  if (normalized === "partial") return "Parziale";
  if (normalized === "pending") return "Da pagare";
  if (normalized === "cancelled") return "Cancellato";

  return value;
}

function getStatusClass(value: string | null) {
  const normalized = String(value || "").toLowerCase();

  if (normalized === "paid") {
    return "border border-emerald-200 bg-emerald-50 text-emerald-700";
  }

  if (normalized === "partial") {
    return "border border-amber-200 bg-amber-50 text-amber-700";
  }

  if (normalized === "pending") {
    return "border border-rose-200 bg-rose-50 text-rose-700";
  }

  return "border border-zinc-200 bg-zinc-50 text-zinc-600";
}

function ChartCard({
  title,
  labels,
  currentValues,
  previousValues,
}: {
  title: string;
  labels: string[];
  currentValues: number[];
  previousValues: number[];
}) {
  const width = 920;
  const height = 360;

  const padTop = 24;
  const padRight = 24;
  const padBottom = 56;
  const padLeft = 52;

  const chartWidth = width - padLeft - padRight;
  const chartHeight = height - padTop - padBottom;

  const combined = [...currentValues, ...previousValues];
  const rawMax = Math.max(...combined, 0);
  const yMax = niceCeil(rawMax);

  const gridSteps = 4;
  const gridValues: number[] = [];
  for (let i = 0; i <= gridSteps; i++) {
    gridValues.push(Math.round((yMax / gridSteps) * i));
  }

  const groupCount = Math.max(labels.length, 1);
  const groupWidth = chartWidth / groupCount;
  const barGap = 8;
  const innerGroupWidth = Math.min(64, groupWidth - 12);
  const barWidth = Math.max(10, (innerGroupWidth - barGap) / 2);

  const currentColor = "#2563eb";
  const previousColor = "#f59e0b";

  return (
    <SectionCard title={title}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <div className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-blue-700">
            <span
              className="h-3 w-3 rounded-sm"
              style={{ backgroundColor: currentColor }}
            />
            Anno selezionato
          </div>

          <div className="inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-700">
            <span
              className="h-3 w-3 rounded-sm"
              style={{ backgroundColor: previousColor }}
            />
            Anno precedente
          </div>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white p-3">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="h-[360px] min-w-[780px] w-full"
            role="img"
            aria-label={title}
          >
            {gridValues.map((value, idx) => {
              const ratio = yMax === 0 ? 0 : value / yMax;
              const y = padTop + chartHeight - ratio * chartHeight;

              return (
                <g key={`grid-${idx}`}>
                  <line
                    x1={padLeft}
                    y1={y}
                    x2={width - padRight}
                    y2={y}
                    stroke="#e4e4e7"
                    strokeWidth="1"
                  />
                  <text x={10} y={y + 4} fontSize="11" fill="#71717a">
                    {value}
                  </text>
                </g>
              );
            })}

            <line
              x1={padLeft}
              y1={padTop + chartHeight}
              x2={width - padRight}
              y2={padTop + chartHeight}
              stroke="#a1a1aa"
              strokeWidth="1.2"
            />

            {labels.map((label, index) => {
              const groupX = padLeft + index * groupWidth;
              const centerX = groupX + groupWidth / 2;

              const currentValue = currentValues[index] || 0;
              const previousValue = previousValues[index] || 0;

              const currentBarHeight =
                yMax === 0 ? 0 : (currentValue / yMax) * chartHeight;
              const previousBarHeight =
                yMax === 0 ? 0 : (previousValue / yMax) * chartHeight;

              const barsTotalWidth = barWidth * 2 + barGap;
              const startX = centerX - barsTotalWidth / 2;

              const previousX = startX;
              const currentX = startX + barWidth + barGap;

              const previousY = padTop + chartHeight - previousBarHeight;
              const currentY = padTop + chartHeight - currentBarHeight;

              return (
                <g key={`group-${label}`}>
                  <rect
                    x={previousX}
                    y={previousY}
                    width={barWidth}
                    height={previousBarHeight}
                    rx="4"
                    fill={previousColor}
                    opacity="0.85"
                  />

                  <rect
                    x={currentX}
                    y={currentY}
                    width={barWidth}
                    height={currentBarHeight}
                    rx="4"
                    fill={currentColor}
                    opacity="0.95"
                  />

                  {previousValue > 0 && (
                    <text
                      x={previousX + barWidth / 2}
                      y={previousY - 6}
                      textAnchor="middle"
                      fontSize="11"
                      fill="#92400e"
                      fontWeight="700"
                    >
                      {previousValue}
                    </text>
                  )}

                  {currentValue > 0 && (
                    <text
                      x={currentX + barWidth / 2}
                      y={currentY - 6}
                      textAnchor="middle"
                      fontSize="11"
                      fill="#1d4ed8"
                      fontWeight="700"
                    >
                      {currentValue}
                    </text>
                  )}

                  <text
                    x={centerX}
                    y={height - 16}
                    textAnchor="middle"
                    fontSize="11"
                    fill="#71717a"
                  >
                    {label}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-zinc-200 text-[11px] font-bold uppercase text-zinc-500">
              <tr>
                <th className="py-2 pr-4">Mese</th>
                <th className="py-2 pr-4 text-blue-700">Anno selezionato</th>
                <th className="py-2 pr-4 text-amber-700">Anno precedente</th>
              </tr>
            </thead>
            <tbody>
              {labels.map((label, index) => (
                <tr key={label} className="border-b border-zinc-100">
                  <td className="py-2 pr-4 font-medium text-zinc-900">
                    {label}
                  </td>
                  <td className="py-2 pr-4 font-semibold text-blue-700">
                    {currentValues[index]}
                  </td>
                  <td className="py-2 pr-4 font-semibold text-amber-700">
                    {previousValues[index]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </SectionCard>
  );
}

function IncomeDailyChartCard({
  title,
  dates,
  values,
  todayYmd,
}: {
  title: string;
  dates: string[];
  values: number[];
  todayYmd: string;
}) {
  const width = 1600;
  const height = 380;

  const padTop = 34;
  const padRight = 24;
  const padBottom = 58;
  const padLeft = 74;

  const chartWidth = width - padLeft - padRight;
  const chartHeight = height - padTop - padBottom;

  const rawMax = Math.max(...values, 0);
  const yMax = niceCeil(rawMax);

  const gridSteps = 4;
  const gridValues: number[] = [];
  for (let i = 0; i <= gridSteps; i++) {
    gridValues.push(Math.round((yMax / gridSteps) * i));
  }

  const groupCount = Math.max(dates.length, 1);
  const groupWidth = chartWidth / groupCount;
  const barWidth = Math.max(12, Math.min(24, groupWidth - 8));

  return (
    <SectionCard title={title}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <div className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-700">
            <span className="h-3 w-3 rounded-sm bg-emerald-600" />
            Giorni passati / oggi
          </div>

          <div className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-zinc-500">
            <span className="h-3 w-3 rounded-sm bg-zinc-300" />
            Giorni futuri
          </div>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white p-3">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="h-[380px] min-w-[1200px] w-full"
            role="img"
            aria-label={title}
          >
            {gridValues.map((value, idx) => {
              const ratio = yMax === 0 ? 0 : value / yMax;
              const y = padTop + chartHeight - ratio * chartHeight;

              return (
                <g key={`income-grid-${idx}`}>
                  <line
                    x1={padLeft}
                    y1={y}
                    x2={width - padRight}
                    y2={y}
                    stroke="#e4e4e7"
                    strokeWidth="1"
                  />
                  <text x={8} y={y + 4} fontSize="11" fill="#71717a">
                    {formatCurrencyCompact(value)}
                  </text>
                </g>
              );
            })}

            <line
              x1={padLeft}
              y1={padTop + chartHeight}
              x2={width - padRight}
              y2={padTop + chartHeight}
              stroke="#a1a1aa"
              strokeWidth="1.2"
            />

            {dates.map((date, index) => {
              const value = values[index] || 0;
              const isFutureDay = date > todayYmd;

              const barHeight = yMax === 0 ? 0 : (value / yMax) * chartHeight;

              const groupX = padLeft + index * groupWidth;
              const centerX = groupX + groupWidth / 2;
              const x = centerX - barWidth / 2;
              const y = padTop + chartHeight - barHeight;
              const dayLabel = String(Number(date.slice(8, 10)));

              const barFill =
                value > 0
                  ? isFutureDay
                    ? "#86efac"
                    : "#16a34a"
                  : isFutureDay
                    ? "#f4f4f5"
                    : "#e4e4e7";

              const barOpacity = isFutureDay ? "0.55" : value > 0 ? "0.95" : "1";
              const valueLabelColor = isFutureDay ? "#71717a" : "#166534";
              const dayLabelColor = isFutureDay ? "#a1a1aa" : "#71717a";

              return (
                <g key={`income-day-${date}`}>
                  <rect
                    x={x}
                    y={value > 0 ? y : padTop + chartHeight - 1}
                    width={barWidth}
                    height={value > 0 ? barHeight : 1}
                    rx="5"
                    fill={barFill}
                    opacity={barOpacity}
                  />

                  {value > 0 && (
                    <text
                      x={centerX}
                      y={y - 7}
                      textAnchor="middle"
                      fontSize="10"
                      fill={valueLabelColor}
                      fontWeight="700"
                    >
                      {formatCurrencyCompact(value)}
                    </text>
                  )}

                  <text
                    x={centerX}
                    y={height - 22}
                    textAnchor="middle"
                    fontSize="10"
                    fill={dayLabelColor}
                  >
                    {dayLabel}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    </SectionCard>
  );
}

export default async function SupplierReportPage({
  params,
  searchParams,
}: PageProps) {
  const { id } = await params;
  const sp = await searchParams;

  const supplierId = Number(id);

  if (!supplierId || Number.isNaN(supplierId)) {
    throw new Error("ID fornitore non valido.");
  }

  const now = new Date();
  const todayYmd = toYmd(now);
  const defaultFrom = `${now.getFullYear()}-01-01`;
  const defaultTo = todayYmd;
  const defaultEconomicMonth = `${now.getFullYear()}-${String(
    now.getMonth() + 1
  ).padStart(2, "0")}`;

  const from = sp.from && isValidYmd(sp.from) ? sp.from : defaultFrom;
  const to = sp.to && isValidYmd(sp.to) ? sp.to : defaultTo;
  const economicMonth =
    sp.month && isValidYearMonth(sp.month) ? sp.month : defaultEconomicMonth;

  const economicMonthStart = `${economicMonth}-01`;
  const economicMonthEnd = `${economicMonth}-${String(
    getDaysInYearMonth(economicMonth)
  ).padStart(2, "0")}`;

  const previousEconomicMonth = addMonthsToYearMonth(economicMonth, -1);
  const nextEconomicMonth = addMonthsToYearMonth(economicMonth, 1);

  const fromYear = Number(from.slice(0, 4));
  const toYear = Number(to.slice(0, 4));

  const previousFrom = `${String(fromYear - 1).padStart(4, "0")}${from.slice(
    4
  )}`;
  const previousTo = `${String(toYear - 1).padStart(4, "0")}${to.slice(4)}`;

  const [
    { data: supplier, error: supplierError },
    { data: bookings, error: bookingsError },
    { data: previousBookings, error: previousBookingsError },
    { data: economicBookings, error: economicBookingsError },
  ] = await Promise.all([
    supabaseServer
      .from("suppliers")
      .select("id, name, active")
      .eq("id", supplierId)
      .single(),

    supabaseServer
      .from("bookings")
      .select(
        "id, booking_date, total_people, adults, children, infants, non_paying_adults, is_cancelled"
      )
      .eq("supplier_id", supplierId)
      .gte("booking_date", from)
      .lte("booking_date", to),

    supabaseServer
      .from("bookings")
      .select(
        "id, booking_date, total_people, adults, children, infants, non_paying_adults, is_cancelled"
      )
      .eq("supplier_id", supplierId)
      .gte("booking_date", previousFrom)
      .lte("booking_date", previousTo),

    supabaseServer
      .from("bookings")
      .select(
        "id, booking_date, booking_time, customer_name, experience_name, booking_reference, booking_source, total_people, adults, children, infants, non_paying_adults, total_to_you, total_customer, total_supplier_cost, supplier_amount_paid, customer_payment_status, supplier_payment_status, is_cancelled"
      )
      .eq("supplier_id", supplierId)
      .gte("booking_date", economicMonthStart)
      .lte("booking_date", economicMonthEnd)
      .order("booking_date", { ascending: true })
      .order("booking_time", { ascending: true }),
  ]);

  if (supplierError) {
    throw new Error(supplierError.message);
  }

  if (!supplier) {
    throw new Error("Fornitore non trovato.");
  }

  if (bookingsError) {
    throw new Error(bookingsError.message);
  }

  if (previousBookingsError) {
    throw new Error(previousBookingsError.message);
  }

  if (economicBookingsError) {
    throw new Error(economicBookingsError.message);
  }

  const validBookings = ((bookings || []) as BookingRow[]).filter(
    (b) => b.is_cancelled !== true
  );

  const validPreviousBookings = ((previousBookings || []) as BookingRow[]).filter(
    (b) => b.is_cancelled !== true
  );

  const validEconomicBookings = (
    (economicBookings || []) as EconomicBookingRow[]
  ).filter((b) => b.is_cancelled !== true);

  const totalBookings = validBookings.length;
  const totalPeople = validBookings.reduce(
    (sum, booking) => sum + getPeopleCount(booking),
    0
  );

  const monthsInRange = getRangeMonths(from, to);

  const currentMonthlyMap = new Map<number, number>();
  const previousMonthlyMap = new Map<number, number>();

  monthsInRange.forEach((monthIndex) => {
    currentMonthlyMap.set(monthIndex, 0);
    previousMonthlyMap.set(monthIndex, 0);
  });

  validBookings.forEach((booking) => {
    if (!booking.booking_date) return;

    const year = Number(booking.booking_date.slice(0, 4));
    const monthIndex = Number(booking.booking_date.slice(5, 7)) - 1;

    if (year !== fromYear) return;
    if (!currentMonthlyMap.has(monthIndex)) return;

    currentMonthlyMap.set(
      monthIndex,
      Number(currentMonthlyMap.get(monthIndex) || 0) + getPeopleCount(booking)
    );
  });

  validPreviousBookings.forEach((booking) => {
    if (!booking.booking_date) return;

    const year = Number(booking.booking_date.slice(0, 4));
    const monthIndex = Number(booking.booking_date.slice(5, 7)) - 1;

    if (year !== fromYear - 1) return;
    if (!previousMonthlyMap.has(monthIndex)) return;

    previousMonthlyMap.set(
      monthIndex,
      Number(previousMonthlyMap.get(monthIndex) || 0) + getPeopleCount(booking)
    );
  });

  const labels = monthsInRange.map((monthIndex) => getMonthLabel(monthIndex));
  const currentValues = monthsInRange.map((monthIndex) =>
    Number(currentMonthlyMap.get(monthIndex) || 0)
  );
  const previousValues = monthsInRange.map((monthIndex) =>
    Number(previousMonthlyMap.get(monthIndex) || 0)
  );

  const economicMonthDates = getMonthDates(economicMonth);

  const dailyIncomeMap = new Map<string, number>();
  const dailyTransactionsMap = new Map<string, EconomicBookingRow[]>();

  economicMonthDates.forEach((date) => {
    dailyIncomeMap.set(date, 0);
    dailyTransactionsMap.set(date, []);
  });

  validEconomicBookings.forEach((booking) => {
    if (!booking.booking_date) return;

    dailyIncomeMap.set(
      booking.booking_date,
      moneyValue(dailyIncomeMap.get(booking.booking_date)) +
        moneyValue(booking.total_to_you)
    );

    const rows = dailyTransactionsMap.get(booking.booking_date) || [];
    rows.push(booking);
    dailyTransactionsMap.set(booking.booking_date, rows);
  });

  const dailyIncomeValues = economicMonthDates.map((date) =>
    moneyValue(dailyIncomeMap.get(date))
  );

  const economicIncomeTotal = validEconomicBookings.reduce(
    (sum, booking) => sum + moneyValue(booking.total_to_you),
    0
  );

  const economicGrossCustomerTotal = validEconomicBookings.reduce(
    (sum, booking) => sum + moneyValue(booking.total_customer),
    0
  );

  const economicSupplierCostTotal = validEconomicBookings.reduce(
    (sum, booking) => sum + moneyValue(booking.total_supplier_cost),
    0
  );

  const economicSupplierPaidTotal = validEconomicBookings.reduce(
    (sum, booking) => sum + moneyValue(booking.supplier_amount_paid),
    0
  );

  const economicEstimatedMargin =
    economicIncomeTotal - economicSupplierCostTotal;

  const economicSupplierBalance =
    economicSupplierCostTotal - economicSupplierPaidTotal;

  const transactionDatesWithRows = economicMonthDates.filter(
    (date) => (dailyTransactionsMap.get(date) || []).length > 0
  );

  const economicMonthQuery = `from=${from}&to=${to}&month=`;

  return (
    <AppShell title="Report Fornitore" subtitle={supplier.name}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/fornitori"
            className="inline-flex items-center rounded-xl border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
          >
            ← Torna ai fornitori
          </Link>
        </div>

        <SectionCard title="Periodo report">
          <form method="GET" className="grid gap-3 md:grid-cols-4">
            <div>
              <label className="mb-1 block text-[11px] font-bold uppercase text-zinc-400">
                Dal
              </label>
              <input
                type="date"
                name="from"
                defaultValue={from}
                className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-[16px] outline-none focus:border-zinc-500 sm:text-sm"
              />
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-bold uppercase text-zinc-400">
                Al
              </label>
              <input
                type="date"
                name="to"
                defaultValue={to}
                className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-[16px] outline-none focus:border-zinc-500 sm:text-sm"
              />
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-bold uppercase text-zinc-400">
                Mese economia
              </label>
              <input
                type="month"
                name="month"
                defaultValue={economicMonth}
                className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-[16px] outline-none focus:border-zinc-500 sm:text-sm"
              />
            </div>

            <div className="flex items-end">
              <button
                type="submit"
                className="w-full rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-zinc-700"
              >
                Applica
              </button>
            </div>
          </form>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-700">
              Periodo attivo: <strong>{formatDateIt(from)}</strong> →{" "}
              <strong>{formatDateIt(to)}</strong>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              <div>
                Mese economico:{" "}
                <strong className="capitalize">
                  {formatYearMonthIt(economicMonth)}
                </strong>
              </div>

              <div className="flex items-center gap-2">
                <Link
                  href={`/fornitori/${supplierId}/report?${economicMonthQuery}${previousEconomicMonth}`}
                  className="rounded-lg border border-emerald-200 bg-white px-3 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100"
                >
                  ← Mese prima
                </Link>

                <Link
                  href={`/fornitori/${supplierId}/report?${economicMonthQuery}${nextEconomicMonth}`}
                  className="rounded-lg border border-emerald-200 bg-white px-3 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100"
                >
                  Mese dopo →
                </Link>
              </div>
            </div>
          </div>
        </SectionCard>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <SectionCard title="Numero prenotazioni">
            <div className="text-4xl font-black text-zinc-900">
              {totalBookings}
            </div>
            <p className="mt-2 text-sm text-zinc-500">
              Prenotazioni non cancellate nel periodo selezionato.
            </p>
          </SectionCard>

          <SectionCard title="Numero persone">
            <div className="text-4xl font-black text-zinc-900">
              {totalPeople}
            </div>
            <p className="mt-2 text-sm text-zinc-500">
              Totale persone nel periodo selezionato.
            </p>
          </SectionCard>
        </div>

        <ChartCard
          title={`Persone per mese · ${fromYear} vs ${fromYear - 1}`}
          labels={labels}
          currentValues={currentValues}
          previousValues={previousValues}
        />

        <SectionCard title="Economia mensile">
          <div className="space-y-5">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                <div className="text-[11px] font-black uppercase tracking-wide text-emerald-700">
                  Incasso reale
                </div>
                <div className="mt-2 text-3xl font-black text-emerald-800">
                  {formatCurrency(economicIncomeTotal)}
                </div>
                <p className="mt-2 text-xs text-emerald-700">
                  Somma di total_to_you. Questo è il valore usato per grafico e
                  totali.
                </p>
              </div>

              <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                <div className="text-[11px] font-black uppercase tracking-wide text-zinc-500">
                  Costo fornitore
                </div>
                <div className="mt-2 text-3xl font-black text-zinc-900">
                  {formatCurrency(economicSupplierCostTotal)}
                </div>
                <p className="mt-2 text-xs text-zinc-500">
                  Somma dei costi fornitore delle prenotazioni.
                </p>
              </div>

              <div
                className={`rounded-2xl border p-4 ${
                  economicEstimatedMargin < 0
                    ? "border-rose-200 bg-rose-50"
                    : "border-blue-200 bg-blue-50"
                }`}
              >
                <div
                  className={`text-[11px] font-black uppercase tracking-wide ${
                    economicEstimatedMargin < 0
                      ? "text-rose-700"
                      : "text-blue-700"
                  }`}
                >
                  Margine stimato
                </div>
                <div
                  className={`mt-2 text-3xl font-black ${
                    economicEstimatedMargin < 0
                      ? "text-rose-800"
                      : "text-blue-800"
                  }`}
                >
                  {formatCurrency(economicEstimatedMargin)}
                </div>
                <p
                  className={`mt-2 text-xs ${
                    economicEstimatedMargin < 0
                      ? "text-rose-700"
                      : "text-blue-700"
                  }`}
                >
                  Incasso reale meno costo fornitore.
                </p>
              </div>

              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                <div className="text-[11px] font-black uppercase tracking-wide text-amber-700">
                  Saldo fornitore
                </div>
                <div className="mt-2 text-3xl font-black text-amber-800">
                  {formatCurrency(economicSupplierBalance)}
                </div>
                <p className="mt-2 text-xs text-amber-700">
                  Costo fornitore meno pagato al fornitore.
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-700">
              Mese analizzato:{" "}
              <strong className="capitalize">
                {formatYearMonthIt(economicMonth)}
              </strong>{" "}
              · Prenotazioni economiche:{" "}
              <strong>{validEconomicBookings.length}</strong> · Lordo cliente
              solo informativo nelle singole righe:{" "}
              <strong>{formatCurrency(economicGrossCustomerTotal)}</strong>
            </div>
          </div>
        </SectionCard>

        <div className="lg:relative lg:left-1/2 lg:w-[min(1600px,calc(100vw-4rem))] lg:-translate-x-1/2">
          <IncomeDailyChartCard
            title={`Grafico incasso reale giornaliero · ${formatYearMonthIt(
              economicMonth
            )}`}
            dates={economicMonthDates}
            values={dailyIncomeValues}
            todayYmd={todayYmd}
          />
        </div>

        <div className="lg:relative lg:left-1/2 lg:w-[min(1600px,calc(100vw-4rem))] lg:-translate-x-1/2">
          <SectionCard title="Transazioni giornaliere">
            {transactionDatesWithRows.length === 0 ? (
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600">
                Nessuna transazione trovata per il mese selezionato.
              </div>
            ) : (
              <div className="space-y-5">
                {transactionDatesWithRows.map((date) => {
                  const rows = dailyTransactionsMap.get(date) || [];

                  const dayIncome = rows.reduce(
                    (sum, row) => sum + moneyValue(row.total_to_you),
                    0
                  );
                  const daySupplierCost = rows.reduce(
                    (sum, row) => sum + moneyValue(row.total_supplier_cost),
                    0
                  );
                  const daySupplierPaid = rows.reduce(
                    (sum, row) => sum + moneyValue(row.supplier_amount_paid),
                    0
                  );
                  const dayMargin = dayIncome - daySupplierCost;
                  const dayIncomeBelowCost = dayIncome < daySupplierCost;

                  return (
                    <div
                      key={`transactions-${date}`}
                      className="overflow-hidden rounded-2xl border border-zinc-200 bg-white"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 bg-zinc-50 px-4 py-3">
                        <div>
                          <div className="text-sm font-black text-zinc-900">
                            {formatDateIt(date)}
                          </div>
                          <div className="text-xs text-zinc-500">
                            {rows.length} transazioni
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2 text-xs">
                          <div
                            className={`rounded-lg border px-3 py-2 font-bold ${
                              dayIncomeBelowCost
                                ? "border-rose-200 bg-rose-50 text-rose-700"
                                : "border-emerald-200 bg-emerald-50 text-emerald-700"
                            }`}
                          >
                            Incasso: {formatCurrency(dayIncome)}
                          </div>

                          <div
                            className={`rounded-lg border px-3 py-2 font-bold ${
                              dayIncomeBelowCost
                                ? "border-rose-200 bg-rose-50 text-rose-700"
                                : "border-zinc-200 bg-white text-zinc-700"
                            }`}
                          >
                            Costo: {formatCurrency(daySupplierCost)}
                          </div>

                          <div
                            className={`rounded-lg border px-3 py-2 font-bold ${
                              dayMargin < 0
                                ? "border-rose-200 bg-rose-50 text-rose-700"
                                : "border-blue-200 bg-blue-50 text-blue-700"
                            }`}
                          >
                            Margine: {formatCurrency(dayMargin)}
                          </div>

                          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 font-bold text-amber-700">
                            Pagato forn.: {formatCurrency(daySupplierPaid)}
                          </div>
                        </div>
                      </div>

                      <div className="overflow-x-auto lg:overflow-x-visible">
                        <table className="min-w-[1200px] text-left text-xs lg:w-full lg:min-w-0 lg:table-auto xl:text-sm">
                          <thead className="border-b border-zinc-200 text-[11px] font-black uppercase text-zinc-500">
                            <tr>
                              <th className="px-2 py-3 xl:px-3">Ora</th>
                              <th className="px-2 py-3 xl:px-3">Cliente</th>
                              <th className="px-2 py-3 xl:px-3">Canale</th>
                              <th className="px-2 py-3 xl:px-3">Esperienza</th>
                              <th className="px-2 py-3 xl:px-3">Rif.</th>
                              <th className="px-2 py-3 text-right xl:px-3">
                                Persone
                              </th>
                              <th className="px-2 py-3 text-right xl:px-3">
                                Paganti
                              </th>
                              <th className="px-2 py-3 text-right xl:px-3">
                                Incasso
                              </th>
                              <th className="px-2 py-3 text-right xl:px-3">
                                Lordo
                              </th>
                              <th className="px-2 py-3 text-right xl:px-3">
                                Costo
                              </th>
                              <th className="px-2 py-3 text-right xl:px-3">
                                Pagato forn.
                              </th>
                              <th className="px-2 py-3 xl:px-3">
                                Stato cliente
                              </th>
                              <th className="px-2 py-3 xl:px-3">
                                Stato fornitore
                              </th>
                            </tr>
                          </thead>

                          <tbody>
                            {rows.map((row) => {
                              const rowIncome = moneyValue(row.total_to_you);
                              const rowSupplierCost = moneyValue(
                                row.total_supplier_cost
                              );
                              const incomeBelowCost =
                                rowIncome < rowSupplierCost;

                              return (
                                <tr
                                  key={row.id}
                                  className={`border-b border-zinc-100 last:border-0 ${
                                    incomeBelowCost ? "bg-rose-50/70" : ""
                                  }`}
                                >
                                  <td className="px-2 py-3 font-medium text-zinc-700 xl:px-3">
                                    {formatTime(row.booking_time)}
                                  </td>

                                  <td className="px-2 py-3 font-bold text-zinc-900 xl:px-3">
                                    {row.customer_name || "-"}
                                  </td>

                                  <td className="px-2 py-3 text-zinc-700 xl:px-3">
                                    {row.booking_source || "-"}
                                  </td>

                                  <td className="min-w-[220px] px-2 py-3 text-zinc-700 xl:px-3">
                                    {row.experience_name || "-"}
                                  </td>

                                  <td className="px-2 py-3 font-mono text-[11px] text-zinc-600 xl:px-3">
                                    {row.booking_reference || "-"}
                                  </td>

                                  <td className="whitespace-nowrap px-2 py-3 text-right font-bold text-zinc-900 xl:px-3">
                                    {getPeopleBreakdown(row)}
                                  </td>

                                  <td className="px-2 py-3 text-right font-bold text-zinc-900 xl:px-3">
                                    {getPayingPeopleCount(row)}
                                  </td>

                                  <td
                                    className={`whitespace-nowrap px-2 py-3 text-right font-black xl:px-3 ${
                                      incomeBelowCost
                                        ? "text-rose-700"
                                        : "text-emerald-700"
                                    }`}
                                  >
                                    {formatCurrency(row.total_to_you)}
                                  </td>

                                  <td className="whitespace-nowrap px-2 py-3 text-right font-bold text-zinc-600 xl:px-3">
                                    {formatCurrency(row.total_customer)}
                                  </td>

                                  <td
                                    className={`whitespace-nowrap px-2 py-3 text-right font-bold xl:px-3 ${
                                      incomeBelowCost
                                        ? "text-rose-700"
                                        : "text-zinc-700"
                                    }`}
                                  >
                                    {formatCurrency(row.total_supplier_cost)}
                                  </td>

                                  <td className="whitespace-nowrap px-2 py-3 text-right font-bold text-blue-700 xl:px-3">
                                    {formatCurrency(row.supplier_amount_paid)}
                                  </td>

                                  <td className="px-2 py-3 xl:px-3">
                                    <span
                                      className={`inline-flex whitespace-nowrap rounded-full px-2 py-1 text-[11px] font-black ${getStatusClass(
                                        row.customer_payment_status
                                      )}`}
                                    >
                                      {getStatusLabel(
                                        row.customer_payment_status
                                      )}
                                    </span>
                                  </td>

                                  <td className="px-2 py-3 xl:px-3">
                                    <span
                                      className={`inline-flex whitespace-nowrap rounded-full px-2 py-1 text-[11px] font-black ${getStatusClass(
                                        row.supplier_payment_status
                                      )}`}
                                    >
                                      {getStatusLabel(
                                        row.supplier_payment_status
                                      )}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>
        </div>
      </div>
    </AppShell>
  );
}