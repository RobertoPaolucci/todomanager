"use client";

import { useState } from "react";

export default function PrintPdfButton() {
  const [isPrinting, setIsPrinting] = useState(false);

  function handlePrint() {
    setIsPrinting(true);

    /**
     * Piccolo ritardo per permettere al browser di applicare eventuali
     * classi/stili di stampa prima di aprire la finestra PDF.
     */
    window.setTimeout(() => {
      window.print();

      window.setTimeout(() => {
        setIsPrinting(false);
      }, 500);
    }, 100);
  }

  return (
    <button
      type="button"
      onClick={handlePrint}
      disabled={isPrinting}
      className="inline-flex items-center justify-center rounded-xl bg-zinc-900 px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60 print:hidden"
    >
      {isPrinting ? "Preparazione PDF..." : "Stampa / Salva PDF"}
    </button>
  );
}