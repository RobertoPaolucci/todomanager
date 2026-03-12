import Link from "next/link";
import AppShell from "@/components/AppShell";
import SectionCard from "@/components/SectionCard";
import { supabase } from "@/lib/supabase";

export default async function PrenotazioniPage() {
  const { data: bookings, error } = await supabase
    .from("bookings")
    .select("*")
    .order("booking_date", { ascending: true });

  return (
    <AppShell
      title="Prenotazioni"
      subtitle="Elenco prenotazioni e stato pagamenti"
    >
      <div className="flex items-center justify-end">
        <Link
          href="/prenotazioni/nuova"
          className="rounded-xl bg-zinc-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-zinc-700"
        >
          + Nuova prenotazione
        </Link>
      </div>

      <SectionCard title="Lista prenotazioni">
        {error ? (
          <p className="text-sm text-red-600">
            Errore nel caricamento prenotazioni
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-zinc-200 text-zinc-500">
                <tr>
                  <th className="py-3 pr-4">ID</th>
                  <th className="py-3 pr-4">Canale</th>
                  <th className="py-3 pr-4">Rif.</th>
                  <th className="py-3 pr-4">Data pren.</th>
                  <th className="py-3 pr-4">Cliente</th>
                  <th className="py-3 pr-4">Esperienza</th>
                  <th className="py-3 pr-4">Data</th>
                  <th className="py-3 pr-4">Ora</th>
                  <th className="py-3 pr-4">Persone</th>
                  <th className="py-3 pr-4">Cliente €</th>
                  <th className="py-3 pr-4">A te €</th>
                  <th className="py-3 pr-4">Fornitore €</th>
                  <th className="py-3 pr-4">Margine €</th>
                </tr>
              </thead>
              <tbody>
                {bookings?.map((booking) => (
                  <tr key={booking.id} className="border-b border-zinc-100">
                    <td className="py-3 pr-4">{booking.id}</td>
                    <td className="py-3 pr-4">{booking.booking_source}</td>
                    <td className="py-3 pr-4">{booking.booking_reference || "-"}</td>
                    <td className="py-3 pr-4">{booking.booking_created_at || "-"}</td>
                    <td className="py-3 pr-4">{booking.customer_name}</td>
                    <td className="py-3 pr-4">{booking.experience_name}</td>
                    <td className="py-3 pr-4">{booking.booking_date}</td>
                    <td className="py-3 pr-4">{booking.booking_time || "-"}</td>
                    <td className="py-3 pr-4">{booking.total_people ?? booking.pax}</td>
                    <td className="py-3 pr-4">€ {booking.total_customer}</td>
                    <td className="py-3 pr-4">€ {booking.total_to_you}</td>
                    <td className="py-3 pr-4">€ {booking.total_supplier_cost}</td>
                    <td className="py-3 pr-4 font-semibold">€ {booking.margin_total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </AppShell>
  );
}