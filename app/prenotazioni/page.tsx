import Sidebar from "@/components/Sidebar";
import SectionCard from "@/components/SectionCard";
import { bookings } from "@/lib/data";

export default function PrenotazioniPage() {
  return (
    <main className="min-h-screen bg-zinc-50 p-6">
      <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[260px_1fr]">
        <Sidebar />

        <div className="space-y-6">
          <div>
            <h1 className="text-3xl font-bold text-zinc-900">Prenotazioni</h1>
            <p className="mt-1 text-zinc-600">
              Elenco prenotazioni e stato pagamenti
            </p>
          </div>

          <SectionCard title="Lista prenotazioni">
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-zinc-200 text-zinc-500">
                  <tr>
                    <th className="py-3 pr-4">ID</th>
                    <th className="py-3 pr-4">Cliente</th>
                    <th className="py-3 pr-4">Esperienza</th>
                    <th className="py-3 pr-4">Data</th>
                    <th className="py-3 pr-4">Pax</th>
                    <th className="py-3 pr-4">Totale</th>
                    <th className="py-3 pr-4">Cliente</th>
                    <th className="py-3 pr-4">Fornitore</th>
                  </tr>
                </thead>
                <tbody>
                  {bookings.map((booking) => (
                    <tr key={booking.id} className="border-b border-zinc-100">
                      <td className="py-3 pr-4">{booking.id}</td>
                      <td className="py-3 pr-4">{booking.customer}</td>
                      <td className="py-3 pr-4">{booking.experience}</td>
                      <td className="py-3 pr-4">{booking.date}</td>
                      <td className="py-3 pr-4">{booking.pax}</td>
                      <td className="py-3 pr-4">{booking.total}</td>
                      <td className="py-3 pr-4">{booking.customerPayment}</td>
                      <td className="py-3 pr-4">{booking.supplierPayment}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </div>
      </div>
    </main>
  );
}