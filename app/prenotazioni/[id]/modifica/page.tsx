import Link from "next/link";
import AppShell from "@/components/AppShell";
import SectionCard from "@/components/SectionCard";
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

export default async function ModificaPrenotazionePage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { returnTo, viewOnly } = await searchParams;
  const bookingId = Number(id);

  // Verifichiamo se l'URL richiede la sola lettura
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
      subtitle={isViewOnly ? "Visualizzazione in sola lettura" : "Aggiorna i dati della prenotazione"}
    >
      <div className="mb-4 flex items-center justify-end">
        <Link
          href={backPath}
          className="rounded-xl border border-zinc-300 px-4 py-3 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100"
        >
          {backText}
        </Link>
      </div>

      <div lang="it-IT">
        <SectionCard title="Dati prenotazione">
          <BookingForm
            channels={channels}
            experiences={experiences}
            today={today}
            initialData={booking}
            isEditing={!isViewOnly} // Se è viewOnly, non è "editing"
            viewOnly={isViewOnly}   // Passiamo la prop al form per bloccare i campi
            returnTo={backPath}
          />
        </SectionCard>
      </div>
    </AppShell>
  );
}