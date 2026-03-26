import Link from "next/link";
import AppShell from "@/components/AppShell";
import BookingForm from "@/components/BookingForm";
import { supabase } from "@/lib/supabase";
import { getChannels, getExperiences } from "@/lib/queries";

type PageProps = {
  params: Promise<{
    id: string;
  }>;
  searchParams: Promise<{
    returnTo?: string;
    viewOnly?: string;
    justCreated?: string;
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

export default async function ModificaPrenotazionePage({
  params,
  searchParams,
}: PageProps) {
  const { id } = await params;
  const { returnTo, viewOnly, justCreated } = await searchParams;
  const bookingId = Number(id);

  const isViewOnly = viewOnly === "true";
  const isJustCreated = justCreated === "true";

  const [channels, experiences, bookingResult] = await Promise.all([
    getChannels(),
    getExperiences(),
    supabase
      .from("bookings")
      .select("*, suppliers(phone), channels(name)")
      .eq("id", bookingId)
      .single(),
  ]);

  if (bookingResult.error || !bookingResult.data) {
    throw new Error("Prenotazione non trovata");
  }

  const booking = bookingResult.data;
  const today = new Date().toISOString().split("T")[0];

  const backPath = returnTo || "/prenotazioni";
  const backText = returnTo?.includes("/pagamenti")
    ? "← Torna all'estratto conto"
    : "← Torna alle prenotazioni";

  const bookingChannelName = Array.isArray(booking.channels)
    ? booking.channels[0]?.name || booking.booking_source || ""
    : booking.channels?.name || booking.booking_source || "";

  const wPax = Number(booking.adults || 0) + Number(booking.children || 0);
  const wDate = formatDate(booking.booking_date);
  const wTime = booking.booking_time
    ? booking.booking_time.slice(0, 5)
    : "Orario da def.";
  const wChannel = bookingChannelName || "N/A";
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
    ? `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(
        waText
      )}`
    : `https://api.whatsapp.com/send?text=${encodeURIComponent(waText)}`;

  return (
    <AppShell
      title={isViewOnly ? "Dettaglio prenotazione" : "Modifica prenotazione"}
      subtitle={
        isViewOnly
          ? "Visualizzazione in sola lettura"
          : "Aggiorna i dati della prenotazione"
      }
    >
      <div lang="it-IT" className="mx-auto w-full max-w-5xl space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Link
            href={backPath}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-100 sm:w-auto"
          >
            {backText}
          </Link>

          {isViewOnly ? (
            <div className="inline-flex min-h-11 items-center justify-center rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700">
              Modalità sola lettura
            </div>
          ) : (
            <div className="inline-flex min-h-11 items-center justify-center rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-700">
              Modifica in corso
            </div>
          )}
        </div>

        {isJustCreated && (
          <div className="rounded-2xl border border-green-200 bg-green-50 p-4 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="text-sm font-black text-green-800">
                  ✅ Prenotazione salvata
                </div>

                <div className="mt-1 text-sm text-green-900">
                  <span className="font-semibold">{booking.customer_name || "-"}</span>
                  {" · "}
                  {booking.experience_name || "-"}
                </div>

                <div className="mt-1 text-xs text-green-800/90">
                  {formatDate(booking.booking_date)}
                  {booking.booking_time ? ` · ${booking.booking_time.slice(0, 5)}` : ""}
                  {booking.booking_reference ? ` · Rif. ${booking.booking_reference}` : ""}
                </div>

                <div className="mt-1 text-xs text-green-800/90">
                  Canale: {bookingChannelName || "-"} · Pax paganti: {wPax}
                </div>

                {cleanPhone ? (
                  <div className="mt-1 text-xs text-green-800/90">
                    Fornitore: +{cleanPhone}
                  </div>
                ) : (
                  <div className="mt-1 text-xs font-semibold text-amber-700">
                    Attenzione: manca il numero del fornitore, ma il messaggio WhatsApp è comunque apribile.
                  </div>
                )}
              </div>

              {!booking.is_cancelled && (
                <a
                  href={waUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-12 items-center justify-center rounded-xl border border-green-300 bg-white px-5 py-3 text-sm font-bold text-green-700 shadow-sm transition hover:bg-green-100"
                >
                  WhatsApp fornitore
                </a>
              )}
            </div>
          </div>
        )}

        {!isJustCreated && (
          <div
            className={`rounded-2xl px-4 py-3 text-sm shadow-sm ${
              isViewOnly
                ? "border border-blue-100 bg-blue-50 text-blue-900"
                : "border border-amber-100 bg-amber-50 text-amber-900"
            }`}
          >
            <div className="font-bold">
              {isViewOnly ? "Controllo dettagli" : "Aggiornamento prenotazione"}
            </div>
            <div className="mt-1 opacity-90">
              {isViewOnly
                ? "Puoi verificare tutti i dati senza modificare i campi."
                : "Controlla bene date, pax, pagamenti e riepilogo economico prima di salvare."}
            </div>
          </div>
        )}

        <BookingForm
          channels={channels}
          experiences={experiences}
          today={today}
          initialData={booking}
          isEditing={!isViewOnly}
          viewOnly={isViewOnly}
          returnTo={backPath}
        />
      </div>
    </AppShell>
  );
}