export const dynamic = "force-dynamic";

import Link from "next/link";
import PrintPdfButton from "@/components/PrintPdfButton";
import SendSummaryWhatsAppButton from "@/components/SendSummaryWhatsAppButton";
import { supabaseServer } from "@/lib/supabase-server";

type PageProps = {
  searchParams: Promise<{
    ids?: string | string[];
    source?: string | string[];
  }>;
};

function getParam(value?: string | string[]) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function toSafeNumber(value: unknown) {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? num : 0;
}

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

function getAdultsCount(booking: any) {
  return toSafeNumber(booking.adults);
}

function getChildrenCount(booking: any) {
  return toSafeNumber(booking.children);
}

function getInfantsCount(booking: any) {
  return toSafeNumber(booking.infants);
}

/**
 * Nel Todo Manager i "non_paying_adults" sono usati come guide/accompagnatori.
 * Ho lasciato anche altri nomi come fallback, così il riepilogo resta robusto
 * se in futuro aggiungi una colonna più esplicita tipo guides o guide_count.
 */
function getGuidesCount(booking: any) {
  return toSafeNumber(
    booking.guides ??
      booking.guide_count ??
      booking.guides_count ??
      booking.number_of_guides ??
      booking.total_guides ??
      booking.non_paying_adults ??
      0
  );
}

function getPayingPeopleCount(booking: any) {
  return getAdultsCount(booking) + getChildrenCount(booking);
}

function getTotalSeatsCount(booking: any) {
  const adults = getAdultsCount(booking);
  const children = getChildrenCount(booking);
  const infants = getInfantsCount(booking);
  const guides = getGuidesCount(booking);

  const totalFromSeparatedFields = adults + children + infants + guides;

  if (totalFromSeparatedFields > 0) {
    return totalFromSeparatedFields;
  }

  return toSafeNumber(booking.total_people);
}

function hasSeparatedSeatsDetails(booking: any) {
  return (
    getChildrenCount(booking) > 0 ||
    getInfantsCount(booking) > 0 ||
    getGuidesCount(booking) > 0
  );
}

function formatSeatsBreakdown(booking: any) {
  const adults = getAdultsCount(booking);
  const children = getChildrenCount(booking);
  const infants = getInfantsCount(booking);
  const guides = getGuidesCount(booking);
  const total = getTotalSeatsCount(booking);

  const parts: string[] = [];

  if (adults > 0) {
    parts.push(String(adults));
  }

  if (children > 0) {
    parts.push(`${children} ${children === 1 ? "bambino" : "bambini"}`);
  }

  if (infants > 0) {
    parts.push(`${infants} ${infants === 1 ? "infante" : "infanti"}`);
  }

  if (guides > 0) {
    parts.push(`${guides} ${guides === 1 ? "guida" : "guide"}`);
  }

  if (parts.length === 0) {
    return String(total);
  }

  return parts.join(" + ");
}

function stripSystemAlert(notes: string) {
  return notes
    .split("\n")
    .filter((line) => {
      const text = line.trim();
      return (
        !text.startsWith("🟢") &&
        !text.startsWith("🟡") &&
        !text.startsWith("🔴")
      );
    })
    .join("\n")
    .trim();
}

function getInternalNotes(booking: any) {
  const rawNotes = String(
    booking.internal_notes ??
      booking.private_notes ??
      booking.notes ??
      ""
  ).trim();

  const cleanedNotes = stripSystemAlert(rawNotes);

  return cleanedNotes || "-";
}

