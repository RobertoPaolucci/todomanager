import Link from "next/link";
import Sidebar from "@/components/Sidebar";
import SectionCard from "@/components/SectionCard";
import { supabase } from "@/lib/supabase";
import { addSupplierPayment } from "../actions";

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
  params: Promise<{ id: string }>;
  searchParams: Promise<{ pay?: string }>;
};

export default async function DettaglioPagamentiFornitorePage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { pay } = await searchParams;
  const supplierId = Number(id);
  const showPayModal = pay === "true";

  const todayObj = new Date();
  const todayStr = todayObj.toISOString().split("T")[0];

  const [supplierRes, bookingsRes, paymentsRes] = await Promise.all([
    supabase.from("suppliers").select("*").eq("id", supplierId).single(),
    supabase.from("bookings").select("*").eq("supplier_id", supplierId).order("booking_date", { ascending: true }),
    supabase.from("supplier_payments").select("*").eq("supplier_id", supplierId),
  ]);

  if (supplierRes.error || !supplierRes.data) throw new Error("Fornitore non trovato");

  const supplier = supplierRes.data;
  const bookings = bookingsRes.data || [];
  const payments = paymentsRes.data || [];

  // REGOLE FORNITORE INTERNO
  const isInternal = supplier.name.includes("Fattoria Madonna della Querce");

  // 1. Calcolo totale dei pagamenti effettuati
  const totalPagato = payments.reduce((sum, p) => sum + Number(p.amount), 0);

  // 2. Calcolo "a cascata" per coprire le prenotazioni più vecchie
  let remainingPayment = totalPagato;
  let costoTotaleMaturato = 0;
  let daPagareFuturo = 0;

  const decoratedBookings = bookings.map((b) => {
    const costo = Number(b.total_supplier_cost || 0);
    let coperto = 0;

    if (!b.is_cancelled) {
      if (b.booking_date && b.booking_date <= todayStr) {
        costoTotaleMaturato += costo;
      } else {
        daPagareFuturo += costo;
      }

      // Se è interno, risulta sempre pagato per intero
      if (isInternal) {
        coperto = costo;
      } else {
        if (remainingPayment >= costo) {
          coperto = costo;
          remainingPayment -= costo;
        } else if (remainingPayment > 0) {
          coperto = remainingPayment;
          remainingPayment = 0;
        }
      }
    }

    return { ...b, costo, coperto };
  });

  // Ordiniamo le prenotazioni dalla più recente alla più vecchia per la tabella
  const displayBookings = [...decoratedBookings].sort(
    (a, b) => new Date(b.booking_date).getTime() - new Date(a.booking_date).getTime()
  );

  // Ordiniamo i pagamenti dal più recente al più vecchio
  const displayPayments = [...payments].sort(
    (a, b) => new Date(b.payment_date).getTime() - new Date(a.payment_date).getTime()
  );

  // Se è interno, forziamo i debiti a zero
  const daPagareOggi = isInternal ? 0 : Math.max(0, costoTotaleMaturato - totalPagato);
  if (isInternal) daPagareFuturo = 0;

  return (
    <main className="min-h-screen bg-zinc-50 p-6">
      <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[260px_1fr]">
        <Sidebar />

        <div className="space-y-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <div className="mb-2">
                <Link href="/pagamenti" className="text-sm font-medium text-zinc-500 hover:text-zinc-800 transition">
                  ← Torna a Pagamenti
                </Link>
              </div>
              <div className="flex items-center gap-3">
                <h1 className="text-3xl font-bold text-zinc-900">{supplier.name}</h1>
                {isInternal && (
                  <span className="rounded-lg bg-emerald-100 text-emerald-800 px-2 py-1 text-xs font-bold uppercase tracking-tight">
                    Azienda Interna
                  </span>
                )}
              </div>
              <p className="mt-1 text-zinc-600">Dettaglio prenotazioni e stato pagamenti</p>
            </div>

            <div className="flex flex-wrap gap-3">
              <div className="flex-1 rounded-xl border border-amber-200 bg-amber-50 px-6 py-4 text-right shadow-sm min-w-[160px]">
                <span className="block text-sm font-medium text-amber-800">Prossimi (Futuri)</span>
                <span className="text-xl font-bold text-amber-700">{formatEuro(daPagareFuturo)}</span>
              </div>
              
              {isInternal ? (
                <div className="flex-1 rounded-xl border border-emerald-200 bg-emerald-50 px-6 py-4 text-right shadow-sm min-w-[160px]">
                  <span className="block text-sm font-bold text-emerald-800">Stato Pagamenti</span>
                  <span className="text-2xl font-black text-emerald-700">Pareggiato</span>
                  <div className="mt-1 text-xs text-emerald-600 font-medium">
                    Gestione contabile interna
                  </div>
                </div>
              ) : (
                <Link 
                  href={`/pagamenti/${supplierId}?pay=true`}
                  className="flex-1 rounded-xl border border-red-200 bg-red-50 px-6 py-4 text-right shadow-sm min-w-[160px] transition hover:bg-red-100 hover:border-red-300 group cursor-pointer"
                >
                  <span className="block text-sm font-bold text-red-800">Da Saldare (Scaduti/Oggi)</span>
                  <span className="text-2xl font-black text-red-700">{formatEuro(daPagareOggi)}</span>
                  <div className="mt-1 text-xs text-red-600 group-hover:text-red-800 font-medium">
                    + Registra Pagamento
                  </div>
                </Link>
              )}
            </div>
          </div>

          <SectionCard title="Elenco Movimenti (Riconciliazione Automatica)">
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-zinc-200 text-zinc-500 uppercase text-[10px] font-bold">
                  <tr>
                    <th className="py-3 pr-4">Data Exp</th>
                    <th className="py-3 pr-4">Cliente / Rif.</th>
                    <th className="py-3 pr-4">Esperienza</th>
                    <th className="py-3 pr-4">Importo</th>
                    <th className="py-3 pr-4">Stato Calcolato</th>
                    <th className="py-3 pr-4 text-right">Azioni</th>
                  </tr>
                </thead>
                <tbody>
                  {displayBookings.map((booking) => {
                    const isCancelled = booking.is_cancelled === true;
                    const isFuture = booking.booking_date && booking.booking_date > todayStr;
                    
                    const isFullyPaid = booking.coperto === booking.costo;
                    const isPartial = booking.coperto > 0 && booking.coperto < booking.costo;

                    return (
                      <tr key={booking.id} className={`border-b border-zinc-100 transition hover:bg-zinc-50 ${isCancelled ? 'opacity-50 bg-zinc-50/50' : ''}`}>
                        <td className="py-4 pr-4 whitespace-nowrap">
                          <span className={`font-medium ${isFuture && !isFullyPaid && !isCancelled && !isInternal ? 'text-amber-600' : 'text-zinc-900'}`}>
                            {formatDate(booking.booking_date)}
                          </span>
                        </td>
                        <td className="py-4 pr-4">
                          <div className="font-medium text-zinc-900">{booking.customer_name}</div>
                          <div className="text-xs text-zinc-500 font-mono">{booking.booking_reference || `#${booking.id}`}</div>
                        </td>
                        <td className="py-4 pr-4 text-zinc-700">
                          {booking.experience_name}
                          {isCancelled && <span className="ml-2 inline-block text-[10px] font-bold uppercase text-red-600">Cancellata</span>}
                        </td>
                        <td className="py-4 pr-4">
                          <div className="font-bold text-zinc-900">{formatEuro(booking.costo)}</div>
                          {isPartial && !isCancelled && !isInternal && (
                            <div className="text-[11px] font-medium text-blue-600 mt-0.5">
                              Coperti: {formatEuro(booking.coperto)}
                            </div>
                          )}
                        </td>
                        <td className="py-4 pr-4">
                          <span className={`rounded-lg px-2 py-1 text-[10px] font-bold uppercase ${
                            isCancelled ? "bg-zinc-200 text-zinc-500" :
                            isInternal  ? "bg-emerald-100 text-emerald-700" :
                            isFullyPaid ? "bg-green-100 text-green-700" :
                            isPartial   ? "bg-blue-100 text-blue-700" :
                            isFuture    ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"
                          }`}>
                            {isCancelled ? "Annullato" : isInternal ? "Auto-Saldato" : isFullyPaid ? "Pagato" : isPartial ? "Parziale" : isFuture ? "Futuro" : "Da Saldare"}
                          </span>
                        </td>
                        <td className="py-4 pr-4 text-right">
                          <Link
                            href={`/prenotazioni/${booking.id}/modifica?viewOnly=true&returnTo=/pagamenti/${supplierId}`}
                            className="rounded-lg border border-zinc-300 px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-100 transition"
                          >
                            Apri
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                  {displayBookings.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-zinc-500">
                        Nessuna prenotazione trovata per questo fornitore.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </SectionCard>

          {!isInternal && (
            <SectionCard title="Storico Pagamenti Effettuati">
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b border-zinc-200 text-zinc-500 uppercase text-[10px] font-bold">
                    <tr>
                      <th className="py-3 pr-4">Data Pagamento</th>
                      <th className="py-3 pr-4">Importo</th>
                      <th className="py-3 pr-4">Metodo</th>
                      <th className="py-3 pr-4">Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayPayments.map((payment) => (
                      <tr key={payment.id} className="border-b border-zinc-100 transition hover:bg-zinc-50">
                        <td className="py-4 pr-4 font-medium text-zinc-900 whitespace-nowrap">
                          {formatDate(payment.payment_date)}
                        </td>
                        <td className="py-4 pr-4 font-bold text-green-700">
                          {formatEuro(Number(payment.amount))}
                        </td>
                        <td className="py-4 pr-4">
                          <span className="rounded-lg bg-zinc-100 px-2 py-1 text-[10px] font-bold uppercase text-zinc-700">
                            {payment.payment_method}
                          </span>
                        </td>
                        <td className="py-4 pr-4 text-xs text-zinc-600">
                          {payment.notes || "-"}
                        </td>
                      </tr>
                    ))}
                    {displayPayments.length === 0 && (
                      <tr>
                        <td colSpan={4} className="py-8 text-center text-zinc-500">
                          Ancora nessun pagamento registrato per questo fornitore.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          )}
        </div>
      </div>

      {/* Finestra Modale Pagamento (Nascosta se è interno) */}
      {showPayModal && !isInternal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
            <h2 className="text-xl font-bold text-zinc-900 mb-4">Registra Pagamento</h2>
            <form action={addSupplierPayment} className="space-y-4">
              <input type="hidden" name="supplier_id" value={supplierId} />
              
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Importo (€)</label>
                <input 
                  type="number" 
                  step="0.01" 
                  name="amount" 
                  defaultValue={daPagareOggi > 0 ? daPagareOggi.toFixed(2) : ""} 
                  required 
                  className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none focus:border-zinc-500" 
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Data Pagamento</label>
                <input 
                  type="date" 
                  name="payment_date" 
                  defaultValue={todayStr} 
                  required 
                  className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none focus:border-zinc-500" 
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Metodo di pagamento</label>
                <select 
                  name="payment_method" 
                  className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none focus:border-zinc-500 bg-white"
                >
                  <option value="Bonifico">Bonifico Bancario</option>
                  <option value="Carta di Credito">Carta di Credito</option>
                  <option value="Contanti">Contanti</option>
                  <option value="Altro">Altro</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Note (Opzionale)</label>
                <input 
                  type="text" 
                  name="notes" 
                  placeholder="Es. CRO bonifico, acconto mese..." 
                  className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none focus:border-zinc-500" 
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 mt-2 border-t border-zinc-100">
                <Link 
                  href={`/pagamenti/${supplierId}`} 
                  className="rounded-xl border border-zinc-300 px-5 py-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50 transition flex items-center"
                >
                  Annulla
                </Link>
                <button 
                  type="submit" 
                  className="rounded-xl bg-zinc-900 px-5 py-3 text-sm font-medium text-white hover:bg-zinc-700 transition"
                >
                  Salva Pagamento
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}