export const dynamic = "force-dynamic";

import Link from "next/link";
import Sidebar from "@/components/Sidebar";
import SectionCard from "@/components/SectionCard";
import { supabaseServer } from "@/lib/supabase-server";
import { deleteChannel } from "./actions";

export default async function CanaliPage() {
  const { data: channels, error } = await supabaseServer
    .from("channels")
    .select("*")
    .order("name");

  if (error) console.error("Errore caricamento canali:", error.message);

  const allChannels = channels || [];

  return (
    <main className="min-h-screen bg-zinc-50 p-6">
      <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[260px_1fr]">
        <Sidebar />

        <div className="space-y-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-3xl font-bold text-zinc-900">Canali</h1>
              <p className="mt-1 text-zinc-600">
                Gestisci agenzie, OTA e canali diretti
              </p>
            </div>

            <Link
              href="/canali/nuovo"
              className="inline-flex items-center justify-center rounded-xl bg-zinc-900 px-5 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-zinc-700"
            >
              + Nuovo canale
            </Link>
          </div>

          <SectionCard title="Lista canali">
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-zinc-200 text-[10px] font-bold uppercase text-zinc-500">
                  <tr>
                    <th className="py-3 pr-4">Nome Canale</th>
                    <th className="py-3 pr-4">Tipo</th>
                    <th className="py-3 pr-4">Note</th>
                    <th className="py-3 pr-4 text-right">Azioni</th>
                  </tr>
                </thead>
                <tbody>
                  {allChannels.map((c) => (
                    <tr
                      key={c.id}
                      className="border-b border-zinc-100 transition hover:bg-zinc-50"
                    >
                      <td className="py-4 pr-4 font-bold text-zinc-900">
                        {c.name}
                      </td>
                      <td className="py-4 pr-4">
                        <span className="inline-block rounded border border-blue-200 bg-blue-50 px-2 py-1 text-[10px] font-bold uppercase text-blue-700">
                          {c.type || "N/A"}
                        </span>
                      </td>
                      <td className="py-4 pr-4 text-xs text-zinc-500">
                        {c.notes || "-"}
                      </td>
                      <td className="py-4 pr-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Link
                            href={`/canali/${c.id}/modifica`}
                            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-[11px] font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-100"
                          >
                            Modifica
                          </Link>
                          <form action={deleteChannel} className="inline-block">
                            <input type="hidden" name="id" value={c.id} />
                            <button
                              type="submit"
                              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-bold text-red-700 shadow-sm transition hover:bg-red-100"
                            >
                              Cancella
                            </button>
                          </form>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {allChannels.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-8 text-center text-zinc-500">
                        Nessun canale inserito. Clicca su "+ Nuovo canale" in alto.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </div>
      </div>
    </main>
  );
}