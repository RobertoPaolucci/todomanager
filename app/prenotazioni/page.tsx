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
  }>;
};

export default async function PrenotazioniPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const q = params.q || "";
  const sort = params.sort || "booking_date";
  const dir = params.dir || "asc";
  const showPast = params.past === "true";

  const todayStr = new Date().toISOString().split("T")[0];

  const { data: bookings, error } = await supabase.from("bookings").select("*");

  if (error) {
    console.error("Errore caricamento prenotazioni:", error.message);
  }

  let allBookings = bookings || [];

  allBookings = allBookings.filter((b) => {
    if (!showPast && b.booking_date && b.booking_date < todayStr) {
      return false;
    }

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
    const searchParams = new URLSearchParams();
    if (q) searchParams.set("q", q);
    if (showPast) searchParams.set("past", "true");
    searchParams.set("sort", column);
    searchParams.set("dir", newDir);
    return `?${searchParams.toString()}`;
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
              <p className="mt-1 text-zinc-600">
                Gestisci le prenotazioni, filtra e comunica con i fornitori
              </p>
            </div>
            
            <Link
              href="/prenotazioni/nuova"
              className="inline-flex items-center justify-center rounded-xl bg-zinc-900 px-5 py-3 text-sm font-medium text-white transition hover:bg-zinc-700 shadow-sm"
            >
              + Nuova prenotazione
            </Link>
          </div>

          {/* FIX: Aggiunto il 'title' obbligatorio al SectionCard */}
          <SectionCard title="Ricerca e Filtri">
            <form method="GET" className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <input type="hidden" name="sort" value={sort} />
              <input type="hidden" name="dir" value={dir} />
              {showPast && <input type="hidden" name="past" value="true" />}
              
              <div className="flex w-full max-w-md items-center overflow-hidden rounded-xl border border-zinc-300 bg-white focus-within:border-zinc-500 focus-within:ring-1 focus-within:ring-zinc-500 transition">
                <div className="pl-3 text-zinc-400">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                  </svg>
                </div>
                <input
                  type="text"
                  name="q"
                  defaultValue={q}
                  placeholder="Cerca cliente, riferimento, esperienza..."
                  className="w-full border-none px-3 py-2.5 outline-none text-sm placeholder:text-zinc-400"
                />
                <button type="submit" className="bg-zinc-100 px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-200 border-l border-zinc-200 transition">
                  Cerca
                </button>
              </div>

              <div className="flex gap-2">
                {q && (
                  <Link href={`?sort=${sort}&dir=${dir}${showPast ? '&past=true' : ''}`} className="inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50 transition">
                    X Rimuovi filtri
                  </Link>
                )}
                <Link
                  href={`?q=${q}&sort=${sort}&dir=${dir}&past=${showPast ? "false" : "true"}`}
                  className={`inline-flex items-center justify-center rounded-xl border px-4 py-2.5 text-sm font-medium transition ${
                    showPast 
                      ? "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100" 
                      : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"
                  }`}
                >
                  {showPast ? "👁 Nascondi Passate" : "🕒 Mostra Passate"}
                </Link>
              </div>
            </form>
          </SectionCard>

          <SectionCard title="Elenco Dettagliato">
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-zinc-200 text-zinc-500 uppercase text-[10px] font-bold">
                  <tr>
                    <th className="py-3 pr-4 transition hover:text-zinc-900 cursor-pointer">
                      <Link href={buildSortUrl("booking_date")} className="flex items-center">
                        Data Exp <SortIcon column="booking_date" />
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
                      <Link href={buildSortUrl("total_customer")} className="flex items-center">
                        Lordo Agenzia <SortIcon column="total_customer" />
                      </Link>
                    </th>
                    <th className="py-3 pr-4 transition hover:text-zinc-900 cursor-pointer">
                      <Link href={buildSortUrl("customer_payment_status")} className="flex items-center">
                        Pag. Agenzia <SortIcon column="customer_payment_status" />
                      </Link>
                    </th>
                    <th className="py-3 pr-4 transition hover:text-zinc-900 cursor-pointer">
                      <Link href={buildSortUrl("supplier_payment_status")} className="flex items-center">
                        Pag. Fornitore <SortIcon column="supplier_payment_status" />
                      </Link>
                    </th>
                    <th className="py-3 pr-4 text-right">Azioni</th>
                  </tr>
                </thead>
                <tbody>
                  {allBookings.map((booking) => {
                    const isCancelled = booking.is_cancelled === true;
                    
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

                    // Testo WhatsApp: "2 da te 17/05/2026 ore 10:00 viator 1373597293 nome"
                    const wPax = Number(booking.adults || 0) + Number(booking.children || 0);
                    const wDate = formatDate(booking.booking_date);
                    const wTime = booking.booking_time ? booking.booking_time.slice(0, 5) : "Orario da def.";
                    const wChannel = booking.booking_source || "N/A";
                    const wRef = booking.booking_reference || "N/A";
                    const wName = booking.customer_name || "N/A";
                    
                    const waText = `${wPax} da te ${wDate} ore ${wTime} ${wChannel} ${wRef} ${wName}`;
                    const waUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(waText)}`;

                    return (
                      <tr 
                        key={booking.id} 
                        className={`border-b border-zinc-100 transition hover:bg-zinc-50 ${isCancelled ? 'bg-zinc-50/50' : ''}`}
                      >
                        <td className="py-4 pr-4 whitespace-nowrap">
                          <div className={`font-bold ${isCancelled ? 'text-zinc-500 line-through' : 'text-zinc-900'}`}>
                            {formatDate(booking.booking_date)}
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
                          {isCancelled && (
                            <span className="inline-block mt-1 text-[9px] font-bold uppercase text-red-600 bg-red-50 px-1.5 py-0.5 rounded">
                              Cancellata
                            </span>
                          )}
                        </td>
                        
                        <td className="py-4 pr-4">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="inline-block rounded bg-zinc-100 border border-zinc-200 px-1.5 py-0.5 text-[10px] font-bold text-zinc-600">
                              {booking.booking_source || "-"}
                            </span>
                            <span className="text-[10px] font-medium text-zinc-500">
                              {wPax} Pax
                            </span>
                          </div>
                          <div className={`text-xs font-medium ${isCancelled ? 'text-zinc-400' : 'text-zinc-700'}`}>
                            {booking.experience_name}
                          </div>
                        </td>
                        
                        <td className="py-4 pr-4">
                          <div className={`font-bold ${isCancelled ? 'text-zinc-400 line-through' : 'text-zinc-900'}`}>
                            {formatEuro(Number(booking.total_customer || 0))}
                          </div>
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
                          <div className="flex items-center justify-end gap-2">
                            <Link
                              href={`/prenotazioni/${booking.id}/modifica`}
                              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100 hover:text-blue-600 transition shadow-sm"
                            >
                              Modifica
                            </Link>

                            {!isCancelled && (
                              <a
                                href={waUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-[11px] font-bold text-green-700 hover:bg-green-100 transition shadow-sm"
                              >
                                WA
                              </a>
                            )}

                            {!isCancelled && (
                              <form action={cancelBooking} className="inline-block">
                                <input type="hidden" name="id" value={booking.id} />
                                <button
                                  type="submit"
                                  className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-bold text-red-700 hover:bg-red-100 transition shadow-sm"
                                >
                                  Cancella
                                </button>
                              </form>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}

                  {allBookings.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-zinc-500">
                        Nessuna prenotazione trovata per i criteri selezionati.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </div>
      </div>
    </main>
  );
}