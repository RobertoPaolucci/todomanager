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

function toYmd(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isValidYmd(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
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

function niceCeil(value: number) {
  if (value <= 0) return 10;
  if (value <= 10) return 10;
  if (value <= 20) return 20;
  if (value <= 50) return 50;
  if (value <= 100) return 100;
  return Math.ceil(value / 10) * 10;
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

  const currentColor = "#2563eb"; // blue-600
  const previousColor = "#f59e0b"; // amber-500

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
                  <text
                    x={10}
                    y={y + 4}
                    fontSize="11"
                    fill="#71717a"
                  >
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
                  <td className="py-2 pr-4 font-medium text-zinc-900">{label}</td>
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
  const defaultFrom = `${now.getFullYear()}-01-01`;
  const defaultTo = toYmd(now);

  const from = sp.from && isValidYmd(sp.from) ? sp.from : defaultFrom;
  const to = sp.to && isValidYmd(sp.to) ? sp.to : defaultTo;

  const fromYear = Number(from.slice(0, 4));
  const toYear = Number(to.slice(0, 4));

  const previousFrom = `${String(fromYear - 1).padStart(4, "0")}${from.slice(4)}`;
  const previousTo = `${String(toYear - 1).padStart(4, "0")}${to.slice(4)}`;

  const [
    { data: supplier, error: supplierError },
    { data: bookings, error: bookingsError },
    { data: previousBookings, error: previousBookingsError },
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

  const validBookings = ((bookings || []) as BookingRow[]).filter(
    (b) => b.is_cancelled !== true
  );

  const validPreviousBookings = ((previousBookings || []) as BookingRow[]).filter(
    (b) => b.is_cancelled !== true
  );

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
          <form method="GET" className="grid gap-3 md:grid-cols-3">
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

            <div className="flex items-end">
              <button
                type="submit"
                className="w-full rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-zinc-700"
              >
                Applica
              </button>
            </div>
          </form>

          <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-700">
            Periodo attivo: <strong>{formatDateIt(from)}</strong> →{" "}
            <strong>{formatDateIt(to)}</strong>
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
      </div>
    </AppShell>
  );
}