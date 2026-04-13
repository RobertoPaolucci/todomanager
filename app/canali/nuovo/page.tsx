import Link from "next/link";
import AppShell from "@/components/AppShell";
import SectionCard from "@/components/SectionCard";
import { createChannel } from "../actions";

export default function NuovoCanalePage() {
  return (
    <AppShell
      title="Nuovo Canale"
      subtitle="Aggiungi una nuova agenzia, struttura, partner o OTA"
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
        <form action={createChannel} className="space-y-6">
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
                placeholder="Es. Viator, Hotel XYZ, Rossi Travel"
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
                className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-zinc-500"
                defaultValue="agency"
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
              placeholder="Es. Trattiene il 20% di commissione"
              className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-zinc-500"
            />
          </div>

          <div className="flex justify-end border-t border-zinc-100 pt-4">
            <button
              type="submit"
              className="rounded-xl bg-zinc-900 px-6 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-zinc-700"
            >
              Salva canale
            </button>
          </div>
        </form>
      </SectionCard>
    </AppShell>
  );
}