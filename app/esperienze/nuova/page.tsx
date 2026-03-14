import Link from "next/link";
import AppShell from "@/components/AppShell";
import SectionCard from "@/components/SectionCard";
import { createExperience } from "../actions";
import { getSuppliers } from "@/lib/queries";

export default async function NuovaEsperienzaPage() {
  const suppliers = await getSuppliers();

  return (
    <AppShell
      title="Nuova esperienza"
      subtitle="Crea una nuova esperienza e imposta il costo"
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
        <form action={createExperience} className="space-y-6">
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
                className="w-full rounded-xl border border-zinc-300 px-4 py-3 text-sm outline-none transition focus:border-zinc-500"
                placeholder="Es. Wine Tasting Montepulciano"
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
                defaultValue=""
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
                defaultValue="0"
                className="w-full rounded-xl border border-zinc-300 px-4 py-3 text-sm outline-none transition focus:border-zinc-500"
                placeholder="0.00"
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
              className="w-full rounded-xl border border-zinc-300 px-4 py-3 text-sm outline-none transition focus:border-zinc-500"
              placeholder="Note interne..."
            />
          </div>

          <div className="flex items-center gap-3">
            <input
              id="active"
              name="active"
              type="checkbox"
              defaultChecked
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
              Salva esperienza
            </button>
          </div>
        </form>
      </SectionCard>
    </AppShell>
  );
}