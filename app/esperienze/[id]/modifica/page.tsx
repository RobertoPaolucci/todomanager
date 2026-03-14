import Link from "next/link";
import AppShell from "@/components/AppShell";
import SectionCard from "@/components/SectionCard";
import { updateExperience } from "../../actions";
import { getExperienceById, getSuppliers } from "@/lib/queries";

type PageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function ModificaEsperienzaPage({ params }: PageProps) {
  const { id } = await params;
  const experienceId = Number(id);

  const [experience, suppliers] = await Promise.all([
    getExperienceById(experienceId),
    getSuppliers(),
  ]);

  return (
    <AppShell
      title="Modifica esperienza"
      subtitle="Aggiorna i dettagli e il costo dell'esperienza"
    >
      <div className="mb-4 flex items-center justify-end">
        <Link
          href="/esperienze"
          className="rounded-xl border border-zinc-300 px-4 py-3 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100"
        >
          ← Torna alle esperienze
        </Link>
      </div>

      <SectionCard title="Dati esperienza">
        <form action={updateExperience} className="space-y-6">
          <input type="hidden" name="id" value={experience.id} />

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label
                htmlFor="name"
                className="mb-2 block text-sm font-medium text-zinc-700"
              >
                Nome esperienza
              </label>
              <input
                id="name"
                name="name"
                type="text"
                required
                defaultValue={experience.name}
                className="w-full rounded-xl border border-zinc-300 px-4 py-3 text-sm outline-none transition focus:border-zinc-500"
              />
            </div>

            <div>
              <label
                htmlFor="supplier_id"
                className="mb-2 block text-sm font-medium text-zinc-700"
              >
                Fornitore
              </label>
              <select
                id="supplier_id"
                name="supplier_id"
                className="w-full rounded-xl border border-zinc-300 px-4 py-3 text-sm outline-none transition focus:border-zinc-500 bg-white"
                defaultValue={experience.supplier_id ?? ""}
              >
                <option value="">Seleziona fornitore</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="supplier_unit_cost"
                className="mb-2 block text-sm font-medium text-zinc-700"
              >
                Costo fornitore (€)
              </label>
              <input
                id="supplier_unit_cost"
                name="supplier_unit_cost"
                type="number"
                step="0.01"
                min="0"
                defaultValue={experience.supplier_unit_cost ?? 0}
                className="w-full rounded-xl border border-zinc-300 px-4 py-3 text-sm outline-none transition focus:border-zinc-500"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="notes"
              className="mb-2 block text-sm font-medium text-zinc-700"
            >
              Note
            </label>
            <textarea
              id="notes"
              name="notes"
              rows={4}
              defaultValue={experience.notes ?? ""}
              className="w-full rounded-xl border border-zinc-300 px-4 py-3 text-sm outline-none transition focus:border-zinc-500"
            />
          </div>

          <div className="flex items-center gap-3">
            <input
              id="active"
              name="active"
              type="checkbox"
              defaultChecked={experience.active}
              className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-500"
            />
            <label htmlFor="active" className="text-sm text-zinc-700">
              Esperienza attiva
            </label>
          </div>

          <div className="flex justify-end border-t border-zinc-100 pt-6">
            <button
              type="submit"
              className="rounded-xl bg-zinc-900 px-8 py-3 text-sm font-medium text-white transition hover:bg-zinc-700 shadow-sm"
            >
              Aggiorna esperienza
            </button>
          </div>
        </form>
      </SectionCard>
    </AppShell>
  );
}