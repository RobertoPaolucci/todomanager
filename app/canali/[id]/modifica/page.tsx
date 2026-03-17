import Link from "next/link";
import AppShell from "@/components/AppShell";
import SectionCard from "@/components/SectionCard";
import { supabase } from "@/lib/supabase";
import { updateChannel } from "../../actions";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function ModificaCanalePage({ params }: PageProps) {
  const { id } = await params;
  
  const { data: channel } = await supabase
    .from("channels")
    .select("*")
    .eq("id", id)
    .single();

  return (
    <AppShell
      title="Modifica Canale"
      subtitle="Aggiorna le impostazioni dell'agenzia"
    >
      <div className="mb-4 flex items-center justify-end">
        <Link
          href="/canali"
          className="rounded-xl border border-zinc-300 px-5 py-2.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 bg-white shadow-sm"
        >
          ← Torna ai canali
        </Link>
      </div>

      <SectionCard title="Dati canale">
        <form action={updateChannel} className="space-y-6">
          <input type="hidden" name="id" value={channel.id} />
          
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="name" className="mb-2 block text-sm font-medium text-zinc-700">
                Nome canale
              </label>
              <input
                id="name"
                name="name"
                type="text"
                required
                defaultValue={channel.name}
                className="w-full rounded-xl border border-zinc-300 px-4 py-3 text-sm outline-none transition focus:border-zinc-500 bg-white"
              />
            </div>

            <div>
              <label htmlFor="type" className="mb-2 block text-sm font-medium text-zinc-700">
                Tipo
              </label>
              <select
                id="type"
                name="type"
                defaultValue={channel.type}
                className="w-full rounded-xl border border-zinc-300 px-4 py-3 text-sm outline-none transition focus:border-zinc-500 bg-white"
              >
                <option value="ota">OTA (Online Travel Agency)</option>
                <option value="direct">Diretto</option>
                <option value="internal">Interno / Partner</option>
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="notes" className="mb-2 block text-sm font-medium text-zinc-700">
              Note o Commissioni
            </label>
            <input
              id="notes"
              name="notes"
              type="text"
              defaultValue={channel.notes || ""}
              className="w-full rounded-xl border border-zinc-300 px-4 py-3 text-sm outline-none transition focus:border-zinc-500 bg-white"
            />
          </div>

          <div className="pt-4 border-t border-zinc-100 flex justify-end">
            <button
              type="submit"
              className="rounded-xl bg-zinc-900 px-6 py-3 text-sm font-medium text-white transition hover:bg-zinc-700 shadow-sm"
            >
              Aggiorna canale
            </button>
          </div>
        </form>
      </SectionCard>
    </AppShell>
  );
}