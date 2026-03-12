import AppShell from "@/components/AppShell";
import SectionCard from "@/components/SectionCard";
import StatCard from "@/components/StatCard";
import { getDashboardStats } from "@/lib/dashboard";

function formatEuro(value: number) {
  return new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2,
  }).format(value);
}

export default async function Home() {
  const { totals, bookingsByChannel } = await getDashboardStats();

  return (
    <AppShell
      title="Dashboard"
      subtitle="Panoramica economica e operativa del gestionale"
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Totale cliente"
          value={formatEuro(totals.totalCustomer)}
        />
        <StatCard
          title="Totale a te"
          value={formatEuro(totals.totalToYou)}
        />
        <StatCard
          title="Totale fornitori"
          value={formatEuro(totals.totalSupplier)}
        />
        <StatCard
          title="Margine totale"
          value={formatEuro(totals.totalMargin)}
        />
      </div>

      <SectionCard title="Prenotazioni per canale">
        {bookingsByChannel.length === 0 ? (
          <p className="text-sm text-zinc-600">
            Nessuna prenotazione disponibile.
          </p>
        ) : (
          <div className="space-y-3">
            {bookingsByChannel.map((item) => (
              <div
                key={item.channel}
                className="flex items-center justify-between rounded-xl border border-zinc-200 p-4"
              >
                <div>
                  <p className="font-medium text-zinc-900">{item.channel}</p>
                  <p className="text-sm text-zinc-500">
                    Numero prenotazioni registrate
                  </p>
                </div>

                <div className="rounded-xl bg-zinc-900 px-3 py-2 text-sm font-semibold text-white">
                  {item.count}
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </AppShell>
  );
}