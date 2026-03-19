export const dynamic = "force-dynamic";

import Link from "next/link";
import Sidebar from "@/components/Sidebar";
import SectionCard from "@/components/SectionCard";
import { supabase } from "@/lib/supabase";
import { cancelBooking } from "./actions";

function formatEuro(value: number) {
  return new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR",
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

type PageProps = {
  searchParams: Promise<{
    q?: string;
    sort?: string;
    dir?: string;
    past?: string;
    highlight?: string;
    from?: string;
    to?: string;
  }>;
};

export default async function PrenotazioniPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const q = params.q || "";
  const sort = params.sort || "booking_date";
  const dir = params.dir || "asc";
  const showPast = params.past === "true";
  const highlightId = params.highlight || "";
  const fromDate = params.from || "";
  const toDate = params.to || "";

  // Date di riferimento per pulsanti e logica
  const now = new Date();
  const todayStr = now.toISOString().split("T")[0];
  
  const tomorrowObj = new Date();
  tomorrowObj.setDate(tomorrowObj.getDate() + 1);
  const tomorrowStr = tomorrowObj.toISOString().split("T")[0];

  const firstDayMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
  const lastDayMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split("T")[0];

  // Recupero dati (manteniamo la struttura esistente)
  const { data: bookings, error } = await supabase
    .from("bookings")
    .select("*, suppliers(phone)");

  if (error) {
    console.error("Errore caricamento prenotazioni:", error.message);
  }

  let allBookings = bookings || [];

  // LOGICA FILTRAGGIO BLINDATA
  allBookings = allBookings.filter((b) => {
    // 1. Sempre visibile se evidenziata (es. dopo modifica)
    if (String(b.id) === highlightId) return true;

    // 2. Filtro per data (Calendario o "Mostra Passate")
    if (b.booking_date) {
      // Se l'utente ha scelto un range specifico, usiamo quello
      if (fromDate && b.booking_date < fromDate) return false;
      if (toDate && b.booking_date > toDate) return false;

      // Se non c'è un range e "showPast" è off, nascondi il passato
      if (!fromDate && !toDate && !showPast && b.booking_date < todayStr) {
        return false;
      }
    }

    // 3. Ricerca testuale
    if (q) {
      const term = q.toLowerCase();
      const match =
        (b.customer_name || "").toLowerCase().includes(term) ||
        (b.booking_reference || "").toLowerCase().includes(term) ||
        (b.experience_name || "").toLowerCase().includes(term) ||
        (b.booking_source || "").toLowerCase().includes(term);
      
      if (!match) return false;
    }

    return true;
  });

  // Ordinamento
  allBookings.sort((a, b) => {
    let valA: any = a[sort as keyof typeof a] || "";
    let valB: any = b[sort as keyof typeof b] || "";

    if (["total_customer", "total_supplier_cost", "total_people"].includes(sort)) {
      valA = Number(valA);
      valB = Number(valB);
    }

    if (valA < valB) return dir === "asc" ? -1 : 1;
    if (valA > valB) return dir === "asc" ? 1 : -1;
    return 0;
  });

  const buildSortUrl = (column: string) => {
    const newDir = sort === column && dir === "asc" ? "desc" : "asc";
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (showPast) sp.set("past", "true");
    if (fromDate) sp.set("from", fromDate);
    if (toDate) sp.set("to", toDate);
    sp.set("sort", column);
    sp.set("dir", newDir);
    return `?${sp.toString()}`;
  };

  const SortIcon = ({ column }: { column: string }) => {
    if (sort !== column) return null;
    return <span className="ml-1 text-zinc-900">{dir === "asc" ? "↑" : "↓"}</span>;
  };

  return (
    <main className="min-h-screen bg-zinc-50 p-6">
      <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[260px_1fr]">
        <Sidebar />

        <div className="space-y-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-3xl font-bold text-zinc-900">Prenotazioni</h1>
            </div>
            
            <div className="flex gap-3">
              <Link 
                href="/prenotazioni/import" 
                className="flex items-center gap-2 rounded-xl bg-white border-2 border-zinc-200 px-4 py-2 text-sm font-bold text-zinc-700 hover:bg-zinc-50 hover:border-zinc-300 transition shadow-sm"
              >
                ⚙️ Strumenti Dati
              </Link>

              <Link 
                href="/prenotazioni/nuova" 
                className="flex items-center gap-2 rounded-xl bg-zinc-900 px-4 py-2 text-sm font-bold text-white hover:bg-zinc-700 transition shadow-sm"
              >
                + Nuova Prenotazione
              </Link>
            </div>
          </div>

          <SectionCard title="Ricerca e Filtri">
            <div className="space-y-4">
              {/* RIGA 1: RICERCA E PASSATE */}
              <form method="GET" className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <input type="hidden" name="sort" value={sort} />
                <input type="hidden" name="dir" value={dir} />
                <input type="hidden" name="from" value={fromDate} />
                <input type="hidden" name="to" value={toDate} />
                
                <div className="flex w-full max-w-md items-center overflow-hidden rounded-xl border border-zinc-300 bg-white focus-within:border-zinc-500 transition">
                  <div className="pl-3 text-zinc-400">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                    </svg>
                  </div>
                  <input
                    type="text"
                    name="q"
                    defaultValue={q}
                    placeholder="Cerca cliente, riferimento..."
                    className="w-full border-none px-3 py-2.5 outline-none text-sm"
                  />
                  <button type="submit" className="bg-zinc-100 px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-200 border-l border-zinc-200">
                    Cerca
                  </button>
                </div>

                <div className="flex gap-2">
                  <Link
                    href={`?q=${q}&sort=${sort}&dir=${dir}&past=${showPast ? "false" : "true"}`}
                    className={`inline-flex items-center justify-center rounded-xl border px-4 py-2.5 text-sm font-medium transition ${
                      showPast ? "border-blue-200 bg-blue-50 text-blue-700" : "border-zinc-300 bg-white text-zinc-700"
                    }`}
                  >
                    {showPast ? "👁 Nascondi Passate" : "🕒 Mostra Passate"}
                  </Link>
                  {(fromDate || toDate || q) && (
                    <Link href="/prenotazioni" className="text-zinc-500 text-xs flex items-center hover:underline">
                      Reset filtri
                    </Link>
                  )}
                </div>
              </form>

              {/* RIGA 2: CALENDARIO E BOTTONI RAPIDI */}
              <div className="flex flex-col gap-4 border-t border-zinc-100 pt-4 lg:flex-row lg:items-end">
                <form method="GET" className="flex flex-wrap items-end gap-3">
                  <input type="hidden" name="q" value={q} />
                  <input type="hidden" name="sort" value={sort} />
                  <input type="hidden" name="dir" value={dir} />
                  
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Dal</label>
                    <input 
                      type="date" 
                      name="from" 
                      defaultValue={fromDate} 
                      className="rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Al</label>
                    <input 
                      type="date" 
                      name="to" 
                      defaultValue={toDate} 
                      className="rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
                    />
                  </div>
                  <button type="submit" className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-bold text-white hover:bg-zinc-700 transition">
                    Applica Date
                  </button>
                </form>

                <div className="flex flex-wrap gap-2">
                  <Link 
                    href={`?from=${todayStr}&to=${todayStr}`}
                    className="rounded-lg bg-white border border-zinc-200 px-3 py-2 text-[11px] font-bold text-zinc-600 hover:bg-zinc-50 shadow-sm"
                  >
                    Oggi
                  </Link>
                  <Link 
                    href={`?from=${tomorrowStr}&to=${tomorrowStr}`}
                    className="rounded-lg bg-white border border-zinc-200 px-3 py-2 text-[11px] font-bold text-zinc-600 hover:bg-zinc-50 shadow-sm"
                  >
                    Domani
                  </Link>
                  <Link 
                    href={`?from=${firstDayMonth}&to=${lastDayMonth}`}
                    className="rounded-lg bg-white border border-zinc-200 px-3 py-2 text-[11px] font-bold text-zinc-600 hover:bg-zinc-50 shadow-sm"
                  >
                    Questo Mese
                  </Link>
                  <Link 
                    href={`?from=2026-01-01&to=2026-12-31`}
                    className="rounded-lg bg-zinc-100 border border-zinc-300 px-3 py-2 text-[11px] font-bold text-zinc-800 hover:bg-zinc-200 shadow-sm"
                  >
                    Tutto 2026
                  </Link>
                </div>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Elenco Dettagliato">
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-zinc-200 text-zinc-500 uppercase text-[10px] font-bold">
                  <tr>
                    <th className="py-3 pr-4 transition hover:text-zinc-900 cursor-pointer">
                      <Link href={buildSortUrl("booking_date")} className="flex items-center">
                        Data / Ora <SortIcon column="booking_date" />
                      </Link>
                    </th>
                    <th className="py-3 pr-4 transition hover:text-zinc-900 cursor-pointer">
                      <Link href={buildSortUrl("customer_name")} className="flex items-center">
                        Cliente / Rif. <SortIcon column="customer_name" />
                      </Link>
                    </th>
                    <th className="py-3 pr-4 transition hover:text-zinc-900 cursor-pointer">
                      <Link href={buildSortUrl("booking_source")} className="flex items-center">
                        Canale / Esperienza <SortIcon column="booking_source" />
                      </Link>
                    </th>
                    <th className="py-3 pr-4 transition hover:text-zinc-900 cursor-pointer">
                      Lordo <SortIcon column="total_customer" />
                    </th>
                    <th className="py-3 pr-4">Pag. Agenzia</th>
                    <th className="py-3 pr-4">Pag. Fornitore</th>
                    <th className="py-3 pr-4 text-right">Azioni</th>
                  </tr>
                </thead>
                <tbody>
                  {allBookings.map((booking) => {
                    const isCancelled = booking.is_cancelled === true;
                    const isHighlighted = String(booking.id) === highlightId;

                    const customerStatus = booking.customer_payment_status;
                    let customerBadgeClass = "bg-red-100 text-red-700";
                    let customerBadgeText = "Da Incassare";
                    if (customerStatus === "paid") {
                      customerBadgeClass = "bg-green-100 text-green-700";
                      customerBadgeText = "Incassato";
                    } else if (customerStatus === "partial") {
                      customerBadgeClass = "bg-blue-100 text-blue-700";
                      customerBadgeText = "Acconto";
                    }

                    const costoFornitore = Number(booking.total_supplier_cost || 0);
                    const pagatoFornitore = Number(booking.supplier_amount_paid || 0);
                    const isSupplierPaid = booking.supplier_payment_status === "paid" || (pagatoFornitore > 0 && pagatoFornitore >= costoFornitore);
                    const isSupplierPartial = pagatoFornitore > 0 && pagatoFornitore < costoFornitore && booking.supplier_payment_status !== "paid";
                    
                    let supplierBadgeClass = "bg-red-100 text-red-700";
                    let supplierBadgeText = "Da Saldare";
                    if (isSupplierPaid) {
                      supplierBadgeClass = "bg-green-100 text-green-700";
                      supplierBadgeText = "Pagato";
                    } else if (isSupplierPartial) {
                      supplierBadgeClass = "bg-blue-100 text-blue-700";
                      supplierBadgeText = "Parziale";
                    }

                    const wPax = Number(booking.adults || 0) + Number(booking.children || 0);
                    const wDate = formatDate(booking.booking_date);
                    const wTime = booking.booking_time ? booking.booking_time.slice(0, 5) : "Orario da def.";
                    const wChannel = booking.booking_source || "N/A";
                    const wRef = booking.booking_reference || "N/A";
                    const wName = booking.customer_name || "N/A";
                    const waText = `${wPax} da te ${wDate} ore ${wTime} ${wChannel} ${wRef} ${wName}`;
                    
                    const rawSupplier = booking.suppliers;
                    let rawPhone = "";
                    if (Array.isArray(rawSupplier)) {
                      rawPhone = rawSupplier[0]?.phone || "";
                    } else if (rawSupplier) {
                      rawPhone = rawSupplier.phone || "";
                    }
                    const cleanPhone = rawPhone.replace(/\D/g, ""); 
                    const waUrl = cleanPhone 
                      ? `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(waText)}`
                      : `https://api.whatsapp.com/send?text=${encodeURIComponent(waText)}`;

                    let dateColorClass = "text-zinc-900";
                    let isToday = false;
                    let isTomorrow = false;
                    if (isCancelled) {
                      dateColorClass = "text-zinc-500 line-through";
                    } else if (booking.booking_date === todayStr) {
                      dateColorClass = "text-green-600";
                      isToday = true;
                    } else if (booking.booking_date === tomorrowStr) {
                      dateColorClass = "text-orange-500";
                      isTomorrow = true;
                    }

                    return (
                      <tr 
                        key={booking.id} 
                        className={`border-b border-zinc-100 transition duration-500 ${
                          isHighlighted 
                            ? 'bg-amber-50 ring-2 ring-inset ring-amber-200' 
                            : isCancelled ? 'bg-zinc-50/50' : 'hover:bg-zinc-50'
                        }`}
                      >
                        <td className="py-4 pr-4 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <div className={`font-bold ${dateColorClass}`}>
                              {formatDate(booking.booking_date)}
                              {isToday && <span className="ml-1 text-[9px] uppercase font-black">Oggi</span>}
                              {isTomorrow && <span className="ml-1 text-[9px] uppercase font-black">Dom</span>}
                            </div>
                            {booking.booking_time && (
                              <div className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${isCancelled ? 'bg-zinc-200 text-zinc-400' : 'bg-blue-50 text-blue-700'}`}>
                                {booking.booking_time.slice(0, 5)}
                              </div>
                            )}
                          </div>
                          <div className="text-[10px] text-zinc-400 font-medium mt-1">
                            Ins: {formatDate(booking.booking_created_at)}
                          </div>
                        </td>
                        
                        <td className="py-4 pr-4">
                          <div className={`font-medium ${isCancelled ? 'text-zinc-500 line-through' : 'text-zinc-900'}`}>
                            {booking.customer_name}
                          </div>
                          <div className="text-[10px] text-zinc-500 font-mono mt-0.5">
                            {booking.booking_reference || "-"}
                          </div>
                        </td>
                        
                        <td className="py-4 pr-4">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="inline-block rounded bg-zinc-100 border border-zinc-200 px-1.5 py-0.5 text-[10px] font-bold text-zinc-600">
                              {booking.booking_source || "-"}
                            </span>
                            <span className="text-[10px] font-medium text-zinc-500">{wPax} Pax</span>
                          </div>
                          <div className="text-xs font-medium text-zinc-700 truncate max-w-[150px]">{booking.experience_name}</div>
                        </td>
                        
                        <td className="py-4 pr-4">
                          <div className="font-bold text-zinc-900">{formatEuro(Number(booking.total_customer || 0))}</div>
                        </td>
                        
                        <td className="py-4 pr-4">
                          <span className={`rounded-lg px-2 py-1 text-[10px] font-bold uppercase ${isCancelled ? 'bg-zinc-200 text-zinc-400' : customerBadgeClass}`}>
                            {isCancelled ? "-" : customerBadgeText}
                          </span>
                        </td>

                        <td className="py-4 pr-4">
                          <span className={`rounded-lg px-2 py-1 text-[10px] font-bold uppercase ${isCancelled ? 'bg-zinc-200 text-zinc-400' : supplierBadgeClass}`}>
                            {isCancelled ? "-" : supplierBadgeText}
                          </span>
                        </td>
                        
                        <td className="py-4 pr-4 text-right">
                          {!isCancelled && !cleanPhone && <div className="text-[9px] font-bold text-red-500 mb-1.5 pr-1">Manca numero!</div>}
                          {!isCancelled && cleanPhone && <div className="text-[9px] font-medium text-zinc-400 mb-1.5 pr-1">Tel: +{cleanPhone}</div>}

                          <div className="flex items-center justify-end gap-2">
                            <Link
                              href={`/prenotazioni/${booking.id}/modifica`}
                              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100 shadow-sm"
                            >
                              Modifica
                            </Link>
                            {!isCancelled && (
                              <a href={waUrl} target="_blank" rel="noopener noreferrer" className={`rounded-lg border px-3 py-2 text-[11px] font-bold transition shadow-sm ${cleanPhone ? 'border-green-200 bg-green-50 text-green-700 hover:bg-green-100' : 'border-zinc-200 bg-zinc-50 text-zinc-400 hover:bg-zinc-100'}`}>
                                WA
                              </a>
                            )}
                            {!isCancelled && (
                              <form action={cancelBooking} className="inline-block">
                                <input type="hidden" name="id" value={booking.id} />
                                <button type="submit" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-bold text-red-700 hover:bg-red-100 shadow-sm">
                                  Cancella
                                </button>
                              </form>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </div>
      </div>
    </main>
  );
}