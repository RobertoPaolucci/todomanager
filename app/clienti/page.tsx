import Sidebar from "@/components/Sidebar";
import SectionCard from "@/components/SectionCard";
import { customers } from "@/lib/data";

export default function ClientiPage() {
  return (
    <main className="min-h-screen bg-zinc-50 p-6">
      <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[260px_1fr]">
        <Sidebar />

        <div className="space-y-6">
          <div>
            <h1 className="text-3xl font-bold text-zinc-900">Clienti</h1>
            <p className="mt-1 text-zinc-600">Anagrafica clienti</p>
          </div>

          <SectionCard title="Lista clienti">
            <div className="space-y-3">
              {customers.map((customer) => (
                <div
                  key={customer.id}
                  className="rounded-xl border border-zinc-200 p-4"
                >
                  <p className="font-semibold text-zinc-900">{customer.name}</p>
                  <p className="text-sm text-zinc-600">{customer.email}</p>
                  <p className="text-sm text-zinc-600">{customer.phone}</p>
                  <p className="mt-2 text-sm text-zinc-700">
                    Prenotazioni: {customer.totalBookings}
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