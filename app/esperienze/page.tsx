import Link from "next/link";
import AppShell from "@/components/AppShell";
import SectionCard from "@/components/SectionCard";
import { deleteExperience } from "./actions";
import { getExperiences } from "@/lib/queries";

function formatEuro(value: number) {
  return new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2,
  }).format(value);
}

export default async function EsperienzePage() {
  const experiences = await getExperiences();

  return (
    <AppShell
      title="Esperienze"
      subtitle="Gestione esperienze e fornitori"
    >
      <div className="flex items-center justify-end">
        <Link
          href="/esperienze/nuova"
          className="rounded-xl bg-zinc-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-zinc-700"
        >
          + Nuova esperienza
        </Link>
      </div>

      <SectionCard title="Lista esperienze">
        {experiences.length === 0 ? (
          <p className="text-sm text-zinc-600">Nessuna esperienza presente.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-zinc-200 text-zinc-500 uppercase text-[11px] font-bold">
                <tr>
                  <th className="py-3 pr-4">Esperienza</th>
                  {/* NUOVA COLONNA BOKUN ID */}
                  <th className="py-3 pr-4">Bokun ID</th>
                  <th className="py-3 pr-4">Fornitore</th>
                  <th className="py-3 pr-4 text-right">Costo Fornitore</th>
                  <th className="py-3 pr-4 text-center">Stato</th>
                  <th className="py-3 pr-4 text-right">Azioni</th>
                </tr>
              </thead>

              <tbody>
                {experiences.map((experience) => {
                  const supplier = (experience as any).suppliers;
                  let supplierName = "Non assegnato";
                  
                  if (supplier) {
                    supplierName = Array.isArray(supplier) 
                      ? (supplier[0]?.name || "Non assegnato") 
                      : (supplier.name || "Non assegnato");
                  }

                  const bokunId = (experience as any).bokun_id;

                  return (
                    <tr key={experience.id} className="border-b border-zinc-100 transition hover:bg-zinc-50/50">
                      <td className="py-3 pr-4 font-medium text-zinc-900">
                        {experience.name}
                      </td>

                      {/* CELLA BOKUN ID */}
                      <td className="py-3 pr-4">
                        {bokunId ? (
                          <span className="font-mono text-[11px] font-bold bg-orange-50 text-orange-700 border border-orange-100 px-2 py-0.5 rounded">
                            {bokunId}
                          </span>
                        ) : (
                          <span className="text-[10px] text-zinc-400 italic">Non collegato</span>
                        )}
                      </td>

                      <td className="py-3 pr-4">
                        {supplierName === "Non assegnato" ? (
                          <span className="text-xs italic text-zinc-400">Non assegnato</span>
                        ) : (
                          <span className="text-zinc-600">{supplierName}</span>
                        )}
                      </td>

                      <td className="py-3 pr-4 text-right font-mono">
                        {formatEuro(Number(experience.supplier_unit_cost || 0))}
                      </td>

                      <td className="py-3 pr-4 text-center">
                        <span
                          className={`rounded-lg px-2 py-1 text-[10px] font-bold uppercase ${
                            experience.active
                              ? "bg-green-100 text-green-700"
                              : "bg-zinc-200 text-zinc-700"
                          }`}
                        >
                          {experience.active ? "attiva" : "non attiva"}
                        </span>
                      </td>

                      <td className="py-3 pr-4 text-right">
                        <div className="flex justify-end gap-2">
                          <Link
                            href={`/esperienze/${experience.id}/prezzi`}
                            className="rounded-lg border border-blue-300 px-3 py-2 text-xs font-medium text-blue-700 hover:bg-blue-50 transition"
                          >
                            Prezzi
                          </Link>

                          <Link
                            href={`/esperienze/${experience.id}/modifica`}
                            className="rounded-lg border border-zinc-300 px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-100 transition"
                          >
                            Modifica
                          </Link>

                          <form action={deleteExperience}>
                            <input type="hidden" name="id" value={experience.id} />
                            <button
                              type="submit"
                              className="rounded-lg border border-red-200 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50 transition"
                            >
                              Elimina
                            </button>
                          </form>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </AppShell>
  );
}