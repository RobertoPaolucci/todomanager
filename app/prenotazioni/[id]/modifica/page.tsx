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
  }>;
};

export default async function ModificaPrenotazionePage({
  params,
  searchParams,
}: PageProps) {
  const { id } = await params;
  const { returnTo, viewOnly } = await searchParams;
  const bookingId = Number(id);

  const isViewOnly = viewOnly === "true";

  const [channels, experiences, bookingResult] = await Promise.all([
    getChannels(),
    getExperiences(),
    supabase.from("bookings").select("*").eq("id", bookingId).single(),
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