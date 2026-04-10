export const dynamic = "force-dynamic";

import Sidebar from "@/components/Sidebar";
import SectionCard from "@/components/SectionCard";
import { supabaseServer } from "@/lib/supabase-server";
import Link from "next/link";

const MONTHS = ["Gen", "Feb", "Mar", "Apr", "Mag", "Gio", "Lug", "Ago", "Set", "Ott", "Nov", "Dic"];

function formatEuro(value: number) {
  return new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(value);
}

type PageProps = {
  searchParams: Promise<{
    year?: string;
  }>;
};

export default async function ReportPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const currentYear = new Date().getFullYear().toString();
  const selectedYear = params.year || currentYear;

  const { data: bookings, error } = await supabaseServer
    .from("bookings")
    .select("*")
    .eq("is_cancelled", false);

  if (error) {
    console.error("Errore caricamento dati report:", error.message);
  }

  const validBookings = bookings || [];

  const availableYears = Array.from(
    new Set(
      validBookings
        .map((b) => (b.booking_date ? b.booking_date.substring(0, 4) : null))
        .filter(Boolean) as string[]
    )
  )
    .sort()
    .reverse();

  if (!availableYears.includes(currentYear)) {
    availableYears.unshift(currentYear);
  }

  const chartYears = Array.from(
    new Set(
      validBookings
        .map((b) => (b.booking_date ? b.booking_date.substring(0, 4) : null))
        .filter((y) => y && Number(y) >= 2025) as string[]
    )
  ).sort();

  const displayChartYears = chartYears.length > 0 ? chartYears : ["2025", "2026"];
  const yearColors = ["bg-zinc-300", "bg-blue-500", "bg-emerald-500", "bg-amber-500"];

  const chartData = MONTHS.map((monthName, monthIndex) => {
    const monthData: any = { month: monthName };
    const monthStr = String(monthIndex + 1).padStart(2, "0");

    displayChartYears.forEach((year) => {
      const monthYearBookings = validBookings.filter((b) =>
        b.booking_date?.startsWith(`${year}-${monthStr}`)
      );
      const count = monthYearBookings.length;
      const pax = monthYearBookings.reduce(
        (sum, b) => sum + Number(b.total_people || b.pax || 0),
        0
      );
      monthData[`count_${year}`] = count;
      monthData[`pax_${year}`] = pax;
    });

    return monthData;
  });

  const maxCount = Math.max(
    ...chartData.flatMap((d) => displayChartYears.map((y) => d[`count_${y}`])),
    1
  );
  const maxPax = Math.max(
    ...chartData.flatMap((d) => displayChartYears.map((y) => d[`pax_${y}`])),
    1
  );

  const yearBookings = validBookings.filter((b) => b.booking_date?.startsWith(selectedYear));

  let totalRevenue = 0;
  let totalToYou = 0;
  let totalMargin = 0;
  let totalPax = 0;

  const channelsMap: Record<string, { count: number; revenue: number; pax: number }> = {};
  const experiencesMap: Record<string, { count: number; revenue: number; pax: number }> = {};

  yearBookings.forEach((b) => {
    const revenue = Number(b.total_customer || 0);
    const net = Number(b.total_to_you || 0);
    const margin = Number(b.margin_total || 0);
    const pax = Number(b.pax || b.total_people || 0);

    totalRevenue += revenue;
    totalToYou += net;
    totalMargin += margin;
    totalPax += pax;

    const source = b.booking_source || "Sconosciuto";
    if (!channelsMap[source]) channelsMap[source] = { count: 0, revenue: 0, pax: 0 };
    channelsMap[source].count += 1;
    channelsMap[source].revenue += revenue;
    channelsMap[source].pax += pax;

    const expName = b.experience_name || "Esperienza rimossa";
    if (!experiencesMap[expName]) experiencesMap[expName] = { count: 0, revenue: 0, pax: 0 };
    experiencesMap[expName].count += 1;
    experiencesMap[expName].revenue += revenue;
    experiencesMap[expName].pax += pax;
  });

  const topChannels = Object.entries(channelsMap)
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .slice(0, 5);

  const topExperiences = Object.entries(experiencesMap)
    .sort((a, b) => b[1].pax - a[1].pax)
    .slice(0, 5);

  const marginPercentage = totalToYou > 0 ? ((totalMargin / totalToYou) * 100).toFixed(1) : "0.0";

  return (
    <main className="min-h-screen bg-zinc-50 p-6">
      <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[260px_1fr]">
        <Sidebar />

        <div className="space-y-6 pb-10">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-3xl font-bold text-zinc-900">Dashboard Report</h1>
              <p className="mt-1 text-sm text-zinc-500">Analisi e statistiche delle tue prenotazioni</p>
            </div>

            <div className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white p-2 shadow-sm">
              <span className="pl-2 text-sm font-bold text-zinc-500">Anno:</span>
              <div className="flex gap-1">
                {availableYears.map((year) => (
                  <Link
                    key={year}
                    href={`/report?year=${year}`}
                    className={`rounded-lg px-4 py-1.5 text-sm font-bold transition ${
                      selectedYear === year
                        ? "bg-zinc-900 text-white"
                        : "text-zinc-600 hover:bg-zinc-100"
                    }`}
                  >
                    {year}
                  </Link>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
              <p className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-500">Fatturato Lordo</p>
              <h3 className="text-3xl font-black text-zinc-900">{formatEuro(totalRevenue)}</h3>
              <p className="mt-2 text-xs text-zinc-400">Valore totale venduto al cliente</p>
            </div>

            <div className="rounded-2xl border border-zinc-200 border-l-4 border-l-blue-500 bg-white p-6 shadow-sm">
              <p className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-500">Fatturato Netto</p>
              <h3 className="text-3xl font-black text-blue-600">{formatEuro(totalToYou)}</h3>
              <p className="mt-2 text-xs text-zinc-400">Tolte le commissioni OTA</p>
            </div>

            <div className="rounded-2xl border border-zinc-200 border-l-4 border-l-green-500 bg-white p-6 shadow-sm">
              <p className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-500">Margine Utile</p>
              <div className="flex items-baseline gap-2">
                <h3 className="text-3xl font-black text-green-600">{formatEuro(totalMargin)}</h3>
                <span className="rounded-lg bg-green-100 px-2 py-1 text-xs font-bold text-green-700">
                  {marginPercentage}%
                </span>
              </div>
              <p className="mt-2 text-xs text-zinc-400">I tuoi guadagni reali sul netto</p>
            </div>

            <div className="rounded-2xl border border-zinc-200 border-l-4 border-l-amber-500 bg-white p-6 shadow-sm">
              <p className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-500">Passeggeri totali</p>
              <h3 className="text-3xl font-black text-amber-600">
                {totalPax} <span className="text-lg text-amber-500/50">Pax</span>
              </h3>
              <p className="mt-2 text-xs text-zinc-400">In {yearBookings.length} prenotazioni</p>
            </div>
          </div>

          <div className="mt-8 flex items-center justify-between rounded-xl bg-zinc-900 p-4 text-white shadow-sm">
            <div>
              <h2 className="font-bold">Analisi Comparativa Anno su Anno</h2>
              <p className="text-xs text-zinc-400">Confronto mesi dal 2025 in poi</p>
            </div>
            <div className="flex items-center gap-4 rounded-lg bg-zinc-800 px-3 py-1.5">
              {displayChartYears.map((year, i) => (
                <div key={year} className="flex items-center gap-2">
                  <div className={`h-3 w-3 rounded-full ${yearColors[i % yearColors.length]}`}></div>
                  <span className="text-xs font-bold text-zinc-300">{year}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <SectionCard title="Numero di Prenotazioni">
              <div className="pb-8 pt-6">
                <div className="flex h-56 gap-2">
                  <div className="flex w-8 shrink-0 flex-col justify-between pb-px text-right text-[10px] font-bold text-zinc-400">
                    <span className="leading-none">{maxCount}</span>
                    <span className="leading-none">{Math.round(maxCount * 0.666)}</span>
                    <span className="leading-none">{Math.round(maxCount * 0.333)}</span>
                    <span className="translate-y-1 leading-none">0</span>
                  </div>

                  <div className="relative flex flex-1 items-end gap-1 border-b border-zinc-200 sm:gap-2">
                    <div className="pointer-events-none absolute inset-0 flex flex-col justify-between">
                      <div className="h-px w-full bg-zinc-200"></div>
                      <div className="h-px w-full bg-zinc-200"></div>
                      <div className="h-px w-full bg-zinc-200"></div>
                      <div className="h-px w-full bg-transparent"></div>
                    </div>

                    {chartData.map((data, idx) => (
                      <div key={idx} className="group relative flex h-full flex-1 flex-col justify-end">
                        <div className="z-10 flex h-full w-full items-end justify-center gap-0.5">
                          {displayChartYears.map((year, i) => {
                            const val = data[`count_${year}`];
                            const heightPct = (val / maxCount) * 100;
                            return (
                              <div
                                key={year}
                                className={`relative flex w-full max-w-[12px] justify-center rounded-t-sm transition-all duration-500 hover:opacity-80 ${yearColors[i % yearColors.length]}`}
                                style={{ height: `${heightPct}%`, minHeight: val > 0 ? "4px" : "0" }}
                              >
                                <div className="pointer-events-none absolute -top-8 z-20 whitespace-nowrap rounded bg-zinc-900 px-2 py-1 text-[10px] font-bold text-white opacity-0 transition-opacity group-hover:opacity-100">
                                  {year}: {val}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-[10px] font-bold uppercase text-zinc-400">
                          {data.month}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </SectionCard>

            <SectionCard title="Numero di Passeggeri (Pax)">
              <div className="pb-8 pt-6">
                <div className="flex h-56 gap-2">
                  <div className="flex w-8 shrink-0 flex-col justify-between pb-px text-right text-[10px] font-bold text-zinc-400">
                    <span className="leading-none">{maxPax}</span>
                    <span className="leading-none">{Math.round(maxPax * 0.666)}</span>
                    <span className="leading-none">{Math.round(maxPax * 0.333)}</span>
                    <span className="translate-y-1 leading-none">0</span>
                  </div>

                  <div className="relative flex flex-1 items-end gap-1 border-b border-zinc-200 sm:gap-2">
                    <div className="pointer-events-none absolute inset-0 flex flex-col justify-between">
                      <div className="h-px w-full bg-zinc-200"></div>
                      <div className="h-px w-full bg-zinc-200"></div>
                      <div className="h-px w-full bg-zinc-200"></div>
                      <div className="h-px w-full bg-transparent"></div>
                    </div>

                    {chartData.map((data, idx) => (
                      <div key={idx} className="group relative flex h-full flex-1 flex-col justify-end">
                        <div className="z-10 flex h-full w-full items-end justify-center gap-0.5">
                          {displayChartYears.map((year, i) => {
                            const val = data[`pax_${year}`];
                            const heightPct = (val / maxPax) * 100;
                            return (
                              <div
                                key={year}
                                className={`relative flex w-full max-w-[12px] justify-center rounded-t-sm transition-all duration-500 hover:opacity-80 ${yearColors[i % yearColors.length]}`}
                                style={{ height: `${heightPct}%`, minHeight: val > 0 ? "4px" : "0" }}
                              >
                                <div className="pointer-events-none absolute -top-8 z-20 whitespace-nowrap rounded bg-zinc-900 px-2 py-1 text-[10px] font-bold text-white opacity-0 transition-opacity group-hover:opacity-100">
                                  {year}: {val} pax
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-[10px] font-bold uppercase text-zinc-400">
                          {data.month}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </SectionCard>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <SectionCard title="🏆 Top Canali di Vendita">
              <div className="mt-2 space-y-5">
                {topChannels.map(([name, stats], index) => {
                  const percentage = totalRevenue > 0 ? (stats.revenue / totalRevenue) * 100 : 0;
                  return (
                    <div key={name} className="relative">
                      <div className="mb-1 flex items-end justify-between">
                        <span className="flex items-center gap-2 text-sm font-bold text-zinc-800">
                          <span className="text-zinc-400">#{index + 1}</span> {name}
                        </span>
                        <span className="text-sm font-black text-zinc-900">{formatEuro(stats.revenue)}</span>
                      </div>
                      <div className="h-2.5 w-full overflow-hidden rounded-full bg-zinc-100">
                        <div
                          className="h-2.5 rounded-full bg-blue-500"
                          style={{ width: `${percentage}%` }}
                        ></div>
                      </div>
                      <div className="mt-1 flex justify-between">
                        <span className="text-[10px] font-medium text-zinc-500">
                          {stats.count} prenotazioni
                        </span>
                        <span className="text-[10px] font-medium text-zinc-500">
                          {percentage.toFixed(1)}% del totale
                        </span>
                      </div>
                    </div>
                  );
                })}
                {topChannels.length === 0 && (
                  <p className="text-sm italic text-zinc-400">Nessun dato per questo anno.</p>
                )}
              </div>
            </SectionCard>

            <SectionCard title="🎯 Top Esperienze (per Pax)">
              <div className="mt-2 space-y-4">
                {topExperiences.map(([name, stats], index) => (
                  <div
                    key={name}
                    className="flex items-center gap-4 rounded-xl border border-zinc-100 bg-zinc-50/50 p-3 transition hover:bg-zinc-50"
                  >
                    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-amber-100 text-sm font-black text-amber-700">
                      {index + 1}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-zinc-800">{name}</p>
                      <p className="mt-0.5 text-[11px] text-zinc-500">{stats.count} prenotazioni</p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-black text-zinc-900">{stats.pax}</p>
                      <p className="text-[10px] font-bold uppercase text-zinc-400">Passeggeri</p>
                    </div>
                  </div>
                ))}
                {topExperiences.length === 0 && (
                  <p className="text-sm italic text-zinc-400">Nessun dato per questo anno.</p>
                )}
              </div>
            </SectionCard>
          </div>
        </div>
      </div>
    </main>
  );
}