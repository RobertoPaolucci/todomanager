"use client";

import { useMemo, useState } from "react";
import { createBooking } from "@/app/prenotazioni/actions";

type Channel = {
  id: number;
  name: string;
  type: string;
};

type ExperiencePrice = {
  id: number;
  channel_id: number;
  your_unit_price: number;
  public_unit_price: number;
  currency: string;
};

type Experience = {
  id: number;
  name: string;
  supplier_id: number | null;
  supplier_unit_cost: number;
  base_price: number;
  experience_channel_prices: ExperiencePrice[];
};

type BookingFormProps = {
  channels: Channel[];
  experiences: Experience[];
  today: string;
};

export default function BookingForm({
  channels,
  experiences,
  today,
}: BookingFormProps) {
  const [channelId, setChannelId] = useState("");
  const [experienceId, setExperienceId] = useState("");
  const [adults, setAdults] = useState(1);
  const [children, setChildren] = useState(0);

  const selectedExperience = useMemo(
    () => experiences.find((experience) => String(experience.id) === experienceId),
    [experiences, experienceId]
  );

  const selectedPrice = useMemo(() => {
    if (!selectedExperience || !channelId) return null;

    return (
      selectedExperience.experience_channel_prices.find(
        (price) => String(price.channel_id) === channelId
      ) || null
    );
  }, [selectedExperience, channelId]);

  const totalPeople = adults + children;
  const yourUnitPrice = Number(selectedPrice?.your_unit_price || 0);
  const publicUnitPrice = Number(selectedPrice?.public_unit_price || 0);
  const supplierUnitCost = Number(selectedExperience?.supplier_unit_cost || 0);

  const totalToYou = yourUnitPrice * totalPeople;
  const totalCustomer = publicUnitPrice * totalPeople;
  const totalSupplierCost = supplierUnitCost * totalPeople;
  const marginTotal = totalToYou - totalSupplierCost;

  return (
    <form action={createBooking} className="grid gap-4 md:grid-cols-2">
      <div>
        <label className="mb-1 block text-sm font-medium text-zinc-700">
          Canale di prenotazione
        </label>
        <select
          name="channel_id"
          required
          value={channelId}
          onChange={(e) => setChannelId(e.target.value)}
          className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none focus:border-zinc-500"
        >
          <option value="">Seleziona canale</option>
          {channels.map((channel) => (
            <option key={channel.id} value={channel.id}>
              {channel.name}
            </option>
          ))}
        </select>
      </div>



      <div>
        <label className="mb-1 block text-sm font-medium text-zinc-700">
          Numero prenotazione
        </label>
        <input
          name="booking_reference"
          type="text"
          className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none focus:border-zinc-500"
          placeholder="Es. VIATOR-847392"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-zinc-700">
          Data prenotazione
        </label>
        <input
          name="booking_created_at"
          type="date"
          defaultValue={today}
          required
          className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none focus:border-zinc-500"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-zinc-700">
          Nome cliente
        </label>
        <input
          name="customer_name"
          type="text"
          required
          className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none focus:border-zinc-500"
          placeholder="Es. John Smith"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-zinc-700">
          Telefono cliente
        </label>
        <input
          name="customer_phone"
          type="text"
          className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none focus:border-zinc-500"
          placeholder="Es. +39 333 1234567"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-zinc-700">
          Email cliente
        </label>
        <input
          name="customer_email"
          type="email"
          className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none focus:border-zinc-500"
          placeholder="Es. john@email.com"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-zinc-700">
          Esperienza
        </label>
        <select
          name="experience_id"
          required
          value={experienceId}
          onChange={(e) => setExperienceId(e.target.value)}
          className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none focus:border-zinc-500"
        >
          <option value="">Seleziona esperienza</option>
          {experiences.map((experience) => (
            <option key={experience.id} value={experience.id}>
              {experience.name}
            </option>
          ))}
        </select>
      </div>

      <input
        type="hidden"
        name="experience_name"
        value={selectedExperience?.name || ""}
      />

      <div>
        <label className="mb-1 block text-sm font-medium text-zinc-700">
          Data esperienza
        </label>
        <input
          name="booking_date"
          type="date"
          required
          className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none focus:border-zinc-500"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-zinc-700">
          Ora esperienza
        </label>
        <input
          name="booking_time"
          type="time"
          className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none focus:border-zinc-500"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-zinc-700">
          Adulti
        </label>
        <input
          name="adults"
          type="number"
          min="0"
          value={adults}
          onChange={(e) => setAdults(Number(e.target.value))}
          required
          className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none focus:border-zinc-500"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-zinc-700">
          Bambini
        </label>
        <input
          name="children"
          type="number"
          min="0"
          value={children}
          onChange={(e) => setChildren(Number(e.target.value))}
          required
          className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none focus:border-zinc-500"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-zinc-700">
          Totale cliente finale
        </label>
        <input
          name="total_amount"
          type="number"
          min="0"
          step="0.01"
          value={totalCustomer}
          readOnly
          className="w-full rounded-xl border border-zinc-300 bg-zinc-50 px-4 py-3 text-zinc-700 outline-none"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-zinc-700">
          Pagamento cliente
        </label>
        <select
          name="customer_payment_status"
          defaultValue="pending"
          className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none focus:border-zinc-500"
        >
          <option value="pending">pending</option>
          <option value="partial">partial</option>
          <option value="paid">paid</option>
        </select>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-zinc-700">
          Pagamento fornitore
        </label>
        <select
          name="supplier_payment_status"
          defaultValue="pending"
          className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none focus:border-zinc-500"
        >
          <option value="pending">pending</option>
          <option value="paid">paid</option>
        </select>
      </div>

      <div className="md:col-span-2 rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
        <h3 className="mb-3 text-lg font-semibold text-zinc-900">
          Riepilogo economico
        </h3>

        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-xl border border-zinc-200 bg-white p-3">
            <p className="text-sm text-zinc-500">Cliente paga</p>
            <p className="mt-1 text-xl font-bold text-zinc-900">
              € {totalCustomer.toFixed(2)}
            </p>
          </div>

          <div className="rounded-xl border border-zinc-200 bg-white p-3">
            <p className="text-sm text-zinc-500">A te</p>
            <p className="mt-1 text-xl font-bold text-zinc-900">
              € {totalToYou.toFixed(2)}
            </p>
          </div>

          <div className="rounded-xl border border-zinc-200 bg-white p-3">
            <p className="text-sm text-zinc-500">Fornitore</p>
            <p className="mt-1 text-xl font-bold text-zinc-900">
              € {totalSupplierCost.toFixed(2)}
            </p>
          </div>

          <div className="rounded-xl border border-zinc-200 bg-white p-3">
            <p className="text-sm text-zinc-500">Margine</p>
            <p className="mt-1 text-xl font-bold text-zinc-900">
              € {marginTotal.toFixed(2)}
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-4 text-sm text-zinc-600">
          <div>
            <span className="font-medium">Persone:</span> {totalPeople}
          </div>
          <div>
            <span className="font-medium">Prezzo tuo/unità:</span> €{" "}
            {yourUnitPrice.toFixed(2)}
          </div>
          <div>
            <span className="font-medium">Prezzo cliente/unità:</span> €{" "}
            {publicUnitPrice.toFixed(2)}
          </div>
          <div>
            <span className="font-medium">Costo fornitore/unità:</span> €{" "}
            {supplierUnitCost.toFixed(2)}
          </div>
        </div>

        {channelId && experienceId && !selectedPrice ? (
          <p className="mt-4 text-sm font-medium text-red-600">
            Nessun prezzo configurato per questa combinazione canale + esperienza.
          </p>
        ) : null}
      </div>

      <div className="md:col-span-2">
        <label className="mb-1 block text-sm font-medium text-zinc-700">
          Note
        </label>
        <textarea
          name="notes"
          rows={4}
          className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none focus:border-zinc-500"
          placeholder="Es. allergie, richieste particolari, info operative..."
        />
      </div>

      <div className="md:col-span-2 flex gap-3 pt-2">
        <button
          type="submit"
          className="rounded-xl bg-zinc-900 px-5 py-3 text-white transition hover:bg-zinc-700"
        >
          Salva prenotazione
        </button>

        <a
          href="/prenotazioni"
          className="rounded-xl border border-zinc-300 px-5 py-3 text-zinc-700 transition hover:bg-zinc-100"
        >
          Annulla
        </a>
      </div>
    </form>
  );
}