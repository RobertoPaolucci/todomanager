export const dynamic = "force-dynamic";

import Sidebar from "@/components/Sidebar";
import SectionCard from "@/components/SectionCard";
import { supabase } from "@/lib/supabase";
import Link from "next/link";

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

  const { data: bookings, error } = await supabase
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
        .map(b => b.booking_date ? b.booking_date.substring(0, 4) : null)
        .filter(Boolean)
    )
  ).sort().reverse();

  if (!availableYears.includes(currentYear)) {
    availableYears.unshift(currentYear);
  }

  const yearBookings = validBookings.filter(b => b.booking_date?.startsWith(selectedYear));

  let totalRevenue = 0; 
  let totalToYou = 0;   
  let totalMargin = 0;  
  let totalPax = 0;     
  
  const channelsMap: Record<string, { count: number, revenue: number, pax: number }> = {};
  const experiencesMap: Record<string, { count: number, revenue: number, pax: number }> = {};

  yearBookings.forEach(b => {
    const revenue = Number(b.total_customer || 0);
    const net = Number(b.total_to_you || 0);
    const margin = Number(b.margin_total || 0);
    const pax = Number(b.pax || 0);

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

  // Calcolo Percentuale Margine sul Netto
  const marginPercentage = totalToYou > 0 ? ((totalMargin / totalToYou) * 100).toFixed(1) : "0.0";

  return (
    <main className="min-h-screen bg-zinc-50 p-6">
      <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[260px_1fr]">
        <Sidebar />

        <div className="space-y-6 pb-10">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-3xl font-bold text-zinc-900">Dashboard Report</h1>
              <p className="text-sm text-zinc-500 mt-1">Analisi e statistiche delle tue prenotazioni</p>
            </div>
            
            <div className="flex items-center gap-3 bg-white p-2 rounded-xl border border-zinc-200 shadow-sm">
              <span className="text-sm font-bold text-zinc-500 pl-2">Anno:</span>
              <div className="flex gap-1">
                {availableYears.map(year => (
                  <Link 
                    key={year} 
                    href={`/report?year=${year}`}
                    className={`px-4 py-1.5 rounded-lg text-sm font-bold transition ${
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

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white p-6 rounded-2xl border border-zinc-200 shadow-sm">
              <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Fatturato Lordo</p>
              <h3 className="text-3xl font-black text-zinc-900">{formatEuro(totalRevenue)}</h3>
              <p className="text-xs text-zinc-400 mt-2">Valore totale venduto al cliente</p>
            </div>
            
            <div className="bg-white p-6 rounded-2xl border border-zinc-200 shadow-sm border-l-4 border-l-blue-500">
              <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Fatturato Netto</p>
              <h3 className="text-3xl font-black text-blue-600">{formatEuro(totalToYou)}</h3>
              <p className="text-xs text-zinc-400 mt-2">Tolte le commissioni OTA</p>
            </div>

            <div className="bg-white p-6 rounded-2xl border border-zinc-200 shadow-sm border-l-4 border-l-green-500">
              <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Margine Utile</p>
              <div className="flex items-baseline gap-2">
                <h3 className="text-3xl font-black text-green-600">{formatEuro(totalMargin)}</h3>
                <span className="text-xs font-bold text-green-700 bg-green-100 px-2 py-1 rounded-lg">
                  {marginPercentage}%
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-2">I tuoi guadagni reali sul netto</p>
            </div>

            <div className="bg-white p-6 rounded-2xl border border-zinc-200 shadow-sm border-l-4 border-l-amber-500">
              <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Passeggeri totali</p>
              <h3 className="text-3xl font-black text-amber-600">{totalPax} <span className="text-lg text-amber-500/50">Pax</span></h3>
              <p className="text-xs text-zinc-400 mt-2">In {yearBookings.length} prenotazioni</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <SectionCard title="🏆 Top Canali di Vendita">
              <div className="space-y-5 mt-2">
                {topChannels.map(([name, stats], index) => {
                  const percentage = totalRevenue > 0 ? (stats.revenue / totalRevenue) * 100 : 0;
                  return (
                    <div key={name} className="relative">
                      <div className="flex justify-between items-end mb-1">
                        <span className="text-sm font-bold text-zinc-800 flex items-center gap-2">
                          <span className="text-zinc-400">#{index + 1}</span> {name}
                        </span>
                        <span className="text-sm font-black text-zinc-900">{formatEuro(stats.revenue)}</span>
                      </div>
                      <div className="w-full bg-zinc-100 rounded-full h-2.5 overflow-hidden">
                        <div className="bg-blue-500 h-2.5 rounded-full" style={{ width: `${percentage}%` }}></div>
                      </div>
                      <div className="flex justify-between mt-1">
                        <span className="text-[10px] text-zinc-500 font-medium">{stats.count} prenotazioni</span>
                        <span className="text-[10px] text-zinc-500 font-medium">{percentage.toFixed(1)}% del totale</span>
                      </div>
                    </div>
                  );
                })}
                {topChannels.length === 0 && <p className="text-sm text-zinc-400 italic">Nessun dato per questo anno.</p>}
              </div>
            </SectionCard>

            <SectionCard title="🎯 Top Esperienze (per Pax)">
              <div className="space-y-4 mt-2">
                {topExperiences.map(([name, stats], index) => (
                  <div key={name} className="flex items-center gap-4 p-3 rounded-xl border border-zinc-100 bg-zinc-50/50 hover:bg-zinc-50 transition">
                    <div className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg bg-amber-100 text-amber-700 font-black text-sm">
                      {index + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-zinc-800 truncate">{name}</p>
                      <p className="text-[11px] text-zinc-500 mt-0.5">{stats.count} prenotazioni</p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-black text-zinc-900">{stats.pax}</p>
                      <p className="text-[10px] font-bold text-zinc-400 uppercase">Passeggeri</p>
                    </div>
                  </div>
                ))}
                {topExperiences.length === 0 && <p className="text-sm text-zinc-400 italic">Nessun dato per questo anno.</p>}
              </div>
            </SectionCard>
          </div>

        </div>
      </div>
    </main>
  );
}