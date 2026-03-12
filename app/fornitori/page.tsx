import Sidebar from "@/components/Sidebar";
import SectionCard from "@/components/SectionCard";
import { suppliers } from "@/lib/data";

export default function FornitoriPage() {
  return (
    <main className="min-h-screen bg-zinc-50 p-6">
      <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[260px_1fr]">
        <Sidebar />

        <div className="space-y-6">
          <div>
            <h1 className="text-3xl font-bold text-zinc-900">Fornitori</h1>
            <p className="mt-1 text-zinc-600">Anagrafica fornitori e partner</p>
          </div>

          <SectionCard title="Lista fornitori">
            <div className="space-y-3">
              {suppliers.map((supplier) => (
                <div
                  key={supplier.id}
                  className="rounded-xl border border-zinc-200 p-4"
                >
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
        </div>
      </div>
    </main>
  );
}