import AppShell from "@/components/AppShell";
import SectionCard from "@/components/SectionCard";
import { customers } from "@/lib/data";

export default function ClientiPage() {
  return (
    <AppShell title="Clienti" subtitle="Anagrafica clienti">
      <SectionCard title="Lista clienti">
        <div className="space-y-3">
          {customers.map((customer) => (
            <div key={customer.id} className="rounded-xl border border-zinc-200 p-4">
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
    </AppShell>
  );
}