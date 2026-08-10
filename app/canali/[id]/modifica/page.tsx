import Link from "next/link";
import AppShell from "@/components/AppShell";
import SectionCard from "@/components/SectionCard";
import { supabaseServer } from "@/lib/supabase-server";
import { updateChannel } from "../../actions";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function ModificaCanalePage({
  params,
}: PageProps) {
  const { id } = await params;

  const { data: channel, error } = await supabaseServer
    .from("channels")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !channel) {
    throw new Error(
      `Errore caricamento canale: ${
        error?.message || "Canale non trovato"
      }`
    );
  }

  return (
    <AppShell title="Modifica canale">
      <div className="space-y-6">
        <div>
          <Link
            href="/canali"
            className="text-sm font-medium text-zinc-600 hover:text-zinc-900"
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
                  Nome canale / Nickname
                </label>

                <input
                  id="name"
                  name="name"
                  type="text"
                  required
                  defaultValue={channel.name}
                  placeholder="Es. Curioseety"
                  className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-zinc-500"
                />

                <p className="mt-2 text-xs text-zinc-500">
                  Nome breve usato internamente in Todo Manager.
                </p>
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
                  <option value="ota">
                    OTA (Online Travel Agency)
                  </option>

                  <option value="direct">
                    Diretto
                  </option>

                  <option value="agency">
                    Agenzia / Hotel / Struttura
                  </option>

                  <option value="internal">
                    Interno / Partner
                  </option>
                </select>

                <p className="mt-2 text-xs text-zinc-500">
                  Usa <strong>agency</strong> per agenzie, hotel,
                  tour operator, concierge, wedding planner e strutture
                  che inviano o gestiscono la prenotazione.
                </p>
              </div>
            </div>

            <div>
              <label
                htmlFor="company_name"
                className="mb-2 block text-sm font-medium text-zinc-700"
              >
                Nome reale azienda / Ragione sociale
              </label>

              <input
                id="company_name"
                name="company_name"
                type="text"
                defaultValue={channel.company_name || ""}
                placeholder="Es. Timonfaya Travel Lanzarote"
                className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-zinc-500"
              />

              <p className="mt-2 text-xs text-zinc-500">
                Verrà mostrato nei riepiloghi di fatturazione accanto
                al nickname del canale.
              </p>
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
                placeholder="Es. Commissione 20%, referente, condizioni..."
                className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-zinc-500"
              />
            </div>

            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  name="fattura_mensile_fmdq"
                  defaultChecked={
                    channel.fattura_mensile_fmdq === true
                  }
                  className="mt-1 h-5 w-5 rounded border-zinc-300"
                />

                <div>
                  <div className="text-sm font-semibold text-zinc-800">
                    Richiede fattura mensile FMDQ
                  </div>

                  <p className="mt-1 text-sm text-zinc-500">
                    Le esperienze prenotate tramite questo canale saranno
                    incluse nel riepilogo mensile delle attività da fatturare
                    da Fattoria Madonna della Querce.
                  </p>
                </div>
              </label>
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
      </div>
    </AppShell>
  );
}