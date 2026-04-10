export const dynamic = "force-dynamic";
export const revalidate = 0;

import Link from "next/link";
import Sidebar from "@/components/Sidebar";
import SectionCard from "@/components/SectionCard";
import { supabaseServer } from "@/lib/supabase-server";
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

function getBookingPaidAmount(booking: any, isInternal: boolean) {
  const costo = Number(booking.total_supplier_cost || 0);

  if (booking.is_cancelled) return 0;
  if (isInternal) return costo;
  if (booking.supplier_payment_status === "paid") return costo;

  const rawPaid = Number(booking.supplier_amount_paid || 0);
  return Math.max(0, Math.min(rawPaid, costo));
}

const PAYMENT_METHOD_OPTIONS = [
  "Bonifico Bancario",
  "Carta di Credito",
  "Contanti",
  "POS",
  "PayPal",
  "Stripe",
  "Satispay",
  "Assegno",
  "Compensazione",
  "Altro",
];

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ pay?: string; q?: string }>;
};

export default async function DettaglioPagamentiFornitorePage({
  params,
  searchParams,
}: PageProps) {
  const { id } = await params;
  const sp = await searchParams;

  const supplierId = Number(id);
  const showPayModal = sp.pay === "true";
  const q = String(sp.q || "").trim();
  const qLower = q.toLowerCase();

  const todayObj = new Date();
  const todayStr = todayObj.toISOString().split("T")[0];

  const [supplierRes, bookingsRes, paymentsRes] = await Promise.all([
    supabaseServer.from("suppliers").select("*").eq("id", supplierId).single(),
    supabaseServer
      .from("bookings")
      .select("*")
      .eq("supplier_id", supplierId)
      .order("booking_date", { ascending: true }),
    supabaseServer
      .from("supplier_payments")
      .select("*")
      .eq("supplier_id", supplierId)
      .order("payment_date", { ascending: false }),
  ]);

  if (supplierRes.error || !supplierRes.data) {
    throw new Error("Fornitore non trovato");
  }

  const supplier = supplierRes.data;
  const bookings = bookingsRes.data || [];
  const payments = paymentsRes.data || [];

  const isInternal = supplier.name.includes("Fattoria Madonna della Querce");

  const decoratedBookings = bookings.map((booking) => {
    const costo = Number(booking.total_supplier_cost || 0);
    const pagato = getBookingPaidAmount(booking, isInternal);
    const residuo = Math.max(0, costo - pagato);
    const isCancelled = booking.is_cancelled === true;
    const isFuture = !!booking.booking_date && booking.booking_date > todayStr;

    let stato: "Annullato" | "Auto-Saldato" | "Pagato" | "Parziale" | "Futuro" | "Da Saldare" =
      "Da Saldare";

    if (isCancelled) {
      stato = "Annullato";
    } else if (isInternal) {
      stato = "Auto-Saldato";
    } else if (booking.supplier_payment_status === "paid" || pagato >= costo) {
      stato = "Pagato";
    } else if (pagato > 0) {
      stato = "Parziale";
    } else if (isFuture) {
      stato = "Futuro";
    } else {
      stato = "Da Saldare";
    }

    return {
      ...booking,
      costo,
      pagato,
      residuo,
      stato,
      isCancelled,
      isFuture,
    };
  });

  const filteredBookings = decoratedBookings.filter((booking) => {
    if (!qLower) return true;

    const rawDate = booking.booking_date || "";
    const formattedDate = formatDate(booking.booking_date).toLowerCase();

    return (
      String(booking.customer_name || "").toLowerCase().includes(qLower) ||
      String(booking.booking_reference || "").toLowerCase().includes(qLower) ||
      String(booking.experience_name || "").toLowerCase().includes(qLower) ||
      String(booking.stato || "").toLowerCase().includes(qLower) ||
      String(rawDate).toLowerCase().includes(qLower) ||
      formattedDate.includes(qLower) ||
      String(booking.id || "").includes(qLower)
    );
  });

  const displayBookings = [...filteredBookings].sort((a, b) =>
    (b.booking_date || "").localeCompare(a.booking_date || "")
  );

  const displayPayments = [...payments].sort((a, b) =>
    (b.payment_date || "").localeCompare(a.payment_date || "")
  );

  const daPagareOggi = isInternal
    ? 0
    : decoratedBookings.reduce((sum, booking) => {
        if (booking.isCancelled) return sum;
        if (booking.booking_date && booking.booking_date <= todayStr) {
          return sum + booking.residuo;
        }
        return sum;
      }, 0);

  const daPagareFuturo = isInternal
    ? 0
    : decoratedBookings.reduce((sum, booking) => {
        if (booking.isCancelled) return sum;
        if (booking.booking_date && booking.booking_date > todayStr) {
          return sum + booking.residuo;
        }
        return sum;
      }, 0);

  const payHref = q
    ? `/pagamenti/${supplierId}?pay=true&q=${encodeURIComponent(q)}`
    : `/pagamenti/${supplierId}?pay=true`;

  const cancelModalHref = q
    ? `/pagamenti/${supplierId}?q=${encodeURIComponent(q)}`
    : `/pagamenti/${supplierId}`;

  const returnToPath = q
    ? `/pagamenti/${supplierId}?q=${encodeURIComponent(q)}`
    : `/pagamenti/${supplierId}`;

  return (
    <main className="min-h-screen bg-zinc-50 p-6">
      <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[260px_1fr]">
        <Sidebar />

        <div className="space-y-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <div className="mb-2">
                <Link
                  href="/pagamenti"
                  className="text-sm font-medium text-zinc-500 transition hover:text-zinc-800"
                >
                  ← Torna a Pagamenti
                </Link>
              </div>

              <div className="flex items-center gap-3">
                <h1 className="text-3xl font-bold text-zinc-900">{supplier.name}</h1>
                {isInternal && (
                  <span className="rounded-lg bg-emerald-100 px-2 py-1 text-xs font-bold uppercase tracking-tight text-emerald-800">
                    Azienda Interna
                  </span>
                )}
              </div>

              <p className="mt-1 text-zinc-600">Dettaglio prenotazioni e stato pagamenti</p>
            </div>

            <div className="flex flex-wrap gap-3">
              <div className="min-w-[160px] flex-1 rounded-xl border border-amber-200 bg-amber-50 px-6 py-4 text-right shadow-sm">
                <span className="block text-sm font-medium text-amber-800">Prossimi (Futuri)</span>
                <span className="text-xl font-bold text-amber-700">
                  {formatEuro(daPagareFuturo)}
                </span>
              </div>

              {isInternal ? (
                <div className="min-w-[160px] flex-1 rounded-xl border border-emerald-200 bg-emerald-50 px-6 py-4 text-right shadow-sm">
                  <span className="block text-sm font-bold text-emerald-800">Stato Pagamenti</span>
                  <span className="text-2xl font-black text-emerald-700">Pareggiato</span>
                  <div className="mt-1 text-xs font-medium text-emerald-600">
                    Gestione contabile interna
                  </div>
                </div>
              ) : (
                <Link
                  href={payHref}
                  className="group min-w-[160px] flex-1 cursor-pointer rounded-xl border border-red-200 bg-red-50 px-6 py-4 text-right shadow-sm transition hover:border-red-300 hover:bg-red-100"
                >
                  <span className="block text-sm font-bold text-red-800">
                    Da Saldare (Scaduti/Oggi)
                  </span>
                  <span className="text-2xl font-black text-red-700">
                    {formatEuro(daPagareOggi)}
                  </span>
                  <div className="mt-1 text-xs font-medium text-red-600 group-hover:text-red-800">
                    + Registra Pagamento
                  </div>
                </Link>
              )}
            </div>
          </div>

          <SectionCard
            title={`Elenco Movimenti (Allineato a Prenotazioni)${
              q ? ` – ${displayBookings.length} risultati` : ` – ${displayBookings.length}`
            }`}
          >
            <>
              <div className="mb-4 rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                <form method="GET" className="space-y-3">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex w-full overflow-hidden rounded-xl border border-zinc-300 bg-white transition focus-within:border-zinc-500 lg:max-w-xl">
                      <div className="flex items-center pl-3 text-zinc-400">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          fill="none"
                          viewBox="0 0 24 24"
                          strokeWidth={2}
                          stroke="currentColor"
                          className="h-5 w-5"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
                          />
                        </svg>
                      </div>

                      <input
                        type="text"
                        name="q"
                        defaultValue={q}
                        placeholder="Cerca cliente, riferimento, esperienza, stato, data..."
                        className="w-full border-none px-3 py-3 text-[16px] outline-none sm:text-sm"
                      />

                      <button
                        type="submit"
                        className="border-l border-zinc-200 bg-zinc-100 px-4 py-3 text-sm font-medium text-zinc-700 hover:bg-zinc-200"
                      >
                        Cerca
                      </button>
                    </div>

                    <div className="flex items-center gap-2">
                      {q && (
                        <Link
                          href={`/pagamenti/${supplierId}`}
                          className="inline-flex min-h-11 items-center rounded-xl px-2 text-sm font-medium text-zinc-500 hover:text-zinc-800 hover:underline"
                        >
                          Reset ricerca
                        </Link>
                      )}
                    </div>
                  </div>
                </form>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b border-zinc-200 text-[10px] font-bold uppercase text-zinc-500">
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
                      const badgeClass =
                        booking.stato === "Annullato"
                          ? "bg-zinc-200 text-zinc-500"
                          : booking.stato === "Auto-Saldato"
                          ? "bg-emerald-100 text-emerald-700"
                          : booking.stato === "Pagato"
                          ? "bg-green-100 text-green-700"
                          : booking.stato === "Parziale"
                          ? "bg-blue-100 text-blue-700"
                          : booking.stato === "Futuro"
                          ? "bg-amber-100 text-amber-700"
                          : "bg-red-100 text-red-700";

                      return (
                        <tr
                          key={booking.id}
                          className={`border-b border-zinc-100 transition hover:bg-zinc-50 ${
                            booking.isCancelled ? "bg-zinc-50/50 opacity-50" : ""
                          }`}
                        >
                          <td className="whitespace-nowrap py-4 pr-4">
                            <span
                              className={`font-medium ${
                                booking.isFuture &&
                                booking.stato !== "Pagato" &&
                                booking.stato !== "Parziale" &&
                                !booking.isCancelled &&
                                !isInternal
                                  ? "text-amber-600"
                                  : "text-zinc-900"
                              }`}
                            >
                              {formatDate(booking.booking_date)}
                            </span>
                          </td>

                          <td className="py-4 pr-4">
                            <div className="font-medium text-zinc-900">{booking.customer_name}</div>
                            <div className="font-mono text-xs text-zinc-500">
                              {booking.booking_reference || `#${booking.id}`}
                            </div>
                          </td>

                          <td className="py-4 pr-4 text-zinc-700">
                            {booking.experience_name}
                            {booking.isCancelled && (
                              <span className="ml-2 inline-block text-[10px] font-bold uppercase text-red-600">
                                Cancellata
                              </span>
                            )}
                          </td>

                          <td className="py-4 pr-4">
                            <div className="font-bold text-zinc-900">
                              {formatEuro(booking.costo)}
                            </div>

                            {booking.stato === "Parziale" && !booking.isCancelled && !isInternal && (
                              <div className="mt-0.5 text-[11px] font-medium text-blue-600">
                                Coperti: {formatEuro(booking.pagato)}
                              </div>
                            )}
                          </td>

                          <td className="py-4 pr-4">
                            <span
                              className={`rounded-lg px-2 py-1 text-[10px] font-bold uppercase ${badgeClass}`}
                            >
                              {booking.stato}
                            </span>
                          </td>

                          <td className="py-4 pr-4 text-right">
                            <Link
                              href={`/prenotazioni/${booking.id}/modifica?viewOnly=true&returnTo=${encodeURIComponent(
                                returnToPath
                              )}`}
                              className="rounded-lg border border-zinc-300 px-3 py-2 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100"
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
                          Nessuna prenotazione trovata con i filtri attuali.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          </SectionCard>

          {!isInternal && (
            <SectionCard title="Storico Pagamenti Effettuati">
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b border-zinc-200 text-[10px] font-bold uppercase text-zinc-500">
                    <tr>
                      <th className="py-3 pr-4">Data Pagamento</th>
                      <th className="py-3 pr-4">Importo</th>
                      <th className="py-3 pr-4">Metodo di pagamento</th>
                      <th className="py-3 pr-4">Note</th>
                    </tr>
                  </thead>

                  <tbody>
                    {displayPayments.map((payment) => {
                      const amount = Number(payment.amount || 0);
                      const isNegative = amount < 0;

                      return (
                        <tr
                          key={payment.id}
                          className="border-b border-zinc-100 transition hover:bg-zinc-50"
                        >
                          <td className="whitespace-nowrap py-4 pr-4 font-medium text-zinc-900">
                            {formatDate(payment.payment_date)}
                          </td>

                          <td
                            className={`py-4 pr-4 font-bold ${
                              isNegative ? "text-red-700" : "text-green-700"
                            }`}
                          >
                            {formatEuro(amount)}
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
                      );
                    })}

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

      {showPayModal && !isInternal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
            <h2 className="mb-4 text-xl font-bold text-zinc-900">Registra Pagamento</h2>

            <form action={addSupplierPayment} className="space-y-4">
              <input type="hidden" name="supplier_id" value={supplierId} />

              <div>
                <label className="mb-1 block text-sm font-medium text-zinc-700">
                  Importo (€)
                </label>
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
                <label className="mb-1 block text-sm font-medium text-zinc-700">
                  Data Pagamento
                </label>
                <input
                  type="date"
                  name="payment_date"
                  defaultValue={todayStr}
                  required
                  className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none focus:border-zinc-500"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-zinc-700">
                  Metodo di pagamento
                </label>
                <select
                  name="payment_method"
                  className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 outline-none focus:border-zinc-500"
                  defaultValue="Bonifico Bancario"
                >
                  {PAYMENT_METHOD_OPTIONS.map((method) => (
                    <option key={method} value={method}>
                      {method}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-zinc-700">
                  Note (Opzionale)
                </label>
                <input
                  type="text"
                  name="notes"
                  placeholder="Es. CRO bonifico, acconto mese..."
                  className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none focus:border-zinc-500"
                />
              </div>

              <div className="mt-2 flex justify-end gap-3 border-t border-zinc-100 pt-4">
                <Link
                  href={cancelModalHref}
                  className="flex items-center rounded-xl border border-zinc-300 px-5 py-3 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
                >
                  Annulla
                </Link>

                <button
                  type="submit"
                  className="rounded-xl bg-zinc-900 px-5 py-3 text-sm font-medium text-white transition hover:bg-zinc-700"
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