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
      subtitle="Gestione esperienze, fornitori e prezzi base"
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
              <thead className="border-b border-zinc-200 text-zinc-500">
                <tr>
                  <th className="py-3 pr-4">Esperienza</th>
                  <th className="py-3 pr-4">Fornitore</th>
                  <th className="py-3 pr-4">Costo fornitore</th>
                  <th className="py-3 pr-4">Prezzo TOD</th>
                  <th className="py-3 pr-4">Stato</th>
                  <th className="py-3 pr-4">Azioni</th>
                </tr>
              </thead>

              <tbody>
                {experiences.map((experience) => (
                  <tr
                    key={experience.id}
                    className="border-b border-zinc-100"
                  >
                    <td className="py-3 pr-4 font-medium text-zinc-900">
                      {experience.name}
                    </td>

                    <td className="py-3 pr-4">
                      {experience.suppliers && Array.isArray(experience.suppliers)
                        ? experience.suppliers[0]?.name || "-"
                        : "-"}
                    </td>

                    <td className="py-3 pr-4">
                      {formatEuro(Number(experience.supplier_unit_cost || 0))}
                    </td>

                    <td className="py-3 pr-4">
                      {formatEuro(Number(experience.base_price || 0))}
                    </td>

                    <td className="py-3 pr-4">
                      <span
                        className={`rounded px-2 py-1 text-xs font-medium ${
                          experience.active
                            ? "bg-green-100 text-green-700"
                            : "bg-zinc-200 text-zinc-700"
                        }`}
                      >
                        {experience.active ? "attiva" : "non attiva"}
                      </span>
                    </td>

                    <td className="py-3 pr-4">
                      <div className="flex gap-2">
                        <Link
                          href={`/esperienze/${experience.id}/modifica`}
                          className="rounded-lg border border-zinc-300 px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
                        >
                          Modifica
                        </Link>

                        <form action={deleteExperience}>
                          <input type="hidden" name="id" value={experience.id} />
                          <button
                            type="submit"
                            className="rounded-lg border border-red-200 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50"
                          >
                            Elimina
                          </button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </AppShell>
  );
}