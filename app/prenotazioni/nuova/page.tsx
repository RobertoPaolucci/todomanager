import AppShell from "@/components/AppShell";
import SectionCard from "@/components/SectionCard";
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
      {/* Aggiungiamo lang="it-IT" al contenitore per suggerire al browser il formato data/ora europeo */}
      <div lang="it-IT">
        <SectionCard title="Dati prenotazione">
          <BookingForm
            channels={channels}
            experiences={experiences}
            today={today}
          />
        </SectionCard>
      </div>
    </AppShell>
  );
}