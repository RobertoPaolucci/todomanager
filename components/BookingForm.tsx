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

export default function BookingForm({
  channels,
  experiences,
  today,
  initialData = null,
  isEditing = false,
  viewOnly = false,
  returnTo = "/prenotazioni",
}: BookingFormProps) {
  const [channelId, setChannelId] = useState(initialData?.channel_id ? String(initialData.channel_id) : "");
  const [experienceId, setExperienceId] = useState(initialData?.experience_id ? String(initialData.experience_id) : "");
  const [adults, setAdults] = useState(initialData?.adults ?? 1);
  const [children, setChildren] = useState(initialData?.children ?? 0);
  const [infants, setInfants] = useState(initialData?.infants ?? 0);
  
  const [manualYourPrice, setManualYourPrice] = useState(0);
  const [manualPublicPrice, setManualPublicPrice] = useState(0);

  // STATO PER GESTIRE L'ERRORE VISIVO
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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

  useEffect(() => {
    setManualYourPrice(0);
    setManualPublicPrice(0);
  }, [channelId, experienceId]);

  const totalCapacity = adults + children + infants;
  const pricingPax = adults + children;

  const yourUnitPrice = selectedPrice ? Number(selectedPrice.your_unit_price) : manualYourPrice;
  const publicUnitPrice = selectedPrice ? Number(selectedPrice.public_unit_price) : manualPublicPrice;
  
  const supplierUnitCost = Number(selectedExperience?.supplier_unit_cost || 0);
  const isGroupPricing = selectedExperience?.is_group_pricing === true;

  const totalToYou = isGroupPricing ? yourUnitPrice : (yourUnitPrice * pricingPax);
  const totalCustomer = isGroupPricing ? publicUnitPrice : (publicUnitPrice * pricingPax);
  const totalSupplierCost = isGroupPricing ? supplierUnitCost : (supplierUnitCost * pricingPax);
  const marginTotal = totalToYou - totalSupplierCost;

  // FUNZIONE PER INTERCETTARE L'ERRORE SENZA CRASHARE
  async function handleFormAction(formData: FormData) {
    setErrorMessage(null);
    const action = isEditing && !viewOnly ? updateBooking : createBooking;
    
    const result = await action(formData);
    
    if (result?.error) {
      setErrorMessage(result.error);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  // Stili base per gli input ottimizzati per iOS (text-[16px] blocca lo zoom automatico)
  const inputBaseStyle = "w-full rounded-xl border border-zinc-300 px-4 py-3 text-[16px] sm:text-sm outline-none focus:border-zinc-500 disabled:bg-zinc-50 bg-white transition-colors";

  return (
    <form action={handleFormAction} className="grid gap-4 sm:gap-5 md:grid-cols-2">
      {isEditing && <input type="hidden" name="id" value={initialData.id} />}
      <input type="hidden" name="returnTo" value={returnTo} />

      {/* BOX ERRORE */}
      {errorMessage && (
        <div className="md:col-span-2 rounded-xl bg-red-50 border border-red-200 p-4 shadow-sm mb-1">
          <p className="text-sm font-bold text-red-700">{errorMessage}</p>
        </div>
      )}

      {/* CANALE E RIFERIMENTO */}
      <div>
        <label className="mb-1 block text-sm font-medium text-zinc-700">Canale di prenotazione</label>
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
            <option key={channel.id} value={channel.id}>{channel.name}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-zinc-700">Numero prenotazione (Rif)</label>
        <input
          name="booking_reference"
          type="text"
          disabled={viewOnly}
          defaultValue={initialData?.booking_reference ?? ""}
          placeholder="Es. VIATOR-847392"
          className={inputBaseStyle}
        />
      </div>

      {/* DATI CLIENTE */}
      <div>
        <label className="mb-1 block text-sm font-medium text-zinc-700">Data inserimento</label>
        <input
          name="booking_created_at"
          type="date"
          required
          disabled={viewOnly}
          defaultValue={initialData?.booking_created_at ?? today}
          className={inputBaseStyle}
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-zinc-700">Nome cliente principale</label>
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

      <div>
        <label className="mb-1 block text-sm font-medium text-zinc-700">Telefono</label>
        <input
          name="customer_phone"
          type="text"
          disabled={viewOnly}
          defaultValue={initialData?.customer_phone ?? ""}
          placeholder="Es. +39 333 1234567"
          className={inputBaseStyle}
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-zinc-700">Email</label>
        <input
          name="customer_email"
          type="email"
          disabled={viewOnly}
          defaultValue={initialData?.customer_email ?? ""}
          placeholder="Es. john@email.com"
          className={inputBaseStyle}
        />
      </div>

      {/* BOX PREZZI MANCANTI */}
      {channelId && experienceId && !selectedPrice && !viewOnly && (
        <div className="md:col-span-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:p-5 shadow-sm">
          <div className="flex flex-col gap-3">
            <h4 className="text-sm font-bold text-amber-800">Prezzi non configurati (€/{isGroupPricing ? 'gruppo' : 'persona'})</h4>
            <div className="grid gap-3 grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-bold text-amber-800 uppercase">Tuo Netto</label>
                <input
                  name="new_your_unit_price"
                  type="number"
                  step="0.01"
                  required
                  value={manualYourPrice || ""}
                  onChange={(e) => setManualYourPrice(Number(e.target.value))}
                  className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2.5 text-[16px] sm:text-sm outline-none focus:border-amber-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-amber-800 uppercase">Lordo Pub</label>
                <input
                  name="new_public_unit_price"
                  type="number"
                  step="0.01"
                  required
                  value={manualPublicPrice || ""}
                  onChange={(e) => setManualPublicPrice(Number(e.target.value))}
                  className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2.5 text-[16px] sm:text-sm outline-none focus:border-amber-500"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* DATI ESPERIENZA */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="block text-sm font-medium text-zinc-700">Esperienza</label>
          {isGroupPricing && (
            <span className="text-[10px] font-bold uppercase text-purple-600 bg-purple-100 px-1.5 py-0.5 rounded">
              A Gruppo
            </span>
          )}
        </div>
        <select
          name="experience_id"
          required
          disabled={viewOnly}
          value={experienceId}
          onChange={(e) => setExperienceId(e.target.value)}
          className={inputBaseStyle}
        >
          <option value="">Seleziona esperienza</option>
          {experiences.map((experience: any) => (
            <option key={experience.id} value={experience.id}>{experience.name}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-zinc-700">Data esp.</label>
          <input
            name="booking_date"
            type="date"
            required
            disabled={viewOnly}
            defaultValue={initialData?.booking_date ?? ""}
            className={inputBaseStyle}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-zinc-700">Ora inizio</label>
          <input
            name="booking_time"
            type="time"
            disabled={viewOnly}
            defaultValue={initialData?.booking_time ?? ""}
            className={inputBaseStyle}
          />
        </div>
      </div>

      {/* CATEGORIE PERSONE (PAX) */}
      <div className="md:col-span-2 grid grid-cols-3 gap-2 sm:gap-4 bg-zinc-50 p-3 sm:p-4 rounded-2xl border border-zinc-100">
        <div>
          <label className="mb-1 block text-[10px] sm:text-xs font-bold text-zinc-500 uppercase truncate">Adulti</label>
          <input
            name="adults"
            type="number"
            min="0"
            value={adults}
            onChange={(e) => setAdults(Number(e.target.value))}
            disabled={viewOnly}
            className="w-full rounded-xl border border-zinc-300 px-2 sm:px-4 py-3 text-center text-[16px] sm:text-sm outline-none focus:border-zinc-500 bg-white"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] sm:text-xs font-bold text-zinc-500 uppercase truncate">Bambini</label>
          <input
            name="children"
            type="number"
            min="0"
            value={children}
            onChange={(e) => setChildren(Number(e.target.value))}
            disabled={viewOnly}
            className="w-full rounded-xl border border-zinc-300 px-2 sm:px-4 py-3 text-center text-[16px] sm:text-sm outline-none focus:border-zinc-500 bg-white"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] sm:text-xs font-bold text-blue-600 uppercase truncate">Infanti</label>
          <input
            name="infants"
            type="number"
            min="0"
            value={infants}
            onChange={(e) => setInfants(Number(e.target.value))}
            disabled={viewOnly}
            className="w-full rounded-xl border border-blue-200 bg-blue-50/50 px-2 sm:px-4 py-3 text-center text-[16px] sm:text-sm outline-none focus:border-blue-500 text-blue-800"
          />
        </div>
      </div>

      {/* PAGAMENTI E FORNITORI */}
      <div className="md:col-span-2 grid gap-4 sm:grid-cols-3 mt-1">
        <div>
          <label className="mb-1 block text-sm font-medium text-zinc-700">Lordo Totale Autom.</label>
          <input
            name="total_amount"
            type="number"
            step="0.01"
            value={totalCustomer}
            readOnly
            className="w-full rounded-xl border border-zinc-200 bg-zinc-100/80 px-4 py-3 text-[16px] sm:text-sm text-zinc-600 font-bold"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-zinc-700">Pagamento Agenzia</label>
          <select
            name="customer_payment_status"
            disabled={viewOnly}
            defaultValue={initialData?.customer_payment_status ?? "pending"}
            className={inputBaseStyle}
          >
            <option value="pending">Da incassare</option>
            <option value="partial">Acconto</option>
            <option value="paid">Incassato</option>
          </select>
        </div>
        
        {/* INVIO CAMPI NASCOSTI AL DB */}
        <input type="hidden" name="total_customer" value={totalCustomer} />
        <input type="hidden" name="total_supplier_cost" value={totalSupplierCost} />
        <input type="hidden" name="total_to_you" value={totalToYou} />
        <input type="hidden" name="margin_total" value={marginTotal} />

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-500">Stato Forn.</label>
            <select
              name="supplier_payment_status"
              disabled={viewOnly}
              defaultValue={initialData?.supplier_payment_status ?? "pending"}
              className="w-full rounded-xl border border-zinc-300 px-3 py-3 text-[16px] sm:text-sm bg-white outline-none focus:border-zinc-500 disabled:bg-zinc-50"
            >
              <option value="pending">In attesa</option>
              <option value="partial">Parziale</option>
              <option value="paid">Saldato</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-500">Pagato (€)</label>
            <input
              name="supplier_amount_paid"
              type="number"
              step="0.01"
              disabled={viewOnly}
              defaultValue={initialData?.supplier_amount_paid ?? 0}
              className="w-full rounded-xl border border-zinc-300 px-3 py-3 text-[16px] sm:text-sm outline-none focus:border-zinc-500 disabled:bg-zinc-50 bg-white"
            />
          </div>
        </div>
      </div>

      {/* RIEPILOGO ECONOMICO */}
      <div className="md:col-span-2 rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5 mt-2 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold text-zinc-900">Riepilogo</h3>
          <span className="rounded-lg bg-zinc-100 px-2 py-1 text-[10px] sm:text-xs font-black text-zinc-600 uppercase tracking-tighter">
            Posti totali: {totalCapacity}
          </span>
        </div>
        {/* Disposizione a griglia 2x2 su mobile, orizzontale su Desktop */}
        <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
          <div className="rounded-xl border border-zinc-100 bg-zinc-50/80 p-3 relative overflow-hidden flex flex-col justify-center">
            {isGroupPricing && (
              <div className="absolute top-0 right-0 bg-purple-100 px-1 py-0.5 text-[8px] font-bold text-purple-700 uppercase rounded-bl-lg">
                Fisso
              </div>
            )}
            <p className="text-[9px] sm:text-[10px] uppercase font-bold text-zinc-400">Incasso Lordo</p>
            <p className="mt-0.5 text-base sm:text-lg font-black text-zinc-900">€ {totalCustomer.toFixed(2)}</p>
          </div>
          <div className="rounded-xl border border-zinc-100 bg-zinc-50/80 p-3 relative overflow-hidden flex flex-col justify-center">
            {isGroupPricing && (
              <div className="absolute top-0 right-0 bg-purple-100 px-1 py-0.5 text-[8px] font-bold text-purple-700 uppercase rounded-bl-lg">
                Fisso
              </div>
            )}
            <p className="text-[9px] sm:text-[10px] uppercase font-bold text-zinc-400">Netto a te</p>
            <p className="mt-0.5 text-base sm:text-lg font-black text-zinc-900">€ {totalToYou.toFixed(2)}</p>
          </div>
          <div className="rounded-xl border border-zinc-100 bg-zinc-50/80 p-3 relative overflow-hidden flex flex-col justify-center">
            {isGroupPricing && (
              <div className="absolute top-0 right-0 bg-purple-100 px-1 py-0.5 text-[8px] font-bold text-purple-700 uppercase rounded-bl-lg">
                Fisso
              </div>
            )}
            <p className="text-[9px] sm:text-[10px] uppercase font-bold text-zinc-400">Costo Fornitore</p>
            <p className="mt-0.5 text-base sm:text-lg font-black text-red-600">€ {totalSupplierCost.toFixed(2)}</p>
          </div>
          <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3 shadow-sm flex flex-col justify-center">
            <p className="text-[9px] sm:text-[10px] uppercase font-bold text-emerald-600">Margine Pulito</p>
            <p className="mt-0.5 text-base sm:text-lg font-black text-emerald-700">€ {marginTotal.toFixed(2)}</p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-[10px] sm:text-[11px] text-zinc-400 font-medium border-t border-zinc-100 pt-3 italic">
          <div>Paganti: {pricingPax}</div>
          <div>Unit. Te: €{yourUnitPrice.toFixed(2)}</div>
          <div>Unit. Lordo: €{publicUnitPrice.toFixed(2)}</div>
          <div>Unit. Forn: €{supplierUnitCost.toFixed(2)}</div>
        </div>
      </div>

      <div className="md:col-span-2">
        <label className="mb-1 block text-sm font-medium text-zinc-700">Note interne</label>
        <textarea
          name="notes"
          rows={3}
          disabled={viewOnly}
          defaultValue={initialData?.notes ?? ""}
          placeholder="Allergie, infanti, richieste speciali..."
          className="w-full rounded-xl border border-zinc-300 px-4 py-3 text-[16px] sm:text-sm outline-none focus:border-zinc-500 disabled:bg-zinc-50 bg-white"
        />
      </div>

      <input type="hidden" name="experience_name" value={selectedExperience?.name || ""} />

      {/* BOTTONIERA (Flex Column su Mobile per pulsanti larghi al 100%) */}
      <div className="md:col-span-2 flex flex-col sm:flex-row gap-3 pt-5 pb-8 sm:pb-4 border-t border-zinc-200 mt-2">
        {!viewOnly && (
          <>
            <button
              type="submit"
              name="intent"
              value="save"
              className="w-full sm:w-auto rounded-xl bg-zinc-900 px-8 py-3.5 sm:py-3 text-[16px] sm:text-sm font-bold text-white transition hover:bg-zinc-700 shadow-md order-1 sm:order-none"
            >
              {isEditing ? "Aggiorna" : "Salva prenotazione"}
            </button>
            {!isEditing && (
              <button
                type="submit"
                name="intent"
                value="save_and_new"
                className="w-full sm:w-auto rounded-xl bg-white border border-zinc-900 px-8 py-3.5 sm:py-3 text-[16px] sm:text-sm font-bold text-zinc-900 transition hover:bg-zinc-50 shadow-sm order-2 sm:order-none"
              >
                Salva e Nuova
              </button>
            )}
          </>
        )}
        <Link
          href={returnTo}
          className="w-full sm:w-auto rounded-xl border border-zinc-300 px-8 py-3.5 sm:py-3 text-[16px] sm:text-sm font-bold text-zinc-700 transition hover:bg-zinc-100 flex items-center justify-center bg-white order-3 sm:order-none"
        >
          Annulla
        </Link>
      </div>
    </form>
  );
}