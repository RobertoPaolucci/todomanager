import AppShell from "@/components/AppShell";
import SectionCard from "@/components/SectionCard";
import { suppliers } from "@/lib/data";

export default function FornitoriPage() {
  return (
    <AppShell
      title="Fornitori"
      subtitle="Anagrafica fornitori e partner"
    >
      <SectionCard title="Lista fornitori">
        <div className="space-y-3">
          {suppliers.map((supplier) => (
            <div key={supplier.id} className="rounded-xl border border-zinc-200 p-4">
              <p className="font-semibold text-zinc-900">{supplier.name}</p>
              <p className="text-sm text-zinc-600">{supplier.service}</p>
              <p className="text-sm text-zinc-600">{supplier.email}</p>
              <p className="text-sm text-zinc-600">{supplier.phone}</p>
              <p className="mt-2 text-sm text-zinc-700">
                Stato: {supplier.status}
              </p>
            </div>
          ))}
        </div>
      </SectionCard>
    </AppShell>
  );
}