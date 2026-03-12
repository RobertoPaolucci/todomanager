import AppShell from "@/components/AppShell";
import SectionCard from "@/components/SectionCard";
import { payments } from "@/lib/data";

export default function PagamentiPage() {
  return (
    <AppShell
      title="Pagamenti"
      subtitle="Incassi clienti e pagamenti fornitori"
    >
      <SectionCard title="Movimenti">
        <div className="space-y-3">
          {payments.map((payment) => (
            <div key={payment.id} className="rounded-xl border border-zinc-200 p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="font-semibold text-zinc-900">{payment.type}</p>
                  <p className="text-sm text-zinc-600">{payment.subject}</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-zinc-900">{payment.amount}</p>
                  <p className="text-sm text-zinc-600">{payment.date}</p>
                </div>
              </div>
              <p className="mt-2 text-sm text-zinc-700">Stato: {payment.status}</p>
            </div>
          ))}
        </div>
      </SectionCard>
    </AppShell>
  );
}