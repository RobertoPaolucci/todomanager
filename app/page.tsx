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
  // 1. Gestione parametri URL per la navigazione dei mesi
  const params = await searchParams;
  const today = new Date();
  
  // Mese 1-12 (se non passato, usa il mese corrente)
  const selectedMonth = params.m ? Number(params.m) : today.getMonth() + 1; 
  const selectedYear = params.y ? Number(params.y) : today.getFullYear();

  // Calcolo Mese Precedente
  const prevMonth = selectedMonth === 1 ? 12 : selectedMonth - 1;
  const prevYear = selectedMonth === 1 ? selectedYear - 1 : selectedYear;

  // Calcolo Mese Successivo
  const nextMonth = selectedMonth === 12 ? 1 : selectedMonth + 1;
  const nextYear = selectedMonth === 12 ? selectedYear + 1 : selectedYear;

  const nomeMese = getMonthName(selectedMonth - 1);
  
  // Ultimo giorno del mese selezionato
  const lastDayOfMonth = new Date(selectedYear, selectedMonth, 0).getDate();

  // Finestra temporale di 10 giorni per l'agenda
  const todayStr = today.toISOString().split("T")[0];
  const tenDaysFromNow = new Date(today);
  tenDaysFromNow.setDate(today.getDate() + 10);
  const tenDaysFromNowStr = tenDaysFromNow.toISOString().split("T")[0];

  // 2. Dati generali (Canali ecc.)
  const { bookingsByChannel } = await getDashboardStats();

  // Calcolo del valore massimo per proporzionare le barre dei canali
  const maxChannelCount = Math.max(...bookingsByChannel.map(c => c.count), 1);

  // 3. Scarichiamo le prenotazioni
  const { data: bookings, error } = await supabase
    .from("bookings")
    .select("*")
    .order("booking_date", { ascending: true });

  if (error) console.error("Errore caricamento prenotazioni:", error.message);
  const allBookings = bookings || [];

  // Variabili per il mese selezionato
  let meseEntrate = 0; // Totale a te
  let meseSpese = 0;   // Totale fornitori
  let meseTotale = 0;  // Margine netto
  const prossimePrenotazioni: any[] = [];

  allBookings.forEach((b) => {
    if (b.is_cancelled) return;

    if (b.booking_date) {
      const bDate = new Date(b.booking_date);
      
      // Calcolo Bilancio del mese selezionato
      if (bDate.getMonth() + 1 === selectedMonth && bDate.getFullYear() === selectedYear) {
        meseEntrate += Number(b.total_to_you || 0);
        meseSpese += Number(b.total_supplier_cost || 0);
        meseTotale += Number(b.margin_total || 0);
      }

      // Agenda: Solo le prenotazioni nei prossimi 10 giorni
      if (b.booking_date >= todayStr && b.booking_date <= tenDaysFromNowStr) {
        prossimePrenotazioni.push(b);
      }
    }
  });

  // 4. Preparazione Dati per il Grafico a Barre Economico (12 mesi dell'anno selezionato)
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
        
        {/* COLONNA SINISTRA: L'App Finanziaria e Grafico */}
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
              {/* Riga Totale */}
              <div className="flex items-center justify-between border-b border-zinc-100 pb-4">
                <span className="text-2xl font-bold text-zinc-900">Totale</span>
                <span className={`text-2xl font-bold ${meseTotale >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {formatEuro(meseTotale)}
                </span>
              </div>

              {/* Riga Entrate */}
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

              {/* Riga Spese */}
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

              {/* Grafico a Barre CSS (Bilancio) */}
              <div className="pt-6 mt-4 border-t border-dashed border-zinc-200">
                <div className="flex items-stretch justify-between h-32 gap-1 relative">
                  {chartData.map((d, idx) => {
                    const isPos = d.value >= 0;
                    const heightPct = (Math.abs(d.value) / maxAbsChartValue) * 100;
                    const isCurrentMonth = d.index === selectedMonth;

                    return (
                      <div key={idx} className="flex-1 flex flex-col justify-center relative group">
                        {/* Tooltip Hover (Valore del mese) */}
                        <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-zinc-800 text-white text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-10 whitespace-nowrap">
                          {formatEuro(d.value)}
                        </div>

                        {/* Barra Positiva */}
                        <div className="flex-1 flex items-end">
                          {isPos && (
                            <div 
                              className={`w-full rounded-t-sm transition-all ${isCurrentMonth ? 'bg-blue-500' : 'bg-green-500 hover:bg-green-400'}`} 
                              style={{ height: `${heightPct}%` }}
                            ></div>
                          )}
                        </div>
                        
                        {/* Linea Zero */}
                        <div className="w-full h-px bg-zinc-300 my-0.5"></div>
                        
                        {/* Barra Negativa */}
                        <div className="h-6 flex items-start">
                          {!isPos && (
                            <div 
                              className={`w-full rounded-b-sm transition-all ${isCurrentMonth ? 'bg-blue-500' : 'bg-red-500 hover:bg-red-400'}`} 
                              style={{ height: `${Math.min(heightPct, 100)}%` }}
                            ></div>
                          )}
                        </div>

                        {/* Etichetta Mese */}
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

        {/* COLONNA DESTRA: Agenda e Canali */}
        <div className="space-y-6">
          <SectionCard title="Agenda (Prossimi 10 giorni)">
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-zinc-200 text-zinc-500 uppercase text-[10px] font-bold">
                  <tr>
                    <th className="py-2 pr-2">Data/Ora</th>
                    <th className="py-2 pr-2">Cliente</th>
                    <th className="py-2 pr-2 text-right">Stato</th>
                  </tr>
                </thead>
                <tbody>
                  {prossimePrenotazioni.map((booking) => {
                    const isToday = booking.booking_date === todayStr;
                    const customerPaid = booking.customer_payment_status === "paid";

                    return (
                      <tr key={booking.id} className="border-b border-zinc-100">
                        <td className="py-3 pr-2 whitespace-nowrap">
                          <div className={`font-bold ${isToday ? 'text-blue-700' : 'text-zinc-900'}`}>
                            {isToday ? "OGGI" : formatDate(booking.booking_date)}
                          </div>
                          <div className="text-[10px] text-zinc-500">{booking.booking_time || "-"}</div>
                        </td>
                        <td className="py-3 pr-2">
                          <div className="font-medium text-zinc-900 truncate max-w-[120px]">{booking.customer_name}</div>
                          <div className="text-[10px] text-zinc-500 truncate max-w-[120px]">{booking.experience_name}</div>
                        </td>
                        <td className="py-3 pr-2 text-right">
                          <Link href={`/prenotazioni/${booking.id}/modifica`} className="inline-block">
                            <span className={`rounded-lg px-2 py-1 text-[10px] font-bold uppercase ${
                              customerPaid ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                            }`}>
                              {customerPaid ? "Pagato" : "Incassa"}
                            </span>
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                  {prossimePrenotazioni.length === 0 && (
                    <tr>
                      <td colSpan={3} className="py-6 text-center text-xs text-zinc-500">
                        Nessun arrivo in programma per i prossimi 10 giorni.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="mt-4 text-center">
              <Link href="/prenotazioni" className="text-xs font-semibold text-blue-600 hover:underline">
                Vedi tutte le prenotazioni
              </Link>
            </div>
          </SectionCard>

          <SectionCard title="Prenotazioni per canale (Storico)">
            {bookingsByChannel.length === 0 ? (
              <p className="text-sm text-zinc-600">Nessuna prenotazione disponibile.</p>
            ) : (
              <div className="space-y-4 pt-2">
                {bookingsByChannel.map((item) => {
                  const widthPct = (item.count / maxChannelCount) * 100;
                  return (
                    <div key={item.channel} className="space-y-1.5">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium text-zinc-800">{item.channel}</span>
                        <span className="font-bold text-zinc-900">{item.count}</span>
                      </div>
                      {/* Sfondo della barra */}
                      <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-100">
                        {/* Riempimento della barra animato */}
                        <div 
                          className="h-full rounded-full bg-zinc-800 transition-all duration-500 ease-out" 
                          style={{ width: `${widthPct}%` }}
                        ></div>
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