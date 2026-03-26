import AppShell from "@/components/AppShell";
import BookingForm from "@/components/BookingForm";
import { getChannels, getExperiences } from "@/lib/queries";
import { supabase } from "@/lib/supabase";

type PageProps = {
  searchParams: Promise<{
    saved?: string;
    bookingId?: string;
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

export default async function NuovaPrenotazionePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const today = new Date().toISOString().split("T")[0];

  const channels = await getChannels();
  const experiences = await getExperiences();

  const saved = params.saved === "1";
  const bookingId = Number(params.bookingId || 0);

  let savedBooking: any = null;
  let waUrl = "";
  let cleanPhone = "";

  if (saved && bookingId) {
    const { data } = await supabase
      .from("bookings")
      .select("*, suppliers(phone), channels(name)")
      .eq("id", bookingId)
      .single();

    savedBooking = data || null;

    if (savedBooking) {
      const bookingChannelName = getChannelName(savedBooking);
      const wPax =
        Number(savedBooking.adults || 0) + Number(savedBooking.children || 0);
      const wDate = formatDate(savedBooking.booking_date);
      const wTime = savedBooking.booking_time
        ? savedBooking.booking_time.slice(0, 5)
        : "Orario da def.";
      const wChannel = bookingChannelName || "N/A";
      const wRef = savedBooking.booking_reference || "N/A";
      const wName = savedBooking.customer_name || "N/A";
      const waText = `${wPax} da te ${wDate} ore ${wTime} ${wChannel} ${wRef} ${wName}`;

      const rawSupplier = savedBooking.suppliers;
      let rawPhone = "";

      if (Array.isArray(rawSupplier)) {
        rawPhone = rawSupplier[0]?.phone || "";
      } else if (rawSupplier) {
        rawPhone = rawSupplier.phone || "";
      }

      cleanPhone = rawPhone.replace(/\D/g, "");

      waUrl = cleanPhone
        ? `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(
            waText
          )}`
        : `https://api.whatsapp.com/send?text=${encodeURIComponent(waText)}`;
    }
  }

  return (
    <AppShell
      title="Nuova Prenotazione"
      subtitle="Inserisci una nuova prenotazione nel gestionale"
    >
      <div lang="it-IT" className="mx-auto w-full max-w-5xl space-y-4">
        {saved && savedBooking ? (
          <div className="rounded-2xl border border-green-200 bg-green-50 p-4 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="text-sm font-black text-green-800">
                  ✅ Prenotazione salvata
                </div>
                <div className="mt-1 text-sm text-green-900">
                  <span className="font-semibold">{savedBooking.customer_name}</span>
                  {" · "}
                  {savedBooking.experience_name}
                </div>
                <div className="mt-1 text-xs text-green-800/90">
                  {formatDate(savedBooking.booking_date)}
                  {savedBooking.booking_time
                    ? ` · ${savedBooking.booking_time.slice(0, 5)}`
                    : ""}
                  {savedBooking.booking_reference
                    ? ` · Rif. ${savedBooking.booking_reference}`
                    : ""}
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
          <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900 shadow-sm">
            <div className="font-bold">Inserimento rapido</div>
            <div className="mt-1 text-blue-800/90">
              Compila i dati principali, poi controlla il riepilogo economico prima
              di salvare.
            </div>
          </div>
        )}

        <BookingForm
          channels={channels}
          experiences={experiences}
          today={today}
          returnTo="/prenotazioni/nuova"
        />
      </div>
    </AppShell>
  );
}