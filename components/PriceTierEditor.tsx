"use client";

import { useState } from "react";
import type { ParticipantPriceTier } from "@/lib/booking-pricing";

export default function PriceTierEditor({ channelId, channelName, mode, tiers, isGroupPricing }: {
  channelId: number; channelName: string; mode: string; tiers: ParticipantPriceTier[]; isGroupPricing: boolean;
}) {
  const [pricingMode, setPricingMode] = useState(mode);
  const [rows, setRows] = useState(tiers);
  function change(index: number, field: keyof ParticipantPriceTier, value: string) {
    setRows(previous => previous.map((row, i) => i === index ? { ...row, [field]: value === "" ? null : Number(value) } : row));
  }
  return <fieldset className="space-y-3 rounded-xl border border-zinc-200 p-4">
    <legend className="px-2 font-semibold">{channelName}</legend>
    <label className="flex flex-wrap items-center gap-3 text-sm">
      Modalità prezzo
      <select name={`pricing_mode_${channelId}`} value={pricingMode} onChange={e => setPricingMode(e.target.value)} className="rounded-lg border p-2">
        <option value="fixed">Prezzo fisso</option>
        <option value="tiered" disabled={isGroupPricing}>Prezzo a fasce</option>
      </select>
    </label>
    <input type="hidden" name={`price_tiers_${channelId}`} value={JSON.stringify(rows)} />
    {pricingMode === "tiered" && <>
      <p className="text-sm text-zinc-600">Fascia per numero di paganti: adulti e bambini con tariffa non gratuita. Infanti e guide esclusi. I prezzi bambini restano quelli della tabella sopra; vuoto = tariffa adulto della fascia. Nessuna tariffa fuori dalle fasce configurate.</p>
      {rows.map((row, index) => <div key={index} className="grid gap-3 rounded-lg bg-zinc-50 p-3 sm:grid-cols-3 xl:grid-cols-6">
        {([
          ["min_participants", "Min. paganti"], ["max_participants", "Max. paganti"],
          ["your_unit_price", "Prezzo a noi (€)"], ["public_unit_price", "Pubblico (€)"],
          ["supplier_adult_unit_cost", "Fornitore (€)"],
        ] as const).map(([key, label]) => <label key={key} className="text-sm">{label}
          <input aria-label={`${channelName}, fascia ${index + 1}, ${label}`} type="number" required min={key.includes("participants") ? 1 : 0}
            max={key.includes("participants") ? 100000 : 9999999999.99} step={key.includes("participants") ? 1 : 0.01}
            value={row[key] ?? ""} onChange={e => change(index, key, e.target.value)} className="mt-1 w-full rounded-lg border p-2" />
        </label>)}
        <button type="button" onClick={() => setRows(previous => previous.filter((_, i) => i !== index))} className="self-end rounded-lg border p-2 text-sm">Rimuovi fascia {index + 1}</button>
      </div>)}
      <button type="button" onClick={() => setRows(previous => [...previous, {
        min_participants: Math.max(0, ...previous.map(row => row.max_participants)) + 1,
        max_participants: Math.max(0, ...previous.map(row => row.max_participants)) + 1,
        your_unit_price: 0, public_unit_price: 0, supplier_adult_unit_cost: 0,
      }])} className="rounded-lg border px-3 py-2 text-sm">Aggiungi fascia</button>
    </>}
  </fieldset>;
}
