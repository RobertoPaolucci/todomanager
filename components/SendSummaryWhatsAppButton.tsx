"use client";

import { useMemo, useState } from "react";

type Supplier = {
  id: number;
  name: string;
  phone: string | null;
};

type Props = {
  suppliers: Supplier[];
  message: string;
};

export default function SendSummaryWhatsAppButton({
  suppliers,
  message,
}: Props) {
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const normalizedSuppliers = useMemo(() => {
    return suppliers.map((supplier) => {
      const cleanPhone = String(supplier.phone || "").replace(/\D/g, "");
      return {
        ...supplier,
        cleanPhone,
        hasPhone: cleanPhone.length > 0,
      };
    });
  }, [suppliers]);

  const selectedSuppliers = normalizedSuppliers.filter((supplier) =>
    selectedIds.includes(supplier.id)
  );

  function toggleSupplier(id: number) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  }

  function clearSelection() {
    setSelectedIds([]);
  }

  function handleSend() {
    if (selectedSuppliers.length === 0) {
      alert("Seleziona almeno un fornitore.");
      return;
    }

    const validSuppliers = selectedSuppliers.filter((supplier) => supplier.hasPhone);

    if (validSuppliers.length === 0) {
      alert("I fornitori selezionati non hanno un numero WhatsApp valido.");
      return;
    }

    validSuppliers.forEach((supplier, index) => {
      const url = `https://api.whatsapp.com/send?phone=${supplier.cleanPhone}&text=${encodeURIComponent(
        message
      )}`;

      setTimeout(() => {
        window.open(url, "_blank", "noopener,noreferrer");
      }, index * 250);
    });
  }

  return (
    <div className="rounded-2xl border border-green-200 bg-green-50 p-4">
      <div className="mb-2 text-sm font-black text-green-900">
        Invia riepilogo via WhatsApp ai fornitori
      </div>

      <div className="mb-3 text-sm text-green-800">
        Seleziona uno o più fornitori dalla rubrica.
      </div>

      <div className="max-h-64 space-y-2 overflow-auto rounded-xl border border-green-100 bg-white p-3">
        {normalizedSuppliers.length === 0 && (
          <div className="text-sm text-zinc-500">Nessun fornitore trovato.</div>
        )}

        {normalizedSuppliers.map((supplier) => (
          <label
            key={supplier.id}
            className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 ${
              supplier.hasPhone
                ? "border-zinc-200 bg-white"
                : "border-red-200 bg-red-50"
            }`}
          >
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={selectedIds.includes(supplier.id)}
                onChange={() => toggleSupplier(supplier.id)}
                className="h-4 w-4 rounded border-zinc-300"
              />
              <div>
                <div className="text-sm font-bold text-zinc-900">{supplier.name}</div>
                <div className="text-xs text-zinc-500">
                  {supplier.phone || "Numero mancante"}
                </div>
              </div>
            </div>

            {!supplier.hasPhone && (
              <span className="rounded-md bg-red-100 px-2 py-1 text-[10px] font-bold uppercase text-red-700">
                no wa
              </span>
            )}
          </label>
        ))}
      </div>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-xs text-zinc-600">
          Selezionati: <span className="font-bold">{selectedSuppliers.length}</span>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={clearSelection}
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm font-bold text-zinc-700 shadow-sm transition hover:bg-zinc-100"
          >
            Annulla fornitori
          </button>

          <button
            type="button"
            onClick={handleSend}
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-green-700 px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-green-800"
          >
            Invia WhatsApp ai selezionati
          </button>
        </div>
      </div>
    </div>
  );
}