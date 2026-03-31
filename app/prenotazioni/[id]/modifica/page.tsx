export const dynamic = "force-dynamic";

import Link from "next/link";
import AppShell from "@/components/AppShell";
import BookingForm from "@/components/BookingForm";
import { getChannels, getExperiences } from "@/lib/queries";
import { supabase } from "@/lib/supabase";

type PageProps = {
  params: Promise<{
    id: string;
  }>;
  searchParams: Promise<{
    returnTo?: string;
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

function getChannelName(booking: any) {
  if (Array.isArray(booking.channels)) {
    return booking.channels[0]?.name || booking.booking_source || "";
  }
  return booking.channels?.name || booking.booking_source || "";
}

export default async function ModificaPrenotazionePage({
  params,
  searchParams,
}: PageProps) {
  const { id } = await params;
  const query = await searchParams;

  const bookingId = Number(id || 0);
  const returnTo = String(query.returnTo || "/prenotazioni").trim();
  const justCreated = query.justCreated === "true";
  const today = new Date().toISOString().split("T")[0];

  const channels = await getChannels();
  const experiences = await getExperiences();

  if (!bookingId || Number.isNaN(bookingId)) {
    return (
      <AppShell
        title="Modifica Prenotazione"
        subtitle="Prenotazione non valida"
      >
        <div className="mx-auto w-full max-w-3xl">
          <div className="rounded-2xl border border-red-200 bg-white p-6 shadow-sm">
            <div className="text-2xl font-black text-red-700">
              Prenotazione non valida
            </div>
            <p className="mt-2 text-sm text-zinc-600">
              L&apos;ID della prenotazione non è valido.
            </p>

            <div className="mt-6">
              <Link
                href="/prenotazioni"
                className="inline-flex items-center rounded-xl bg-zinc-900 px-4 py-3 text-sm font-bold text-white hover:bg-zinc-700"
              >
                Torna a Prenotazioni
              </Link>
            </div>
          </div>
        </div>
      </AppShell>
    );
  }

  const { data: booking, error } = await supabase
    .from("bookings")
    .select("*, suppliers(phone), channels(name)")
    .eq("id", bookingId)
    .single();

  if (error || !booking) {
    return (
      <AppShell
        title="Modifica Prenotazione"
        subtitle="Prenotazione non trovata"
      >
        <div className="mx-auto w-full max-w-3xl">
          <div className="rounded-2xl border border-red-200 bg-white p-6 shadow-sm">
            <div className="text-2xl font-black text-red-700">
              Prenotazione non trovata
            </div>
            <p className="mt-2 text-sm text-zinc-600">
              Non è stato possibile caricare la prenotazione richiesta.
            </p>

            <div className="mt-6">
              <Link
                href="/prenotazioni"
                className="inline-flex items-center rounded-xl bg-zinc-900 px-4 py-3 text-sm font-bold text-white hover:bg-zinc-700"
              >
                Torna a Prenotazioni
              </Link>
            </div>
          </div>
        </div>
      </AppShell>
    );
  }

  const bookingChannelName = getChannelName(booking);

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
      title="Modifica Prenotazione"
      subtitle="Controlla, correggi e salva i dati della prenotazione"
    >
      <div lang="it-IT" className="mx-auto w-full max-w-5xl space-y-4">
        {justCreated ? (
          <div className="rounded-2xl border border-green-200 bg-green-50 p-4 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="text-sm font-black text-green-800">
                  ✅ Prenotazione salvata
                </div>

                <div className="mt-1 text-sm text-green-900">
                  <span className="font-semibold">{booking.customer_name}</span>
                  {" · "}
                  {booking.experience_name}
                </div>

                <div className="mt-1 text-xs text-green-800/90">
                  {formatDate(booking.booking_date)}
                  {booking.booking_time ? ` · ${booking.booking_time.slice(0, 5)}` : ""}
                  {booking.booking_reference
                    ? ` · Rif. ${booking.booking_reference}`
                    : ""}
                </div>

                {booking.recovery_tag ? (
                  <div className="mt-2 inline-flex rounded-lg border border-violet-200 bg-violet-50 px-2 py-1 text-[11px] font-bold text-violet-700">
                    Recupero: {booking.recovery_tag}
                  </div>
                ) : null}

                {cleanPhone ? (
                  <div className="mt-1 text-xs text-green-800/90">
                    Fornitore: +{cleanPhone}
                  </div>
                ) : (
                  <div className="mt-1 text-xs font-semibold text-amber-700">
                    Attenzione: manca il numero del fornitore, ma il messaggio
                    WhatsApp è comunque apribile.
                  </div>
                )}
              </div>

              <a
                href={waUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-12 items-center justify-center rounded-xl border border-green-300 bg-white px-5 py-3 text-sm font-bold text-green-700 shadow-sm transition hover:bg-green-100"
              >
                WhatsApp fornitore
              </a>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="text-sm font-black text-zinc-900">
                  Modifica prenotazione #{booking.id}
                </div>

                <div className="mt-1 text-sm text-zinc-700">
                  <span className="font-semibold">{booking.customer_name || "-"}</span>
                  {" · "}
                  {booking.experience_name || "-"}
                </div>

                <div className="mt-1 text-xs text-zinc-500">
                  {formatDate(booking.booking_date)}
                  {booking.booking_time ? ` · ${booking.booking_time.slice(0, 5)}` : ""}
                  {booking.booking_reference
                    ? ` · Rif. ${booking.booking_reference}`
                    : ""}
                  {bookingChannelName ? ` · ${bookingChannelName}` : ""}
                </div>

                {booking.recovery_tag ? (
                  <div className="mt-2 inline-flex rounded-lg border border-violet-200 bg-violet-50 px-2 py-1 text-[11px] font-bold text-violet-700">
                    Recupero: {booking.recovery_tag}
                  </div>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-2">
                <Link
                  href={returnTo}
                  className="inline-flex min-h-11 items-center justify-center rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm font-bold text-zinc-700 shadow-sm transition hover:bg-zinc-100"
                >
                  ← Torna indietro
                </Link>

                <a
                  href={waUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center justify-center rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-bold text-green-700 shadow-sm transition hover:bg-green-100"
                >
                  WhatsApp fornitore
                </a>
              </div>
            </div>
          </div>
        )}

        <BookingForm
  channels={channels}
  experiences={experiences}
  today={today}
  initialData={booking}
  isEditing={true}
  returnTo={returnTo}
/>
      </div>
    </AppShell>
  );
}