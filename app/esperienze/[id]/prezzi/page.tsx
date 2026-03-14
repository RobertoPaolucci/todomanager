import Link from "next/link";
import AppShell from "@/components/AppShell";
import SectionCard from "@/components/SectionCard";
import { supabase } from "@/lib/supabase";
import { saveExperienceChannelPrices } from "./actions";

type PageProps = {
  params: Promise<{ id: string }>;
};

function valueForInput(value: number | string | null | undefined) {
  if (value === null || value === undefined) return "0";
  return String(value);
}

export default async function PrezziEsperienzaPage({ params }: PageProps) {
  const { id } = await params;
  const experienceId = Number(id);

  const [{ data: experience, error: experienceError }, { data: channels, error: channelsError }, { data: prices, error: pricesError }] =
    await Promise.all([
      supabase
        .from("experiences")
        .select("id, name")
        .eq("id", experienceId)
        .single(),
      supabase
        .from("channels")
        .select("id, name, type")
        .order("name", { ascending: true }),
      supabase
        .from("experience_channel_prices")
        .select("id, channel_id, your_unit_price, public_unit_price, currency, notes")
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
    <AppShell
      title="Prezzi canali"
      subtitle={experience?.name ?? ""}
    >
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

          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-zinc-200 text-zinc-500 uppercase text-[11px] font-bold">
                <tr>
                  <th className="py-3 pr-4">Canale</th>
                  <th className="py-3 pr-4">Tipo</th>
                  <th className="py-3 pr-4 text-zinc-900">Prezzo agenzia</th>
                  <th className="py-3 pr-4">Prezzo pubblico</th>
                  <th className="py-3 pr-4">Valuta</th>
                  <th className="py-3 pr-4">Note</th>
                </tr>
              </thead>

              <tbody>
                {(channels ?? []).map((channel) => {
                  const current = pricesMap.get(channel.id);

                  return (
                    <tr key={channel.id} className="border-b border-zinc-100 align-top transition hover:bg-zinc-50/50">
                      <td className="py-4 pr-4 font-medium text-zinc-900">
                        {channel.name}
                      </td>

                      <td className="py-4 pr-4 text-zinc-600 text-xs italic uppercase">
                        {channel.type}
                      </td>

                      <td className="py-4 pr-4">
                        <input
                          name={`your_unit_price_${channel.id}`}
                          type="number"
                          step="0.01"
                          min="0"
                          defaultValue={valueForInput(current?.your_unit_price)}
                          className="w-32 rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none transition focus:border-zinc-500"
                        />
                      </td>

                      <td className="py-4 pr-4">
                        <input
                          name={`public_unit_price_${channel.id}`}
                          type="number"
                          step="0.01"
                          min="0"
                          defaultValue={valueForInput(current?.public_unit_price)}
                          className="w-32 rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none transition focus:border-zinc-500"
                        />
                      </td>

                      <td className="py-4 pr-4">
                        <input
                          name={`currency_${channel.id}`}
                          type="text"
                          defaultValue={current?.currency ?? "EUR"}
                          className="w-24 rounded-xl border border-zinc-300 px-3 py-2 text-sm uppercase outline-none transition focus:border-zinc-500 bg-zinc-50 font-medium"
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
              className="rounded-xl bg-zinc-900 px-8 py-3 text-sm font-medium text-white transition hover:bg-zinc-700 shadow-sm"
            >
              Salva prezzi canale
            </button>
          </div>
        </form>
      </SectionCard>
    </AppShell>
  );
}