"use client";

import { useMemo, useState } from "react";
import { updateExperience } from "@/app/esperienze/actions";

type Supplier = {
  id: number;
  name: string;
};

type Experience = {
  id: number;
  name: string;
  supplier_id: number | null;
  supplier_unit_cost: number;
  base_price: number;
  notes: string | null;
  active: boolean;
};

type ModificaEsperienzaFormProps = {
  suppliers: Supplier[];
  experience: Experience;
};

export default function ModificaEsperienzaForm({
  suppliers,
  experience,
}: ModificaEsperienzaFormProps) {
  const [supplierCost, setSupplierCost] = useState(
    Number(experience.supplier_unit_cost || 0)
  );
  const [todPrice, setTodPrice] = useState(Number(experience.base_price || 0));

  const margin = useMemo(() => todPrice - supplierCost, [todPrice, supplierCost]);
  const marginPercent = useMemo(() => {
    return todPrice > 0 ? ((margin / todPrice) * 100).toFixed(2) : "0.00";
  }, [margin, todPrice]);

  const updateExperienceWithId = updateExperience.bind(null, experience.id);

  return (
    <form action={updateExperienceWithId} className="grid gap-4 md:grid-cols-2">
      <div className="md:col-span-2">
        <label className="mb-1 block text-sm font-medium text-zinc-700">
          Nome esperienza
        </label>
        <input
          name="name"
          type="text"
          required
          defaultValue={experience.name}
          className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none focus:border-zinc-500"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-zinc-700">
          Fornitore
        </label>
        <select
          name="supplier_id"
          defaultValue={experience.supplier_id ?? ""}
          className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none focus:border-zinc-500"
        >
          <option value="">Nessun fornitore</option>
          {suppliers.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-zinc-700">
          Costo fornitore per persona
        </label>
        <input
          name="supplier_unit_cost"
          type="number"
          min="0"
          step="0.01"
          value={supplierCost}
          onChange={(e) => setSupplierCost(Number(e.target.value))}
          required
          className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none focus:border-zinc-500"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-zinc-700">
          Prezzo TOD
        </label>
        <input
          name="base_price"
          type="number"
          min="0"
          step="0.01"
          value={todPrice}
          onChange={(e) => setTodPrice(Number(e.target.value))}
          required
          className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none focus:border-zinc-500"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-zinc-700">
          Stato
        </label>
        <select
          name="active"
          defaultValue={String(experience.active)}
          className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none focus:border-zinc-500"
        >
          <option value="true">attiva</option>
          <option value="false">non attiva</option>
        </select>
      </div>

      <div className="md:col-span-2 rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
        <h3 className="mb-3 text-lg font-semibold text-zinc-900">
          Riepilogo margine TOD
        </h3>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-zinc-200 bg-white p-4">
            <p className="text-sm text-zinc-500">Margine €</p>
            <p className="mt-1 text-2xl font-bold text-zinc-900">
              € {margin.toFixed(2)}
            </p>
          </div>

          <div className="rounded-xl border border-zinc-200 bg-white p-4">
            <p className="text-sm text-zinc-500">Margine %</p>
            <p className="mt-1 text-2xl font-bold text-zinc-900">
              {marginPercent}%
            </p>
          </div>
        </div>
      </div>

      <div className="md:col-span-2">
        <label className="mb-1 block text-sm font-medium text-zinc-700">
          Note
        </label>
        <textarea
          name="notes"
          rows={4}
          defaultValue={experience.notes || ""}
          className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none focus:border-zinc-500"
        />
      </div>

      <div className="md:col-span-2 flex gap-3 pt-2">
        <button
          type="submit"
          className="rounded-xl bg-zinc-900 px-5 py-3 text-white transition hover:bg-zinc-700"
        >
          Salva modifiche
        </button>

        <a
          href="/esperienze"
          className="rounded-xl border border-zinc-300 px-5 py-3 text-zinc-700 transition hover:bg-zinc-100"
        >
          Annulla
        </a>
      </div>
    </form>
  );
}