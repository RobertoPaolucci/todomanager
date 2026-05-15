import Link from "next/link";
import AppShell from "@/components/AppShell";
import SectionCard from "@/components/SectionCard";
import { supabaseServer } from "@/lib/supabase-server";
import { saveExperienceChannelPrices } from "./actions";

type PageProps = {
  params: Promise<{ id: string }>;
};

function valueForInput(value: number | string | null | undefined) {
  if (value === null || value === undefined) return "0";
  return String(value);
}

function valueForOptionalInput(value: number | string | null | undefined) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function formatCurrency(value: number | string | null | undefined) {
  const amount = Number(value || 0);

  return new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR",
  }).format(Number.isFinite(amount) ? amount : 0);
}

export default async function PrezziEsperienzaPage({ params }: PageProps) {
  const { id } = await params;
  const experienceId = Number(id);

  if (!experienceId || Number.isNaN(experienceId)) {
    throw new Error("ID esperienza non valido");
  }

  const [
    { data: experience, error: experienceError },
    { data: channels, error: channelsError },
    { data: prices, error: pricesError },
  ] = await Promise.all([
    supabaseServer
      .from("experiences")
      .select("id, name, supplier_unit_cost")
      .eq("id", experienceId)
      .single(),

    supabaseServer
      .from("channels")
      .select("id, name, type")
      .order("name", { ascending: true }),

    supabaseServer
      .from("experience_channel_prices")
      .select(
        "id, channel_id, your_unit_price, your_child_unit_price, public_unit_price, public_child_unit_price, supplier_child_unit_cost, currency, notes"
      )
      .eq("experience_id", experienceId),
  ]);

  if (experienceError) {
    throw new Error(`Errore caricamento esperienza: ${experienceError.message}`);
  }

  if (channelsError) {
    throw new Error(`Errore caricamento canali: ${channelsError.message}`);
  }

  if (pricesError) {
    throw new Error(`Errore caricamento prezzi canale: ${pricesError.message}`);
  }

  const pricesMap = new Map(
    (prices ?? []).map((price) => [price.channel_id, price])
  );

  return (
    <AppShell title="Prezzi canali" subtitle={experience?.name ?? ""}>
      <div className="mb-4 flex items-center justify-end">
        <Link
          href="/esperienze"
          className="rounded-xl border border-zinc-300 px-4 py-3 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100"
        >
          ← Torna alle esperienze
        </Link>
      </div>

      <SectionCard title="Prezzi per canale">
        <form action={saveExperienceChannelPrices} className="space-y-6">
          <input type="hidden" name="experience_id" value={experienceId} />

          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <strong>Prezzi bambini:</strong> se lasci vuoto il prezzo bambino,
            Todo Manager userà automaticamente il prezzo adulto. Il costo
            fornitore adulto resta quello impostato nella scheda esperienza:{" "}
            <strong>{formatCurrency(experience?.supplier_unit_cost)}</strong>.
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-[1320px] w-full text-left text-sm">
              <thead className="border-b border-zinc-200 text-[11px] font-bold uppercase text-zinc-500">
                <tr>
                  <th className="py-3 pr-4">Canale</th>
                  <th className="py-3 pr-4">Tipo</th>
                  <th className="py-3 pr-4 text-zinc-900">
                    Agenzia adulto
                  </th>
                  <th className="py-3 pr-4 text-zinc-900">
                    Agenzia bambino
                  </th>
                  <th className="py-3 pr-4">Pubblico adulto</th>
                  <th className="py-3 pr-4">Pubblico bambino</th>
                  <th className="py-3 pr-4">Costo forn. bambino</th>
                  <th className="py-3 pr-4">Valuta</th>
                  <th className="py-3 pr-4">Note</th>
                </tr>
              </thead>

              <tbody>
                {(channels ?? []).map((channel) => {
                  const current = pricesMap.get(channel.id);

                  return (
                    <tr
                      key={channel.id}
                      className="border-b border-zinc-100 align-top transition hover:bg-zinc-50/50"
                    >
                      <td className="py-4 pr-4 font-medium text-zinc-900">
                        {channel.name}
                      </td>

                      <td className="py-4 pr-4 text-xs uppercase italic text-zinc-600">
                        {channel.type}
                      </td>

                      <td className="py-4 pr-4">
                        <input
                          name={`your_unit_price_${channel.id}`}
                          type="number"
                          step="0.01"
                          min="0"
                          defaultValue={valueForInput(
                            current?.your_unit_price
                          )}
                          className="w-32 rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none transition focus:border-zinc-500"
                        />
                      </td>

                      <td className="py-4 pr-4">
                        <input
                          name={`your_child_unit_price_${channel.id}`}
                          type="number"
                          step="0.01"
                          min="0"
                          defaultValue={valueForOptionalInput(
                            current?.your_child_unit_price
                          )}
                          className="w-32 rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none transition focus:border-zinc-500"
                          placeholder="Come adulto"
                        />
                      </td>

                      <td className="py-4 pr-4">
                        <input
                          name={`public_unit_price_${channel.id}`}
                          type="number"
                          step="0.01"
                          min="0"
                          defaultValue={valueForInput(
                            current?.public_unit_price
                          )}
                          className="w-32 rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none transition focus:border-zinc-500"
                        />
                      </td>

                      <td className="py-4 pr-4">
                        <input
                          name={`public_child_unit_price_${channel.id}`}
                          type="number"
                          step="0.01"
                          min="0"
                          defaultValue={valueForOptionalInput(
                            current?.public_child_unit_price
                          )}
                          className="w-32 rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none transition focus:border-zinc-500"
                          placeholder="Come adulto"
                        />
                      </td>

                      <td className="py-4 pr-4">
                        <input
                          name={`supplier_child_unit_cost_${channel.id}`}
                          type="number"
                          step="0.01"
                          min="0"
                          defaultValue={valueForOptionalInput(
                            current?.supplier_child_unit_cost
                          )}
                          className="w-36 rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none transition focus:border-zinc-500"
                          placeholder="Come costo adulto"
                        />
                      </td>

                      <td className="py-4 pr-4">
                        <input
                          name={`currency_${channel.id}`}
                          type="text"
                          defaultValue={current?.currency ?? "EUR"}
                          className="w-24 rounded-xl border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm font-medium uppercase outline-none transition focus:border-zinc-500"
                        />
                      </td>

                      <td className="py-4 pr-4">
                        <input
                          name={`notes_${channel.id}`}
                          type="text"
                          defaultValue={current?.notes ?? ""}
                          className="w-full min-w-[220px] rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none transition focus:border-zinc-500"
                          placeholder="Note canale..."
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end border-t border-zinc-100 pt-6">
            <button
              type="submit"
              className="rounded-xl bg-zinc-900 px-8 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-zinc-700"
            >
              Salva prezzi canale
            </button>
          </div>
        </form>
      </SectionCard>
    </AppShell>
  );
}