"use client";

import { useMemo, useState, useEffect } from "react";
import Link from "next/link";
import { createBooking, updateBooking } from "@/app/prenotazioni/actions";

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
  is_group_pricing: boolean;
  experience_channel_prices: ExperiencePrice[];
};

type BookingFormProps = {
  channels: Channel[];
  experiences: Experience[];
  today: string;
  initialData?: any;
  isEditing?: boolean;
  viewOnly?: boolean;
  returnTo?: string;
};

const PAYMENT_METHOD_OPTIONS = [
  "Bonifico Bancario",
  "Carta di Credito",
  "Contanti",
  "POS",
  "PayPal",
  "Stripe",
  "Satispay",
  "Assegno",
  "Compensazione",
  "Altro",
];

export default function BookingForm({
  channels,
  experiences,
  today,
  initialData = null,
  isEditing = false,
  viewOnly = false,
  returnTo = "/prenotazioni",
}: BookingFormProps) {
  const [channelId, setChannelId] = useState(
    initialData?.channel_id ? String(initialData.channel_id) : ""
  );
  const [experienceId, setExperienceId] = useState(
    initialData?.experience_id ? String(initialData.experience_id) : ""
  );
  const [adults, setAdults] = useState(initialData?.adults ?? 1);
  const [children, setChildren] = useState(initialData?.children ?? 0);
  const [infants, setInfants] = useState(initialData?.infants ?? 0);

  const [manualYourPrice, setManualYourPrice] = useState(0);
  const [manualPublicPrice, setManualPublicPrice] = useState(0);

  const [supplierPaymentStatus, setSupplierPaymentStatus] = useState(
    initialData?.supplier_payment_status ?? "pending"
  );
  const [supplierAmountPaid, setSupplierAmountPaid] = useState(
    String(initialData?.supplier_amount_paid ?? 0)
  );
  const [supplierPaymentMethod, setSupplierPaymentMethod] = useState(
    initialData?.supplier_payment_method ?? "Bonifico Bancario"
  );

  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const selectedExperience = useMemo(
    () =>
      experiences.find((experience) => String(experience.id) === experienceId),
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

  useEffect(() => {
    setManualYourPrice(0);
    setManualPublicPrice(0);
  }, [channelId, experienceId]);

  const totalCapacity = adults + children + infants;
  const pricingPax = adults + children;

  const yourUnitPrice = selectedPrice
    ? Number(selectedPrice.your_unit_price)
    : manualYourPrice;

  const publicUnitPrice = selectedPrice
    ? Number(selectedPrice.public_unit_price)
    : manualPublicPrice;

  const supplierUnitCost = Number(selectedExperience?.supplier_unit_cost || 0);
  const isGroupPricing = selectedExperience?.is_group_pricing === true;

  const totalToYou = isGroupPricing
    ? yourUnitPrice
    : yourUnitPrice * pricingPax;

  const totalCustomer = isGroupPricing
    ? publicUnitPrice
    : publicUnitPrice * pricingPax;

  const totalSupplierCost = isGroupPricing
    ? supplierUnitCost
    : supplierUnitCost * pricingPax;

  const marginTotal = totalToYou - totalSupplierCost;

  const supplierAmountPaidNumber = Number(
    String(supplierAmountPaid || "0").replace(",", ".")
  );

  const showSupplierPaymentMethod =
    supplierPaymentStatus !== "pending" || supplierAmountPaidNumber > 0;

  async function handleFormAction(formData: FormData) {
    setErrorMessage(null);
    const action = isEditing && !viewOnly ? updateBooking : createBooking;

    const result = await action(formData);

    if (result?.error) {
      setErrorMessage(result.error);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  const inputBaseStyle =
    "w-full min-w-0 rounded-xl border border-zinc-300 bg-white px-4 py-3 text-[16px] sm:text-sm outline-none transition-colors focus:border-zinc-500 disabled:bg-zinc-50";

  const compactInputStyle =
    "w-full min-w-0 rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-[16px] sm:text-sm outline-none transition-colors focus:border-zinc-500 disabled:bg-zinc-50";

  const dateTimeInputStyle =
    "w-full min-w-0 rounded-xl border border-zinc-300 bg-white px-3 py-2 text-[15px] sm:text-sm outline-none transition-colors focus:border-zinc-500 disabled:bg-zinc-50";

  const paxInputStyle =
    "w-full rounded-xl border border-zinc-300 bg-white px-2 py-2 text-center text-[18px] sm:px-4 sm:text-sm outline-none focus:border-zinc-500";

  const infantPaxInputStyle =
    "w-full rounded-xl border border-blue-200 bg-white px-2 py-2 text-center text-[18px] text-blue-800 sm:px-4 sm:text-sm outline-none focus:border-blue-500";

  const readonlyCompactStyle =
    "w-full rounded-xl border border-zinc-200 bg-zinc-100/80 px-4 py-2.5 text-[16px] font-bold text-zinc-600 sm:text-sm";

  const sectionClass =
    "rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5 md:col-span-2";

  return (
    <form action={handleFormAction} className="grid gap-4 md:grid-cols-2">
      {isEditing && <input type="hidden" name="id" value={initialData.id} />}
      <input type="hidden" name="returnTo" value={returnTo} />

      {errorMessage && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 shadow-sm md:col-span-2">
          <p className="text-sm font-bold text-red-700">{errorMessage}</p>
        </div>
      )}

      <div className={sectionClass}>
        <div className="mb-4">
          <h3 className="text-base font-bold text-zinc-900 sm:text-lg">
            Cliente e canale
          </h3>
          <p className="mt-1 text-xs text-zinc-500 sm:text-sm">
            Dati principali della prenotazione
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="min-w-0">
            <label className="mb-1 block text-sm font-medium text-zinc-700">
              Canale di prenotazione
            </label>
            <select
              name="channel_id"
              required
              disabled={viewOnly}
              value={channelId}
              onChange={(e) => setChannelId(e.target.value)}
              className={inputBaseStyle}
            >
              <option value="">Seleziona canale</option>
              {channels.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {channel.name}
                </option>
              ))}
            </select>
          </div>

          <div className="min-w-0">
            <label className="mb-1 block text-sm font-medium text-zinc-700">
              Numero prenotazione (Rif)
            </label>
            <input
              name="booking_reference"
              type="text"
              disabled={viewOnly}
              defaultValue={initialData?.booking_reference ?? ""}
              placeholder="Es. VIATOR-847392"
              className={inputBaseStyle}
            />
          </div>

          <div className="min-w-0">
            <label className="mb-1 block text-sm font-medium text-zinc-700">
              Data inserimento
            </label>
            <input
              name="booking_created_at"
              type="date"
              required
              disabled={viewOnly}
              defaultValue={initialData?.booking_created_at ?? today}
              className={dateTimeInputStyle}
            />
          </div>

          <div className="min-w-0">
            <label className="mb-1 block text-sm font-medium text-zinc-700">
              Nome cliente principale
            </label>
            <input
              name="customer_name"
              type="text"
              required
              disabled={viewOnly}
              defaultValue={initialData?.customer_name ?? ""}
              placeholder="Es. John Smith"
              className={inputBaseStyle}
            />
          </div>

          <div className="min-w-0">
            <label className="mb-1 block text-sm font-medium text-zinc-700">
              Telefono
            </label>
            <input
              name="customer_phone"
              type="text"
              disabled={viewOnly}
              defaultValue={initialData?.customer_phone ?? ""}
              placeholder="Es. +39 333 1234567"
              className={inputBaseStyle}
            />
          </div>

          <div className="min-w-0">
            <label className="mb-1 block text-sm font-medium text-zinc-700">
              Email
            </label>
            <input
              name="customer_email"
              type="email"
              disabled={viewOnly}
              defaultValue={initialData?.customer_email ?? ""}
              placeholder="Es. john@email.com"
              className={inputBaseStyle}
            />
          </div>
        </div>
      </div>

      {channelId && experienceId && !selectedPrice && !viewOnly && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm md:col-span-2">
          <div className="flex flex-col gap-3">
            <div>
              <h4 className="text-sm font-bold text-amber-800">
                Prezzi non configurati (€/{isGroupPricing ? "gruppo" : "persona"})
              </h4>
              <p className="mt-1 text-xs text-amber-700">
                Inseriscili ora: verranno usati per calcolare automaticamente la
                prenotazione.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="min-w-0">
                <label className="mb-1 block text-xs font-bold uppercase text-amber-800">
                  Tuo Netto
                </label>
                <input
                  name="new_your_unit_price"
                  type="number"
                  step="0.01"
                  required
                  value={manualYourPrice || ""}
                  onChange={(e) => setManualYourPrice(Number(e.target.value))}
                  className="w-full min-w-0 rounded-lg border border-amber-300 bg-white px-3 py-2.5 text-[16px] sm:text-sm outline-none focus:border-amber-500"
                />
              </div>

              <div className="min-w-0">
                <label className="mb-1 block text-xs font-bold uppercase text-amber-800">
                  Lordo Pub
                </label>
                <input
                  name="new_public_unit_price"
                  type="number"
                  step="0.01"
                  required
                  value={manualPublicPrice || ""}
                  onChange={(e) => setManualPublicPrice(Number(e.target.value))}
                  className="w-full min-w-0 rounded-lg border border-amber-300 bg-white px-3 py-2.5 text-[16px] sm:text-sm outline-none focus:border-amber-500"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      <div className={sectionClass}>
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-zinc-900 sm:text-lg">
              Esperienza e data
            </h3>
            <p className="mt-1 text-xs text-zinc-500 sm:text-sm">
              Selezione attività, giorno e ora
            </p>
          </div>

          {isGroupPricing && (
            <span className="rounded-lg bg-purple-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-purple-700">
              Prezzo a gruppo
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-2">
          <div className="col-span-2 min-w-0">
            <label className="mb-1 block text-sm font-medium text-zinc-700">
              Esperienza
            </label>
            <select
              name="experience_id"
              required
              disabled={viewOnly}
              value={experienceId}
              onChange={(e) => setExperienceId(e.target.value)}
              className={inputBaseStyle}
            >
              <option value="">Seleziona esperienza</option>
              {experiences.map((experience) => (
                <option key={experience.id} value={experience.id}>
                  {experience.name}
                </option>
              ))}
            </select>
          </div>

          <div className="min-w-0">
            <label className="mb-1 block text-sm font-medium text-zinc-700">
              Data
            </label>
            <input
              name="booking_date"
              type="date"
              required
              disabled={viewOnly}
              defaultValue={initialData?.booking_date ?? ""}
              className={dateTimeInputStyle}
            />
          </div>

          <div className="min-w-0">
            <label className="mb-1 block text-sm font-medium text-zinc-700">
              Ora
            </label>
            <input
              name="booking_time"
              type="time"
              disabled={viewOnly}
              defaultValue={initialData?.booking_time ?? ""}
              className={dateTimeInputStyle}
            />
          </div>
        </div>
      </div>

      <div className={sectionClass}>
        <div className="mb-4">
          <h3 className="text-base font-bold text-zinc-900 sm:text-lg">
            Partecipanti
          </h3>
          <p className="mt-1 text-xs text-zinc-500 sm:text-sm">
            I paganti sono adulti + bambini. Gli infanti non incidono sul prezzo.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <div className="min-w-0 rounded-2xl border border-zinc-100 bg-zinc-50 p-2.5">
            <label className="mb-1 block text-center text-[11px] font-bold uppercase text-zinc-500">
              Adulti
            </label>
            <input
              name="adults"
              type="number"
              min="0"
              value={adults}
              onChange={(e) => setAdults(Number(e.target.value))}
              disabled={viewOnly}
              className={paxInputStyle}
            />
          </div>

          <div className="min-w-0 rounded-2xl border border-zinc-100 bg-zinc-50 p-2.5">
            <label className="mb-1 block text-center text-[11px] font-bold uppercase text-zinc-500">
              Bambini
            </label>
            <input
              name="children"
              type="number"
              min="0"
              value={children}
              onChange={(e) => setChildren(Number(e.target.value))}
              disabled={viewOnly}
              className={paxInputStyle}
            />
          </div>

          <div className="min-w-0 rounded-2xl border border-blue-100 bg-blue-50/50 p-2.5">
            <label className="mb-1 block text-center text-[11px] font-bold uppercase text-blue-600">
              Infanti
            </label>
            <input
              name="infants"
              type="number"
              min="0"
              value={infants}
              onChange={(e) => setInfants(Number(e.target.value))}
              disabled={viewOnly}
              className={infantPaxInputStyle}
            />
          </div>
        </div>

        <div className="mt-4 rounded-2xl bg-zinc-900 px-4 py-3 text-white">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-zinc-300">
              Posti totali
            </span>
            <span className="text-xl font-black">{totalCapacity}</span>
          </div>
          <div className="mt-1 flex items-center justify-between gap-3 text-sm">
            <span className="text-zinc-300">Paganti</span>
            <span className="font-bold">{pricingPax}</span>
          </div>
        </div>
      </div>

      <div className={sectionClass}>
        <div className="mb-4">
          <h3 className="text-base font-bold text-zinc-900 sm:text-lg">
            Pagamenti e calcoli
          </h3>
          <p className="mt-1 text-xs text-zinc-500 sm:text-sm">
            Totali automatici e stato incasso/saldo
          </p>
        </div>

        <div className="grid gap-3 lg:grid-cols-3">
          <div className="min-w-0">
            <label className="mb-1 block text-sm font-medium text-zinc-700">
              Lordo Totale Autom.
            </label>
            <input
              name="total_amount"
              type="number"
              step="0.01"
              value={totalCustomer}
              readOnly
              className={readonlyCompactStyle}
            />
          </div>

          <div className="min-w-0">
            <label className="mb-1 block text-sm font-medium text-zinc-700">
              Pagamento Agenzia
            </label>
            <select
              name="customer_payment_status"
              disabled={viewOnly}
              defaultValue={initialData?.customer_payment_status ?? "pending"}
              className={compactInputStyle}
            >
              <option value="pending">Da incassare</option>
              <option value="partial">Acconto</option>
              <option value="paid">Incassato</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="min-w-0">
              <label className="mb-1 block text-xs font-medium text-zinc-500">
                Stato Forn.
              </label>
              <select
                name="supplier_payment_status"
                disabled={viewOnly}
                value={supplierPaymentStatus}
                onChange={(e) => setSupplierPaymentStatus(e.target.value)}
                className={compactInputStyle}
              >
                <option value="pending">In attesa</option>
                <option value="partial">Parziale</option>
                <option value="paid">Saldato</option>
              </select>
            </div>

            <div className="min-w-0">
              <label className="mb-1 block text-xs font-medium text-zinc-500">
                Pagato (€)
              </label>
              <input
                name="supplier_amount_paid"
                type="number"
                step="0.01"
                disabled={viewOnly}
                value={supplierAmountPaid}
                onChange={(e) => setSupplierAmountPaid(e.target.value)}
                className={compactInputStyle}
              />
            </div>
          </div>
        </div>

        {showSupplierPaymentMethod && (
          <div className="mt-4 rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
            <div className="grid gap-3 md:max-w-sm">
              <div className="min-w-0">
                <label className="mb-1 block text-sm font-medium text-zinc-700">
                  Metodo di pagamento fornitore
                </label>
                <select
                  name="supplier_payment_method"
                  disabled={viewOnly}
                  value={supplierPaymentMethod}
                  onChange={(e) => setSupplierPaymentMethod(e.target.value)}
                  className={compactInputStyle}
                >
                  {PAYMENT_METHOD_OPTIONS.map((method) => (
                    <option key={method} value={method}>
                      {method}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-zinc-500">
                  Usato per registrare il movimento nello storico pagamenti.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm md:col-span-2 sm:p-5">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-base font-bold text-zinc-900 sm:text-lg">
              Riepilogo economico
            </h3>
            <p className="mt-1 text-xs text-zinc-500 sm:text-sm">
              Controllo finale prima del salvataggio
            </p>
          </div>

          <span className="w-fit rounded-lg bg-zinc-100 px-2 py-1 text-[10px] font-black uppercase tracking-tight text-zinc-600 sm:text-xs">
            Posti totali: {totalCapacity}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="relative flex flex-col justify-center overflow-hidden rounded-xl border border-zinc-100 bg-zinc-50/80 p-3">
            {isGroupPricing && (
              <div className="absolute right-0 top-0 rounded-bl-lg bg-purple-100 px-1 py-0.5 text-[8px] font-bold uppercase text-purple-700">
                Fisso
              </div>
            )}
            <p className="text-[10px] font-bold uppercase text-zinc-400">
              Incasso Lordo
            </p>
            <p className="mt-0.5 text-lg font-black text-zinc-900">
              € {totalCustomer.toFixed(2)}
            </p>
          </div>

          <div className="relative flex flex-col justify-center overflow-hidden rounded-xl border border-zinc-100 bg-zinc-50/80 p-3">
            {isGroupPricing && (
              <div className="absolute right-0 top-0 rounded-bl-lg bg-purple-100 px-1 py-0.5 text-[8px] font-bold uppercase text-purple-700">
                Fisso
              </div>
            )}
            <p className="text-[10px] font-bold uppercase text-zinc-400">
              Netto a te
            </p>
            <p className="mt-0.5 text-lg font-black text-zinc-900">
              € {totalToYou.toFixed(2)}
            </p>
          </div>

          <div className="relative flex flex-col justify-center overflow-hidden rounded-xl border border-zinc-100 bg-zinc-50/80 p-3">
            {isGroupPricing && (
              <div className="absolute right-0 top-0 rounded-bl-lg bg-purple-100 px-1 py-0.5 text-[8px] font-bold uppercase text-purple-700">
                Fisso
              </div>
            )}
            <p className="text-[10px] font-bold uppercase text-zinc-400">
              Costo Fornitore
            </p>
            <p className="mt-0.5 text-lg font-black text-red-600">
              € {totalSupplierCost.toFixed(2)}
            </p>
          </div>

          <div className="flex flex-col justify-center rounded-xl border border-emerald-100 bg-emerald-50 p-3 shadow-sm">
            <p className="text-[10px] font-bold uppercase text-emerald-600">
              Margine Pulito
            </p>
            <p className="mt-0.5 text-lg font-black text-emerald-700">
              € {marginTotal.toFixed(2)}
            </p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-2 border-t border-zinc-100 pt-3 text-[11px] font-medium italic text-zinc-500 sm:grid-cols-2 xl:grid-cols-4">
          <div>Paganti: {pricingPax}</div>
          <div>Unit. Te: €{yourUnitPrice.toFixed(2)}</div>
          <div>Unit. Lordo: €{publicUnitPrice.toFixed(2)}</div>
          <div>Unit. Forn: €{supplierUnitCost.toFixed(2)}</div>
        </div>
      </div>

      <div className={sectionClass}>
        <label className="mb-1 block text-sm font-medium text-zinc-700">
          Note interne
        </label>
        <textarea
          name="notes"
          rows={4}
          disabled={viewOnly}
          defaultValue={initialData?.notes ?? ""}
          placeholder="Allergie, infanti, richieste speciali..."
          className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-[16px] sm:text-sm outline-none focus:border-zinc-500 disabled:bg-zinc-50"
        />
      </div>

      <input type="hidden" name="total_customer" value={totalCustomer} />
      <input type="hidden" name="total_supplier_cost" value={totalSupplierCost} />
      <input type="hidden" name="total_to_you" value={totalToYou} />
      <input type="hidden" name="margin_total" value={marginTotal} />
      <input
        type="hidden"
        name="experience_name"
        value={selectedExperience?.name || ""}
      />

      <div className="sticky bottom-0 z-20 -mx-3 border-t border-zinc-200 bg-white/95 px-3 pb-[calc(12px+env(safe-area-inset-bottom))] pt-3 backdrop-blur md:static md:mx-0 md:border-0 md:bg-transparent md:px-0 md:pb-0 md:pt-1 md:backdrop-blur-0">
        <div className="flex flex-col gap-3 md:col-span-2 sm:flex-row sm:flex-wrap">
          {!viewOnly && (
            <>
              <button
                type="submit"
                name="intent"
                value="save"
                className="w-full rounded-xl bg-zinc-900 px-5 py-3 text-[16px] font-bold text-white shadow-md transition hover:bg-zinc-700 sm:w-auto sm:px-8 sm:text-sm"
              >
                {isEditing ? "Aggiorna" : "Salva prenotazione"}
              </button>

              {!isEditing && (
                <button
                  type="submit"
                  name="intent"
                  value="save_and_new"
                  className="w-full rounded-xl border border-zinc-900 bg-white px-5 py-3 text-[16px] font-bold text-zinc-900 shadow-sm transition hover:bg-zinc-50 sm:w-auto sm:px-8 sm:text-sm"
                >
                  Salva e Nuova
                </button>
              )}
            </>
          )}

          <Link
            href={returnTo}
            className="flex w-full items-center justify-center rounded-xl border border-zinc-300 bg-white px-5 py-3 text-[16px] font-bold text-zinc-700 transition hover:bg-zinc-100 sm:w-auto sm:px-8 sm:text-sm"
          >
            Annulla
          </Link>
        </div>
      </div>
    </form>
  );
}