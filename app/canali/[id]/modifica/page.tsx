import Link from "next/link";
import AppShell from "@/components/AppShell";
import SectionCard from "@/components/SectionCard";
import { supabaseServer } from "@/lib/supabase-server";
import { updateChannel } from "../../actions";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function ModificaCanalePage({ params }: PageProps) {
  const { id } = await params;

  const { data: channel, error } = await supabaseServer
    .from("channels")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !channel) {
    throw new Error(
      `Errore caricamento canale: ${error?.message || "Canale non trovato"}`
    );
  }

  return (
    <AppShell
      title="Modifica Canale"
      subtitle="Aggiorna le impostazioni del canale"
    >
      <div className="mb-4 flex items-center justify-end">
        <Link
          href="/canali"
          className="rounded-xl border border-zinc-300 bg-white px-5 py-2.5 text-sm font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-50"
        >
          ← Torna ai canali
        </Link>
      </div>

      <SectionCard title="Dati canale">
        <form action={updateChannel} className="space-y-6">
          <input type="hidden" name="id" value={channel.id} />

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label
                htmlFor="name"
                className="mb-2 block text-sm font-medium text-zinc-700"
              >
                Nome canale
              </label>
              <input
                id="name"
                name="name"
                type="text"
                required
                defaultValue={channel.name}
                className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-zinc-500"
              />
            </div>

            <div>
              <label
                htmlFor="type"
                className="mb-2 block text-sm font-medium text-zinc-700"
              >
                Tipo
              </label>
              <select
                id="type"
                name="type"
                required
                defaultValue={channel.type}
                className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-zinc-500"
              >
                <option value="ota">OTA (Online Travel Agency)</option>
                <option value="direct">Diretto</option>
                <option value="agency">Agenzia / Hotel / Struttura</option>
                <option value="internal">Interno / Partner</option>
              </select>

              <p className="mt-2 text-xs text-zinc-500">
                Usa <strong>agency</strong> per agenzie, hotel, tour operator,
                concierge, wedding planner e strutture che inviano o gestiscono
                la prenotazione.
              </p>
            </div>
          </div>

          <div>
            <label
              htmlFor="notes"
              className="mb-2 block text-sm font-medium text-zinc-700"
            >
              Note o Commissioni
            </label>
            <input
              id="notes"
              name="notes"
              type="text"
              defaultValue={channel.notes || ""}
              className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-zinc-500"
            />
          </div>

          <div className="flex justify-end border-t border-zinc-100 pt-4">
            <button
              type="submit"
              className="rounded-xl bg-zinc-900 px-6 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-zinc-700"
            >
              Aggiorna canale
            </button>
          </div>
        </form>
      </SectionCard>
    </AppShell>
  );
}