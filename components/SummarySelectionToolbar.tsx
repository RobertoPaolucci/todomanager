"use client";

import { useEffect, useState } from "react";

type Props = {
  formId?: string;
};

function getInputs(formId: string) {
  if (typeof document === "undefined") return [];

  return Array.from(
    document.querySelectorAll<HTMLInputElement>(
      `input[name="ids"][form="${formId}"]`
    )
  );
}

function isVisible(element: HTMLElement) {
  return !!(
    element.offsetWidth ||
    element.offsetHeight ||
    element.getClientRects().length
  );
}

export default function SummarySelectionToolbar({
  formId = "summaryForm",
}: Props) {
  const [selectedCount, setSelectedCount] = useState(0);

  useEffect(() => {
    const syncCount = () => {
      const selected = getInputs(formId).filter((input) => input.checked).length;
      setSelectedCount(selected);
    };

    syncCount();
    document.addEventListener("change", syncCount);
    window.addEventListener("resize", syncCount);

    return () => {
      document.removeEventListener("change", syncCount);
      window.removeEventListener("resize", syncCount);
    };
  }, [formId]);

  function handleSelectVisible() {
    const visibleInputs = getInputs(formId).filter(
      (input) => !input.disabled && isVisible(input)
    );

    visibleInputs.forEach((input) => {
      input.checked = true;
    });

    setSelectedCount(visibleInputs.length);
  }

  function handleClear() {
    const inputs = getInputs(formId);

    inputs.forEach((input) => {
      input.checked = false;
    });

    setSelectedCount(0);
  }

  return (
    <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="text-sm font-bold text-zinc-900">
          Prenotazioni selezionate: {selectedCount}
        </div>
        <div className="text-xs text-zinc-500">
          Seleziona le righe e poi apri il riepilogo.
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleSelectVisible}
          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm font-bold text-zinc-700 shadow-sm transition hover:bg-zinc-100"
        >
          Seleziona visibili
        </button>

        <button
          type="button"
          onClick={handleClear}
          disabled={selectedCount === 0}
          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm font-bold text-zinc-700 shadow-sm transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Annulla selezionati
        </button>

        <button
          type="submit"
          form={formId}
          disabled={selectedCount === 0}
          className="inline-flex min-h-11 items-center justify-center rounded-xl bg-zinc-900 px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Apri riepilogo
        </button>
      </div>
    </div>
  );
}