function getPeopleSummaryForWhatsapp(booking: any) {
  const paying = getPayingPeopleCount(booking);
  const totalSeats = getTotalSeatsCount(booking);
  const breakdown = formatSeatsBreakdown(booking);

  const parts = [`${breakdown}`];

  if (hasSeparatedSeatsDetails(booking)) {
    parts.push(`totale posti ${totalSeats}`);
  } else {
    parts.push(`${totalSeats} posti`);
  }

  parts.push(`paganti ${paying}`);

  return parts.join(" | ");
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
  const source = getParam(params.source).trim();
  const isCognanello = source === "cognanello";
  const backHref = isCognanello ? "/cognanello" : "/prenotazioni";
  const backLabel = isCognanello
    ? "← Torna alle prenotazioni Cognanello"
    : "← Torna alle prenotazioni";

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
              href={backHref}
              className="inline-flex items-center justify-center rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm font-bold text-zinc-700 shadow-sm transition hover:bg-zinc-100"
            >
              {backLabel}
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
  const totalSeats = bookings.reduce(
    (sum, booking) => sum + getTotalSeatsCount(booking),
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

  const whatsappMessage = [
    "RIEPILOGO PRENOTAZIONI",
    `Documento creato il ${formatDateTime(createdAt)}`,
    "",
    ...bookings.map((booking) => {
      const date = formatDate(booking.booking_date);
      const time = formatTime(booking.booking_time);
      const customer = booking.customer_name || "-";
      const reference = booking.booking_reference || "-";
      const channel = getChannelName(booking) || "-";
      const experience = booking.experience_name || "-";
      const bookingCreated = formatDate(booking.booking_created_at);
      const peopleSummary = getPeopleSummaryForWhatsapp(booking);

      return `${peopleSummary} | ${date} ore ${time} | ${customer} | ${channel} | ${reference} | ${experience} | prenotata il ${bookingCreated}`;
    }),
    "",
    `Numero di prenotazioni: ${totalBookings}`,
    `Posti totali: ${totalSeats}`,
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
              {isCognanello
                ? "Selezione pronta per stampa PDF."
                : "Selezione pronta per stampa PDF o invio WhatsApp."}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              href={backHref}
              className="inline-flex items-center justify-center rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm font-bold text-zinc-700 shadow-sm transition hover:bg-zinc-100"
            >
              {backLabel}
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

          <div className="overflow-x-auto print:overflow-visible">
            <table className="min-w-full text-left text-sm print:text-[10px]">
              <thead className="border-b border-zinc-200 text-[11px] font-bold uppercase text-zinc-500 print:text-[9px]">
                <tr>
                  <th className="py-3 pr-3">Posti</th>
                  <th className="py-3 pr-3">Data e Ora</th>
                  <th className="py-3 pr-3">Nome Cliente</th>
                  <th className="py-3 pr-3">Canale Prenotazione</th>
                  <th className="py-3 pr-3">
                    Rif Prenotazione
                    <br />
                    <span className="normal-case text-zinc-400">
                      Data pren.
                    </span>
                  </th>
                  <th className="py-3 pr-3">Tipo Esperienza</th>
                  <th className="py-3 pr-0">Note interne</th>
                </tr>
              </thead>

              <tbody>
                {bookings.map((booking) => {
                  const total = getTotalSeatsCount(booking);
                  const breakdown = formatSeatsBreakdown(booking);
                  const showTotalLine = hasSeparatedSeatsDetails(booking);
                  const internalNotes = getInternalNotes(booking);

                  return (
                    <tr
                      key={booking.id}
                      className="border-b border-zinc-100 align-top"
                    >
                      <td className="min-w-[180px] py-4 pr-3 print:min-w-[135px]">
                        <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 print:border-zinc-300 print:bg-white print:px-2 print:py-1">
                          <div className="text-lg font-black leading-tight text-zinc-900 print:text-[14px]">
                            {breakdown}
                          </div>

                          {showTotalLine && (
                            <div className="mt-1 text-[11px] font-bold uppercase tracking-wide text-zinc-500 print:text-[9px]">
                              Totale posti: {total}
                            </div>
                          )}
                        </div>
                      </td>

                      <td className="py-4 pr-3 whitespace-nowrap">
                        <div className="font-medium text-zinc-900">
                          {formatDate(booking.booking_date)}
                        </div>
                        <div className="text-xs text-zinc-500 print:text-[9px]">
                          ore {formatTime(booking.booking_time)}
                        </div>
                      </td>

                      <td className="py-4 pr-3">
                        <div className="font-black text-zinc-900">
                          {booking.customer_name || "-"}
                        </div>
                      </td>

                      <td className="py-4 pr-3">
                        <div className="font-black text-zinc-900">
                          {getChannelName(booking) || "-"}
                        </div>
                      </td>

                      <td className="py-4 pr-3">
                        <div className="font-mono font-bold text-zinc-800">
                          {booking.booking_reference || "-"}
                        </div>
                        <div className="mt-1 text-[11px] font-semibold text-zinc-500 print:text-[9px]">
                          Prenotata il {formatDate(booking.booking_created_at)}
                        </div>
                      </td>

                      <td className="py-4 pr-3">
                        <div className="text-zinc-900">
                          {booking.experience_name || "-"}
                        </div>
                      </td>

                      <td className="max-w-[220px] py-4 pr-0 print:max-w-[150px]">
                        <div className="whitespace-pre-line text-zinc-800">
                          {internalNotes}
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {bookings.length === 0 && (
                  <tr>
                    <td
                      colSpan={7}
                      className="py-8 text-center text-sm text-zinc-500"
                    >
                      Nessuna prenotazione trovata.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-2 print:mt-6">
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 print:p-3">
              <div className="text-[11px] font-bold uppercase text-zinc-500 print:text-[9.5px]">
                Numero di prenotazioni
              </div>
              <div className="mt-2 text-2xl font-black text-zinc-900 print:text-[22px]">
                {totalBookings}
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 print:p-3">
              <div className="text-[11px] font-bold uppercase text-zinc-500 print:text-[9.5px]">
                Posti totali
              </div>
              <div className="mt-2 text-2xl font-black text-zinc-900 print:text-[22px]">
                {totalSeats}
              </div>
            </div>
          </div>
        </div>

        {!isCognanello && (
          <>
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
          </>
        )}
      </div>
    </main>
  );
}