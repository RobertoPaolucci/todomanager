export const dynamic = "force-dynamic";

import Link from "next/link";
import PrintPdfButton from "@/components/PrintPdfButton";
import SendSummaryWhatsAppButton from "@/components/SendSummaryWhatsAppButton";
import { supabaseServer } from "@/lib/supabase-server";

type PageProps = {
  searchParams: Promise<{
    ids?: string | string[];
  }>;
};

function formatDate(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

function formatDateTime(value: Date) {
  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function formatTime(value: string | null) {
  if (!value) return "-";
  return value.slice(0, 5);
}

function getChannelName(booking: any) {
  if (Array.isArray(booking.channels)) {
    return booking.channels[0]?.name || booking.booking_source || "";
  }
  return booking.channels?.name || booking.booking_source || "";
}

function getSupplierData(booking: any) {
  if (Array.isArray(booking.suppliers)) {
    return booking.suppliers[0] || null;
  }
  return booking.suppliers || null;
}

function getPeopleCount(booking: any) {
  const totalPeople = Number(booking.total_people || 0);
  if (totalPeople > 0) return totalPeople;

  return (
    Number(booking.adults || 0) +
    Number(booking.children || 0) +
    Number(booking.infants || 0)
  );
}

function parseIds(raw: string | string[] | undefined) {
  const values = Array.isArray(raw) ? raw : raw ? [raw] : [];

  return Array.from(
    new Set(
      values
        .flatMap((value) => String(value).split(","))
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isInteger(value) && value > 0)
    )
  );
}

export default async function RiepilogoPrenotazioniPage({
  searchParams,
}: PageProps) {
  const params = await searchParams;
  const ids = parseIds(params.ids);

  if (ids.length === 0) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-bold text-zinc-900">
            Riepilogo Prenotazioni
          </h1>
          <p className="mt-2 text-zinc-600">
            Non hai selezionato nessuna prenotazione.
          </p>

          <div className="mt-6">
            <Link
              href="/prenotazioni"
              className="inline-flex items-center justify-center rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm font-bold text-zinc-700 shadow-sm transition hover:bg-zinc-100"
            >
              Torna alle prenotazioni
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const { data, error } = await supabaseServer
    .from("bookings")
    .select("*, suppliers(id, name, phone), channels(name)")
    .in("id", ids);

  if (error) {
    console.error("Errore caricamento riepilogo:", error.message);
  }

  const bookings = (data || []).sort((a, b) => {
    const aDate = `${a.booking_date || ""} ${a.booking_time || ""}`;
    const bDate = `${b.booking_date || ""} ${b.booking_time || ""}`;
    return aDate.localeCompare(bDate);
  });

  const createdAt = new Date();

  const totalBookings = bookings.length;
  const totalPeople = bookings.reduce(
    (sum, booking) => sum + getPeopleCount(booking),
    0
  );

  const supplierMap = new Map<
    number,
    { id: number; name: string; phone: string | null }
  >();

  bookings.forEach((booking) => {
    const supplier = getSupplierData(booking);

    if (supplier?.id && !supplierMap.has(Number(supplier.id))) {
      supplierMap.set(Number(supplier.id), {
        id: Number(supplier.id),
        name: supplier.name || `Fornitore ${supplier.id}`,
        phone: supplier.phone || "",
      });
    }
  });

  const suppliers = Array.from(supplierMap.values());

  const whatsappMessage =
    [
      "RIEPILOGO PRENOTAZIONI",
      `Documento creato il ${formatDateTime(createdAt)}`,
      "",
      ...bookings.map((booking) => {
        const people = getPeopleCount(booking);
        const date = formatDate(booking.booking_date);
        const time = formatTime(booking.booking_time);
        const customer = booking.customer_name || "-";
        const reference = booking.booking_reference || "-";
        const channel = getChannelName(booking) || "-";
        const experience = booking.experience_name || "-";
        const bookingCreated = formatDate(booking.booking_created_at);

        return `${people} pax | ${date} ore ${time} | ${customer} | ${reference} | ${channel} | ${experience} | prenotata il ${bookingCreated}`;
      }),
      "",
      `Numero di prenotazioni: ${totalBookings}`,
      `Persone totali: ${totalPeople}`,
      `Data creazione documento: ${formatDateTime(createdAt)}`,
    ].join("\n");

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 print:max-w-none print:px-0 print:py-0">
      <div className="space-y-6 print:space-y-4">
        <div className="print:hidden flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-zinc-900">
              Riepilogo Prenotazioni
            </h1>
            <p className="mt-1 text-sm text-zinc-600">
              Selezione pronta per stampa PDF o invio WhatsApp.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              href="/prenotazioni"
              className="inline-flex items-center justify-center rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm font-bold text-zinc-700 shadow-sm transition hover:bg-zinc-100"
            >
              ← Torna alle prenotazioni
            </Link>

            <PrintPdfButton />
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm print:rounded-none print:border-0 print:p-0 print:shadow-none">
          <div className="mb-6 border-b border-zinc-200 pb-4 print:mb-4">
            <h1 className="text-2xl font-bold text-zinc-900 print:text-[24px]">
              Riepilogo Prenotazioni
            </h1>
            <p className="mt-2 text-sm text-zinc-600 print:text-[12px]">
              Documento creato il {formatDateTime(createdAt)}
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm print:text-[11px]">
              <thead className="border-b border-zinc-200 text-[11px] font-bold uppercase text-zinc-500">
                <tr>
                  <th className="py-3 pr-4">Num Clienti</th>
                  <th className="py-3 pr-4">Data e Ora</th>
                  <th className="py-3 pr-4">Nome Cliente</th>
                  <th className="py-3 pr-4">Rif Prenotazione</th>
                  <th className="py-3 pr-4">Canale Prenotazione</th>
                  <th className="py-3 pr-4">Tipo Esperienza</th>
                  <th className="py-3 pr-0">Data Prenotazione</th>
                </tr>
              </thead>

              <tbody>
                {bookings.map((booking) => (
                  <tr key={booking.id} className="border-b border-zinc-100 align-top">
                    <td className="py-4 pr-4 font-bold text-zinc-900">
                      {getPeopleCount(booking)}
                    </td>

                    <td className="py-4 pr-4 whitespace-nowrap">
                      <div className="font-medium text-zinc-900">
                        {formatDate(booking.booking_date)}
                      </div>
                      <div className="text-xs text-zinc-500">
                        ore {formatTime(booking.booking_time)}
                      </div>
                    </td>

                    <td className="py-4 pr-4">
                      <div className="font-medium text-zinc-900">
                        {booking.customer_name || "-"}
                      </div>
                    </td>

                    <td className="py-4 pr-4">
                      <div className="font-mono text-zinc-700">
                        {booking.booking_reference || "-"}
                      </div>
                    </td>

                    <td className="py-4 pr-4">
                      <div className="text-zinc-900">
                        {getChannelName(booking) || "-"}
                      </div>
                    </td>

                    <td className="py-4 pr-4">
                      <div className="text-zinc-900">
                        {booking.experience_name || "-"}
                      </div>
                    </td>

                    <td className="py-4 pr-0 whitespace-nowrap">
                      <div className="text-zinc-900">
                        {formatDate(booking.booking_created_at)}
                      </div>
                    </td>
                  </tr>
                ))}

                {bookings.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-sm text-zinc-500">
                      Nessuna prenotazione trovata.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-3 print:mt-6">
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
              <div className="text-[11px] font-bold uppercase text-zinc-500">
                Numero di prenotazioni
              </div>
              <div className="mt-2 text-2xl font-black text-zinc-900">
                {totalBookings}
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
              <div className="text-[11px] font-bold uppercase text-zinc-500">
                Persone totali
              </div>
              <div className="mt-2 text-2xl font-black text-zinc-900">
                {totalPeople}
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
              <div className="text-[11px] font-bold uppercase text-zinc-500">
                Data creazione documento
              </div>
              <div className="mt-2 text-sm font-bold text-zinc-900">
                {formatDateTime(createdAt)}
              </div>
            </div>
          </div>
        </div>

        <div className="print:hidden">
          <SendSummaryWhatsAppButton
            suppliers={suppliers}
            message={whatsappMessage}
          />
        </div>

        <div className="print:hidden rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="mb-2 text-sm font-black text-zinc-900">
            Anteprima messaggio WhatsApp
          </div>
          <pre className="whitespace-pre-wrap rounded-xl bg-zinc-50 p-4 text-sm text-zinc-700">
            {whatsappMessage}
          </pre>
        </div>
      </div>
    </main>
  );
}