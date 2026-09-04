"use client";

import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";

export type InvoiceReportRow = {
  key: string;
  experience: string;
  category: "Adulti" | "Bambini";
  quantity: number;
  unitPrice: number | null;
  total: number;
};

type InvoiceReportButtonProps = {
  channelName: string;
  companyName?: string;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  period: string;
  rows: InvoiceReportRow[];
  totalAdults: number;
  totalChildren: number;
  totalInvoice: number;
};

function formatEuro(value: number) {
  return new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR",
  }).format(value);
}

function formatDate(value?: string | null) {
  if (!value) return null;

  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(`${value.slice(0, 10)}T12:00:00`));
}

export default function InvoiceReportButton({
  channelName,
  companyName,
  invoiceNumber,
  invoiceDate,
  period,
  rows,
  totalAdults,
  totalChildren,
  totalInvoice,
}: InvoiceReportButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const titleId = useId();
  const formattedInvoiceDate = formatDate(invoiceDate);
  const reportName = companyName
    ? `${channelName} - ${companyName}`
    : channelName;

  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="h-[40px] whitespace-nowrap rounded-lg border border-zinc-300 bg-white px-4 text-xs font-bold text-zinc-700 shadow-sm transition hover:bg-zinc-50"
      >
        Report fattura
      </button>

      {isOpen &&
        createPortal(
        <div
          className="invoice-report-overlay fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/55 p-3 sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setIsOpen(false);
          }}
        >
          <article className="invoice-report-print my-auto w-full max-w-5xl rounded-2xl bg-white p-5 shadow-2xl sm:p-8">
            <div className="invoice-report-no-print mb-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-bold text-zinc-700 hover:bg-zinc-50"
              >
                Chiudi
              </button>

              <button
                type="button"
                onClick={() => window.print()}
                className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-zinc-700"
              >
                Stampa
              </button>
            </div>

            <header className="border-b-2 border-zinc-900 pb-5">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-500">
                Report fatturazione
              </p>
              <h2 id={titleId} className="mt-1 text-2xl font-black text-zinc-950 sm:text-3xl">
                {reportName}
              </h2>

              <div className="mt-4 grid gap-1 text-sm text-zinc-700 sm:grid-cols-2">
                {invoiceNumber && (
                  <p>
                    <strong>Fattura:</strong> {invoiceNumber}
                  </p>
                )}
                {formattedInvoiceDate && (
                  <p>
                    <strong>Data:</strong> {formattedInvoiceDate}
                  </p>
                )}
                <p>
                  <strong>Periodo:</strong> {period}
                </p>
              </div>
            </header>

            <div className="invoice-report-table-wrapper mt-6 overflow-x-auto">
              <table className="w-full min-w-[700px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b-2 border-zinc-300 text-xs uppercase text-zinc-600">
                    <th className="px-3 py-3">Esperienza</th>
                    <th className="px-3 py-3">Categoria</th>
                    <th className="px-3 py-3 text-right">Quantità</th>
                    <th className="px-3 py-3 text-right">Prezzo unitario</th>
                    <th className="px-3 py-3 text-right">Totale</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.key} className="border-b border-zinc-200">
                      <td className="px-3 py-3 font-semibold text-zinc-900">
                        {row.experience}
                      </td>
                      <td className="px-3 py-3 text-zinc-700">{row.category}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{row.quantity}</td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {row.unitPrice === null ? "Variabile" : formatEuro(row.unitPrice)}
                      </td>
                      <td className="px-3 py-3 text-right font-bold tabular-nums">
                        {formatEuro(row.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <footer className="mt-7 ml-auto w-full max-w-sm border-t-2 border-zinc-900 pt-4 text-sm">
              <div className="flex justify-between gap-4 py-1">
                <span>Totale adulti:</span>
                <strong>{totalAdults}</strong>
              </div>
              <div className="flex justify-between gap-4 py-1">
                <span>Totale bambini:</span>
                <strong>{totalChildren}</strong>
              </div>
              <div className="flex justify-between gap-4 py-1">
                <span>Totale persone:</span>
                <strong>{totalAdults + totalChildren}</strong>
              </div>
              <div className="mt-2 flex justify-between gap-4 border-t border-zinc-300 pt-3 text-lg">
                <span className="font-bold">Totale fattura:</span>
                <strong>{formatEuro(totalInvoice)}</strong>
              </div>
            </footer>
          </article>
        </div>,
        document.body
      )}
    </>
  );
}
