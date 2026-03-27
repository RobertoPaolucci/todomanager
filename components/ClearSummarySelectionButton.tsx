"use client";

type Props = {
  formId?: string;
};

export default function ClearSummarySelectionButton({
  formId = "summaryForm",
}: Props) {
  function handleClear() {
    const inputs = document.querySelectorAll<HTMLInputElement>(
      `input[name="ids"][form="${formId}"]`
    );

    inputs.forEach((input) => {
      input.checked = false;
    });
  }

  return (
    <button
      type="button"
      onClick={handleClear}
      className="inline-flex min-h-11 items-center justify-center rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm font-bold text-zinc-700 shadow-sm transition hover:bg-zinc-100"
    >
      Annulla selezionati
    </button>
  );
}