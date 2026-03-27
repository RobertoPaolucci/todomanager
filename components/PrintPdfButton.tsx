"use client";

export default function PrintPdfButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex items-center justify-center rounded-xl bg-zinc-900 px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-zinc-700"
    >
      Stampa / Salva PDF
    </button>
  );
}