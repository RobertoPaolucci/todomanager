import Link from "next/link";
import AppShell from "@/components/AppShell";
import SectionCard from "@/components/SectionCard";
import BookingForm from "@/components/BookingForm"; // Importiamo il componente reattivo
import { supabase } from "@/lib/supabase";
import { getChannels, getExperiences } from "@/lib/queries";

type PageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function ModificaPrenotazionePage({ params }: PageProps) {
  const { id } = await params;
  const bookingId = Number(id);

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

  return (
    <AppShell
      title="Modifica prenotazione"
      subtitle="Aggiorna i dati della prenotazione"
    >
      <div className="mb-4 flex items-center justify-end">
        <Link
          href="/prenotazioni"
          className="rounded-xl border border-zinc-300 px-4 py-3 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100"
        >
          ← Torna alle prenotazioni
        </Link>
      </div>

      <div lang="it-IT">
        <SectionCard title="Dati prenotazione">
          <BookingForm
            channels={channels}
            experiences={experiences}
            today={today}
            initialData={booking} // Passiamo i dati caricati!
            isEditing={true}      // Diciamo al form di usare la action "update"
          />
        </SectionCard>
      </div>
    </AppShell>
  );
}