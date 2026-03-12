import Sidebar from "@/components/Sidebar";
import StatCard from "@/components/StatCard";
import SectionCard from "@/components/SectionCard";
import { alerts, stats, upcomingBookings } from "@/lib/data";

export default function Home() {
  return (
    <main className="min-h-screen bg-zinc-50 p-6">
      <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[260px_1fr]">
        <Sidebar />

        <div className="space-y-6">
          <div>
            <p className="text-sm text-zinc-500">ToDo Manager</p>
            <h1 className="text-3xl font-bold text-zinc-900">Dashboard</h1>
            <p className="mt-1 text-zinc-600">
              Gestionale prenotazioni, clienti, fornitori e pagamenti
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {stats.map((stat) => (
              <StatCard key={stat.title} title={stat.title} value={stat.value} />
            ))}
          </div>

          <SectionCard title="Prenotazioni prossime">
            <div className="space-y-3">
              {upcomingBookings.map((booking) => (
                <div
                  key={booking.id}
                  className="rounded-xl border border-zinc-200 p-4"
                >
                  <p className="font-semibold text-zinc-900">
                    {booking.experience}
                  </p>
                  <p className="text-sm text-zinc-600">
                    {booking.customer} • {booking.pax} pax • {booking.date}
                  </p>
                  <p className="mt-2 text-sm font-medium text-zinc-800">
                    {booking.status}
                  </p>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Attenzione">
            <ul className="space-y-2 text-zinc-700">
              {alerts.map((alert) => (
                <li key={alert}>• {alert}</li>
              ))}
            </ul>
          </SectionCard>
        </div>
      </div>
    </main>
  );
}