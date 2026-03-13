import Link from "next/link";
import AppShell from "@/components/AppShell";
import SectionCard from "@/components/SectionCard";
import { supabase } from "@/lib/supabase";
import { updateBooking } from "../../actions";
import { getChannels, getExperiences } from "@/lib/queries";

type PageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function ModificaPrenotazionePage({ params }: PageProps) {
  const { id } = await params;
  const bookingId = Number(id);

  const [channels, experiences, bookingResult] = await Promise.all([
    getChannels(),
    getExperiences(),
    supabase.from("bookings").select("*").eq("id", bookingId).single(),
  ]);

  if (bookingResult.error || !bookingResult.data) {
    throw new Error("Prenotazione non trovata");
  }

  const booking = bookingResult.data;

  return (
    <AppShell
      title="Modifica prenotazione"
      subtitle="Aggiorna i dati della prenotazione"
    >
      <div className="mb-4 flex items-center justify-end">
        <Link
          href="/prenotazioni"
          className="rounded-xl border border-zinc-300 px-4 py-3 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100"
        >
          ← Torna alle prenotazioni
        </Link>
      </div>

      <SectionCard title="Dati prenotazione">
        <form action={updateBooking} className="space-y-6">
          <input type="hidden" name="id" value={booking.id} />

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="channel_id" className="mb-2 block text-sm font-medium text-zinc-700">
                Canale
              </label>
              <select
                id="channel_id"
                name="channel_id"
                defaultValue={booking.channel_id}
                className="w-full rounded-xl border border-zinc-300 px-4 py-3 text-sm outline-none transition focus:border-zinc-500"
              >
                {channels.map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    {channel.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="experience_id" className="mb-2 block text-sm font-medium text-zinc-700">
                Esperienza
              </label>
              <select
                id="experience_id"
                name="experience_id"
                defaultValue={booking.experience_id}
                className="w-full rounded-xl border border-zinc-300 px-4 py-3 text-sm outline-none transition focus:border-zinc-500"
              >
                {experiences.map((experience) => (
                  <option key={experience.id} value={experience.id}>
                    {experience.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="booking_reference" className="mb-2 block text-sm font-medium text-zinc-700">
                Riferimento prenotazione
              </label>
              <input
                id="booking_reference"
                name="booking_reference"
                type="text"
                defaultValue={booking.booking_reference ?? ""}
                className="w-full rounded-xl border border-zinc-300 px-4 py-3 text-sm outline-none transition focus:border-zinc-500"
              />
            </div>

            <div>
              <label htmlFor="booking_created_at" className="mb-2 block text-sm font-medium text-zinc-700">
                Data prenotazione
              </label>
              <input
                id="booking_created_at"
                name="booking_created_at"
                type="date"
                defaultValue={booking.booking_created_at}
                className="w-full rounded-xl border border-zinc-300 px-4 py-3 text-sm outline-none transition focus:border-zinc-500"
              />
            </div>

            <div>
              <label htmlFor="customer_name" className="mb-2 block text-sm font-medium text-zinc-700">
                Cliente
              </label>
              <input
                id="customer_name"
                name="customer_name"
                type="text"
                defaultValue={booking.customer_name}
                className="w-full rounded-xl border border-zinc-300 px-4 py-3 text-sm outline-none transition focus:border-zinc-500"
              />
            </div>

            <div>
              <label htmlFor="customer_phone" className="mb-2 block text-sm font-medium text-zinc-700">
                Telefono
              </label>
              <input
                id="customer_phone"
                name="customer_phone"
                type="text"
                defaultValue={booking.customer_phone ?? ""}
                className="w-full rounded-xl border border-zinc-300 px-4 py-3 text-sm outline-none transition focus:border-zinc-500"
              />
            </div>

            <div>
              <label htmlFor="customer_email" className="mb-2 block text-sm font-medium text-zinc-700">
                Email
              </label>
              <input
                id="customer_email"
                name="customer_email"
                type="email"
                defaultValue={booking.customer_email ?? ""}
                className="w-full rounded-xl border border-zinc-300 px-4 py-3 text-sm outline-none transition focus:border-zinc-500"
              />
            </div>

            <div>
              <label htmlFor="booking_date" className="mb-2 block text-sm font-medium text-zinc-700">
                Data esperienza
              </label>
              <input
                id="booking_date"
                name="booking_date"
                type="date"
                defaultValue={booking.booking_date}
                className="w-full rounded-xl border border-zinc-300 px-4 py-3 text-sm outline-none transition focus:border-zinc-500"
              />
            </div>

            <div>
              <label htmlFor="booking_time" className="mb-2 block text-sm font-medium text-zinc-700">
                Ora
              </label>
              <input
                id="booking_time"
                name="booking_time"
                type="time"
                defaultValue={booking.booking_time ?? ""}
                className="w-full rounded-xl border border-zinc-300 px-4 py-3 text-sm outline-none transition focus:border-zinc-500"
              />
            </div>

            <div>
              <label htmlFor="adults" className="mb-2 block text-sm font-medium text-zinc-700">
                Adulti
              </label>
              <input
                id="adults"
                name="adults"
                type="number"
                min="0"
                defaultValue={booking.adults ?? booking.total_people ?? 1}
                className="w-full rounded-xl border border-zinc-300 px-4 py-3 text-sm outline-none transition focus:border-zinc-500"
              />
            </div>

            <div>
              <label htmlFor="children" className="mb-2 block text-sm font-medium text-zinc-700">
                Bambini
              </label>
              <input
                id="children"
                name="children"
                type="number"
                min="0"
                defaultValue={booking.children ?? 0}
                className="w-full rounded-xl border border-zinc-300 px-4 py-3 text-sm outline-none transition focus:border-zinc-500"
              />
            </div>

            <div>
              <label htmlFor="total_amount" className="mb-2 block text-sm font-medium text-zinc-700">
                Totale cliente
              </label>
              <input
                id="total_amount"
                name="total_amount"
                type="number"
                step="0.01"
                min="0"
                defaultValue={booking.total_customer ?? booking.total_amount ?? 0}
                className="w-full rounded-xl border border-zinc-300 px-4 py-3 text-sm outline-none transition focus:border-zinc-500"
              />
            </div>

            <div>
              <label htmlFor="customer_payment_status" className="mb-2 block text-sm font-medium text-zinc-700">
                Stato pagamento cliente
              </label>
              <select
                id="customer_payment_status"
                name="customer_payment_status"
                defaultValue={booking.customer_payment_status ?? "pending"}
                className="w-full rounded-xl border border-zinc-300 px-4 py-3 text-sm outline-none transition focus:border-zinc-500"
              >
                <option value="pending">pending</option>
                <option value="paid">paid</option>
                <option value="partial">partial</option>
              </select>
            </div>

            <div>
              <label htmlFor="supplier_payment_status" className="mb-2 block text-sm font-medium text-zinc-700">
                Stato pagamento fornitore
              </label>
              <select
                id="supplier_payment_status"
                name="supplier_payment_status"
                defaultValue={booking.supplier_payment_status ?? "pending"}
                className="w-full rounded-xl border border-zinc-300 px-4 py-3 text-sm outline-none transition focus:border-zinc-500"
              >
                <option value="pending">pending</option>
                <option value="paid">paid</option>
                <option value="partial">partial</option>
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="notes" className="mb-2 block text-sm font-medium text-zinc-700">
              Note
            </label>
            <textarea
              id="notes"
              name="notes"
              rows={4}
              defaultValue={booking.notes ?? ""}
              className="w-full rounded-xl border border-zinc-300 px-4 py-3 text-sm outline-none transition focus:border-zinc-500"
            />
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              className="rounded-xl bg-zinc-900 px-5 py-3 text-sm font-medium text-white transition hover:bg-zinc-700"
            >
              Aggiorna prenotazione
            </button>
          </div>
        </form>
      </SectionCard>
    </AppShell>
  );
}