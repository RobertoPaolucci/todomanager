import Link from "next/link";
import AppShell from "@/components/AppShell";
import SectionCard from "@/components/SectionCard";
import { deleteSupplier } from "./actions";
import { getAllSuppliers } from "@/lib/queries";

export default async function FornitoriPage() {
  const suppliers = await getAllSuppliers();

  return (
    <AppShell title="Fornitori" subtitle="Anagrafica fornitori e partner">
      <div className="mb-4 flex items-center justify-end">
        <Link
          href="/fornitori/nuovo"
          className="rounded-xl bg-zinc-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-zinc-700"
        >
          + Nuovo fornitore
        </Link>
      </div>

      <SectionCard title="Lista fornitori">
        {suppliers.length === 0 ? (
          <p className="text-sm text-zinc-500">Nessun fornitore inserito.</p>
        ) : (
          <div className="space-y-3">
            {suppliers.map((supplier) => (
              <div
                key={supplier.id}
                className="rounded-xl border border-zinc-200 p-4"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="font-semibold text-zinc-900">{supplier.name}</p>

                    {supplier.contact_person && (
                      <p className="text-sm text-zinc-600">
                        Contatto: {supplier.contact_person}
                      </p>
                    )}

                    {supplier.email && (
                      <p className="text-sm text-zinc-600">{supplier.email}</p>
                    )}

                    {supplier.phone && (
                      <p className="text-sm text-zinc-600">{supplier.phone}</p>
                    )}

                    {supplier.website && (
                      <p className="text-sm text-zinc-600">{supplier.website}</p>
                    )}

                    {supplier.notes && (
                      <p className="mt-2 text-sm text-zinc-700">
                        {supplier.notes}
                      </p>
                    )}

                    <p className="mt-2 text-sm text-zinc-700">
                      Stato: {supplier.active ? "attivo" : "non attivo"}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={`/fornitori/${supplier.id}/report`}
                      className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700 hover:bg-blue-100"
                    >
                      Report
                    </Link>

                    <Link
                      href={`/fornitori/${supplier.id}/modifica`}
                      className="rounded-lg border border-zinc-300 px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
                    >
                      Modifica
                    </Link>

                    <form action={deleteSupplier}>
                      <input type="hidden" name="id" value={supplier.id} />
                      <button
                        type="submit"
                        className="rounded-lg border border-red-200 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50"
                      >
                        Elimina
                      </button>
                    </form>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </AppShell>
  );
}