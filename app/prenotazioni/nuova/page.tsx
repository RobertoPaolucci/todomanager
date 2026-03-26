import AppShell from "@/components/AppShell";
import BookingForm from "@/components/BookingForm";
import { getChannels, getExperiences } from "@/lib/queries";

export default async function NuovaPrenotazionePage() {
  const today = new Date().toISOString().split("T")[0];
  const channels = await getChannels();
  const experiences = await getExperiences();

  return (
    <AppShell
      title="Nuova Prenotazione"
      subtitle="Inserisci una nuova prenotazione nel gestionale"
    >
      <div lang="it-IT" className="mx-auto w-full max-w-5xl space-y-4">
        <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900 shadow-sm">
          <div className="font-bold">Inserimento rapido</div>
          <div className="mt-1 text-blue-800/90">
            Compila i dati principali, poi controlla il riepilogo economico prima
            di salvare.
          </div>
        </div>

        <BookingForm
          channels={channels}
          experiences={experiences}
          today={today}
        />
      </div>
    </AppShell>
  );
}