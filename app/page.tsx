export const dynamic = "force-dynamic";

import Link from "next/link";
import AppShell from "@/components/AppShell";
import SectionCard from "@/components/SectionCard";
import { getDashboardStats } from "@/lib/dashboard";
import { supabase } from "@/lib/supabase";

function formatEuro(value: number) {
  return new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDate(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
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
  const maxChannelCount = Math.max(...bookingsByChannel.map(c => c.count), 1);

  const { data: bookings, error } = await supabase
    .from("bookings")
    .select("*")
    .order("booking_date", { ascending: true });

  if (error) console.error("Errore caricamento prenotazioni:", error.message);
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
      
      if (bDate.getMonth() + 1 === selectedMonth && bDate.getFullYear() === selectedYear) {
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

  const maxExpPax = Math.max(...bookingsByExperience.map(e => e.count), 1);

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

  const maxAbsChartValue = Math.max(...chartData.map((d) => Math.abs(d.value)), 1);

  return (
    <AppShell
      title="Dashboard"
      subtitle="Panoramica economica e operativa del gestionale"
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_350px] items-start">
        
        <div className="space-y-6">
          {/* SELETTORE MESE */}
          <div className="flex items-center justify-between rounded-full border border-zinc-200 bg-white p-2 shadow-sm max-w-md mx-auto">
            <Link 
              href={`/?m=${prevMonth}&y=${prevYear}`}
              className="flex h-12 w-12 items-center justify-center rounded-full hover:bg-zinc-100 transition"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6 text-zinc-700">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
              </svg>
            </Link>
            
            <div className="text-center flex-1">
              <h2 className="text-lg font-bold text-zinc-900 capitalize">
                {nomeMese} {selectedYear}
              </h2>
              <p className="text-xs text-zinc-500">
                01/{String(selectedMonth).padStart(2, '0')}/{selectedYear} a {lastDayOfMonth}/{String(selectedMonth).padStart(2, '0')}/{selectedYear}
              </p>
            </div>

            <Link 
              href={`/?m=${nextMonth}&y=${nextYear}`}
              className="flex h-12 w-12 items-center justify-center rounded-full hover:bg-zinc-100 transition"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6 text-zinc-700">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </Link>
          </div>

          {/* CARD BILANCIO MENSILE */}
          <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-md max-w-md mx-auto">
            <div className="bg-blue-600 py-3 text-center text-white font-medium">
              Bilancio mensile
            </div>
            
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-zinc-100 pb-4">
                <span className="text-2xl font-bold text-zinc-900">Totale</span>
                <span className={`text-2xl font-bold ${meseTotale >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {formatEuro(meseTotale)}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-900 text-white">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3">
                      <path fillRule="evenodd" d="M10 17a.75.75 0 01-.75-.75V5.612L5.29 9.77a.75.75 0 01-1.08-1.04l5.25-5.5a.75.75 0 011.08 0l5.25 5.5a.75.75 0 11-1.08 1.04l-3.96-4.158V16.25A.75.75 0 0110 17z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <span className="text-lg font-medium text-zinc-800">Entrate</span>
                </div>
                <span className="text-xl font-medium text-green-600">{formatEuro(meseEntrate)}</span>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-900 text-white">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3">
                      <path fillRule="evenodd" d="M10 3a.75.75 0 01.75.75v10.638l3.96-4.158a.75.75 0 111.08 1.04l-5.25 5.5a.75.75 0 01-1.08 0l-5.25-5.5a.75.75 0 111.08-1.04l3.96 4.158V3.75A.75.75 0 0110 3z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <span className="text-lg font-medium text-zinc-800">Spese</span>
                </div>
                <span className="text-xl font-medium text-red-600">-{formatEuro(meseSpese)}</span>
              </div>

              <div className="pt-6 mt-4 border-t border-dashed border-zinc-200">
                <div className="flex items-stretch justify-between h-32 gap-1 relative">
                  {chartData.map((d, idx) => {
                    const heightPct = (Math.abs(d.value) / maxAbsChartValue) * 100;
                    const isCurrentMonth = d.index === selectedMonth;
                    return (
                      <div key={idx} className="flex-1 flex flex-col justify-center relative group">
                        <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-zinc-800 text-white text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-10 whitespace-nowrap">
                          {formatEuro(d.value)}
                        </div>
                        <div className="flex-1 flex items-end">
                          {d.value > 0 && (
                            <div className={`w-full rounded-t-sm transition-all ${isCurrentMonth ? 'bg-blue-500' : 'bg-green-500 hover:bg-green-400'}`} style={{ height: `${heightPct}%` }}></div>
                          )}
                        </div>
                        <div className="w-full h-px bg-zinc-300 my-0.5"></div>
                        <div className="h-6 flex items-start">
                          {d.value < 0 && (
                            <div className={`w-full rounded-b-sm transition-all ${isCurrentMonth ? 'bg-blue-500' : 'bg-red-500 hover:bg-red-400'}`} style={{ height: `${Math.min(heightPct, 100)}%` }}></div>
                          )}
                        </div>
                        <div className={`text-center text-[9px] uppercase mt-1 ${isCurrentMonth ? 'font-bold text-blue-600' : 'text-zinc-500'}`}>
                          {d.label}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <SectionCard title="Agenda (Prossimi 10 giorni)">
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-zinc-200 text-zinc-500 uppercase text-[10px] font-bold">
                  <tr>
                    <th className="py-2 pr-2">Data/Ora</th>
                    <th className="py-2 pr-2">Pax</th>
                    <th className="py-2 pr-2">Cliente</th>
                    <th className="py-2 pr-2 text-right">Stato</th>
                  </tr>
                </thead>
                <tbody>
                  {prossimePrenotazioni.map((booking) => {
                    const isToday = booking.booking_date === todayStr;
                    return (
                      <tr 
                        key={booking.id} 
                        className="group relative border-b border-zinc-100 transition hover:bg-zinc-50"
                      >
                        <td className="py-3 pr-2 whitespace-nowrap">
                          <div className={`font-bold ${isToday ? 'text-blue-700' : 'text-zinc-900'}`}>
                            {isToday ? "OGGI" : formatDate(booking.booking_date)}
                          </div>
                          <div className="text-[10px] text-zinc-500">
                            {booking.booking_time ? booking.booking_time.slice(0, 5) : "-"}
                          </div>
                        </td>
                        <td className="py-3 pr-2 whitespace-nowrap">
                          <div className="text-xs font-bold text-zinc-700">{booking.total_people}</div>
                        </td>
                        <td className="py-3 pr-2">
                          <div className="font-medium text-zinc-900 truncate max-w-[100px]">
                            {/* Link invisibile per evidenziare la riga nell'elenco */}
                            <Link 
                              href={`/prenotazioni?highlight=${booking.id}`} 
                              className="after:absolute after:inset-0"
                            >
                              {booking.customer_name}
                            </Link>
                          </div>
                          <div className="text-[10px] text-zinc-500 truncate max-w-[100px]">{booking.experience_name}</div>
                        </td>
                        
                        {/* CELLA STATO: 
                          Usiamo 'relative z-20' per far sì che questo link stia SOPRA 
                          al link invisibile della riga e rimanga cliccabile singolarmente.
                        */}
                        <td className="py-3 pr-2 text-right relative z-20">
                          <Link 
                            href={`/prenotazioni/${booking.id}/modifica`}
                            className={`inline-block rounded-lg px-2 py-1 text-[10px] font-bold uppercase transition hover:scale-105 active:scale-95 ${
                              booking.customer_payment_status === "paid" 
                                ? "bg-green-100 text-green-700" 
                                : "bg-red-100 text-red-700"
                            }`}
                          >
                            {booking.customer_payment_status === "paid" ? "Pagato" : "Incassa"}
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                  {prossimePrenotazioni.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-6 text-center text-xs text-zinc-500">
                        Nessun arrivo in programma nei prossimi 10 giorni.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </SectionCard>

          <SectionCard title="Prenotazioni per canale (Storico)">
            <div className="space-y-4 pt-2">
              {bookingsByChannel.map((item) => (
                <div key={item.channel} className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-zinc-800">{item.channel}</span>
                    <span className="font-bold text-zinc-900">{item.count}</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-100">
                    <div className="h-full rounded-full bg-zinc-800" style={{ width: `${(item.count / maxChannelCount) * 100}%` }}></div>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Esperienze più vendute (Pax Totali)">
            <div className="space-y-4 pt-2">
              {bookingsByExperience.map((item) => (
                <div key={item.name} className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-zinc-800 truncate pr-4">{item.name}</span>
                    <span className="font-bold text-zinc-900">{item.count} Pax</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-100">
                    <div className="h-full rounded-full bg-emerald-600" style={{ width: `${(item.count / maxExpPax) * 100}%` }}></div>
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