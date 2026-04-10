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
  const d = new Date(value);
  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "2-digit",
  }).format(d);
}

function getMonthName(monthIndex: number) {
  const date = new Date(2024, monthIndex, 1);
  return new Intl.DateTimeFormat("it-IT", { month: "long" }).format(date);
}

function getShortMonthName(monthIndex: number) {
  const date = new Date(2024, monthIndex, 1);
  return new Intl.DateTimeFormat("it-IT", { month: "short" }).format(date);
}

type PageProps = {
  searchParams: Promise<{ m?: string; y?: string }>;
};

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

  const allBookings = bookings || [];

  let meseEntrate = 0;
  let meseSpese = 0;
  let meseTotale = 0;
  const prossimePrenotazioni: any[] = [];

  const expPaxCounts: Record<string, number> = {};

  allBookings.forEach((b) => {
    if (b.is_cancelled) return;

    const expName = b.experience_name || "Sconosciuta";
    const numPeople = Number(b.total_people || 0);
    expPaxCounts[expName] = (expPaxCounts[expName] || 0) + numPeople;

    if (b.booking_date) {
      const bDate = new Date(b.booking_date);

      if (
        bDate.getMonth() + 1 === selectedMonth &&
        bDate.getFullYear() === selectedYear
      ) {
        meseEntrate += Number(b.total_to_you || 0);
        meseSpese += Number(b.total_supplier_cost || 0);
        meseTotale += Number(b.margin_total || 0);
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
    const monthMargin = allBookings
      .filter((b) => {
        if (!b.booking_date || b.is_cancelled) return false;
        const d = new Date(b.booking_date);
        return d.getFullYear() === selectedYear && d.getMonth() === i;
      })
      .reduce((sum, b) => sum + Number(b.margin_total || 0), 0);

    return { label: getShortMonthName(i), value: monthMargin, index: i + 1 };
  });

  const maxAbsChartValue = Math.max(
    ...chartData.map((d) => Math.abs(d.value)),
    1
  );

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
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
                className="h-5 w-5 text-zinc-700"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15.75 19.5 8.25 12l7.5-7.5"
                />
              </svg>
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
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
                className="h-5 w-5 text-zinc-700"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8.25 4.5l7.5 7.5-7.5 7.5"
                />
              </svg>
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
                <div className="flex min-w-0 items-center gap-2">
                  <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      className="h-3 w-3"
                    >
                      <path
                        fillRule="evenodd"
                        d="M10 17a.75.75 0 01-.75-.75V5.612L5.29 9.77a.75.75 0 01-1.08-1.04l5.25-5.5a.75.75 0 011.08 0l5.25 5.5a.75.75 0 11-1.08 1.04l-3.96-4.158V16.25A.75.75 0 0110 17z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </div>
                  <span className="text-base font-medium text-zinc-800 sm:text-lg">
                    Entrate
                  </span>
                </div>
                <span className="text-lg font-medium text-green-600 sm:text-xl">
                  {formatEuro(meseEntrate)}
                </span>
              </div>

              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      className="h-3 w-3"
                    >
                      <path
                        fillRule="evenodd"
                        d="M10 3a.75.75 0 01.75.75v10.638l3.96-4.158a.75.75 0 111.08 1.04l-5.25 5.5a.75.75 0 01-1.08 0l-5.25-5.5a.75.75 0 111.08-1.04l3.96 4.158V3.75A.75.75 0 0110 3z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </div>
                  <span className="text-base font-medium text-zinc-800 sm:text-lg">
                    Spese
                  </span>
                </div>
                <span className="text-lg font-medium text-red-600 sm:text-xl">
                  -{formatEuro(meseSpese)}
                </span>
              </div>

              <div className="mt-4 border-t border-dashed border-zinc-200 pt-5">
                <div className="flex h-28 items-stretch justify-between gap-1 sm:h-32">
                  {chartData.map((d, idx) => {
                    const heightPct = (Math.abs(d.value) / maxAbsChartValue) * 100;
                    const isCurrentMonth = d.index === selectedMonth;

                    return (
                      <div
                        key={idx}
                        className="flex flex-1 flex-col justify-center"
                        title={`${d.label}: ${formatEuro(d.value)}`}
                      >
                        <div className="flex flex-1 items-end">
                          {d.value > 0 && (
                            <div
                              className={`w-full rounded-t-sm transition-all ${
                                isCurrentMonth
                                  ? "bg-blue-500"
                                  : "bg-green-500 hover:bg-green-400"
                              }`}
                              style={{ height: `${heightPct}%` }}
                            />
                          )}
                        </div>

                        <div className="my-0.5 h-px w-full bg-zinc-300" />

                        <div className="flex h-6 items-start">
                          {d.value < 0 && (
                            <div
                              className={`w-full rounded-b-sm transition-all ${
                                isCurrentMonth
                                  ? "bg-blue-500"
                                  : "bg-red-500 hover:bg-red-400"
                              }`}
                              style={{ height: `${Math.min(heightPct, 100)}%` }}
                            />
                          )}
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
                  Mese selezionato:{" "}
                  <span className="font-bold text-zinc-800">
                    {formatEuro(chartData[selectedMonth - 1]?.value || 0)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4 sm:space-y-6">
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
                              isToday ? "text-blue-700" : "text-zinc-900"
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
                          <span className="rounded-lg border border-blue-100 bg-blue-50 px-2 py-1 text-[10px] font-bold uppercase tracking-tight text-blue-700">
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
                                isToday ? "text-blue-700" : "text-zinc-900"
                              }`}
                            >
                              {isToday ? "OGGI" : formatDate(booking.booking_date)}
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
                                  <span className="inline-block shrink-0 rounded border border-blue-100 bg-blue-50 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-tight text-blue-700">
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