import Link from "next/link";
import AppShell from "@/components/AppShell";
import SectionCard from "@/components/SectionCard";
import { updateExperience } from "../../actions";
import { getSuppliers } from "@/lib/queries";
import { supabaseServer } from "@/lib/supabase-server";

type PageProps = {
  params: Promise<{
    id: string;
  }>;
};

type BusinessUnit = {
  id: number;
  code: string;
  name: string;
  is_accounting_autonomous: boolean;
  is_active: boolean;
};

export default async function ModificaEsperienzaPage({ params }: PageProps) {
  const { id } = await params;
  const experienceId = Number(id);

  if (!experienceId) {
    throw new Error("ID esperienza non valido");
  }

  const [experienceResult, suppliers, businessUnitsResult] = await Promise.all([
    supabaseServer
      .from("experiences")
      .select(
        "id, name, bokun_id, supplier_id, supplier_unit_cost, notes, active, is_group_pricing, business_unit_id"
      )
      .eq("id", experienceId)
      .single(),
    getSuppliers(),
    supabaseServer
      .from("business_units")
      .select("id, code, name, is_accounting_autonomous, is_active")
      .eq("is_active", true)
      .order("id", { ascending: true }),
  ]);

  if (experienceResult.error || !experienceResult.data) {
    throw new Error(
      `Errore caricamento esperienza: ${
        experienceResult.error?.message || "Esperienza non trovata"
      }`
    );
  }

  if (businessUnitsResult.error) {
    throw new Error(
      `Errore caricamento business unit: ${businessUnitsResult.error.message}`
    );
  }

  const experience = experienceResult.data;
  const businessUnits = (businessUnitsResult.data ?? []) as BusinessUnit[];

  return (
    <AppShell
      title="Modifica esperienza"
      subtitle="Aggiorna i dettagli, il costo e la business unit dell'esperienza"
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
                htmlFor="business_unit_id"
                className="mb-2 block text-sm font-medium text-zinc-700"
              >
                Business unit
              </label>
              <select
                id="business_unit_id"
                name="business_unit_id"
                required
                defaultValue={experience.business_unit_id ?? ""}
                className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-zinc-500"
              >
                <option value="">Seleziona business unit</option>
                {businessUnits.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name}
                    {unit.is_accounting_autonomous
                      ? " • contabilità autonoma"
                      : ""}
                  </option>
                ))}
              </select>
              <p className="mt-2 text-xs text-zinc-500">
                Obbligatoria. Serve per separare correttamente FMDQ da
                Todointheworld.
              </p>
            </div>

            <div>
              <label
                htmlFor="bokun_id"
                className="mb-2 flex items-center gap-2 text-sm font-medium text-zinc-700"
              >
                Bokun ID
                <span className="rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-orange-700">
                  Opzionale
                </span>
              </label>
              <input
                id="bokun_id"
                name="bokun_id"
                type="text"
                defaultValue={experience.bokun_id ?? ""}
                className="w-full rounded-xl border border-zinc-300 bg-orange-50/30 px-4 py-3 text-sm outline-none transition focus:border-zinc-500 focus:bg-white"
                placeholder="Es. 956472"
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

            <div className="flex items-center pt-8">
              <div className="flex items-center gap-3 bg-zinc-50 px-4 py-3 rounded-xl border border-zinc-200 w-full">
                <input
                  id="is_group_pricing"
                  name="is_group_pricing"
                  type="checkbox"
                  defaultChecked={experience.is_group_pricing}
                  className="h-5 w-5 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-500"
                />
                <label
                  htmlFor="is_group_pricing"
                  className="text-sm font-medium text-zinc-800"
                >
                  Costo a gruppo{" "}
                  <span className="text-zinc-500 font-normal">
                    (non moltiplicare per pax)
                  </span>
                </label>
              </div>
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