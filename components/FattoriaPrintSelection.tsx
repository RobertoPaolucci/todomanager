"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { buildFattoriaPrintDocument, formatPrintDate, togglePrintSelection, type FattoriaPrintEntry } from "@/lib/fattoria-print";

const SelectionContext = createContext<{
  selected: number[];
  date: string | undefined;
  toggle: (id: number) => void;
} | null>(null);

export function FattoriaPrintSelection({ entries, children }: { entries: FattoriaPrintEntry[]; children: ReactNode }) {
  const [selected, setSelected] = useState<number[]>([]);
  const [message, setMessage] = useState("");
  const [document, setDocument] = useState<{ html: string; key: number } | null>(null);
  const date = entries.find(entry => selected.includes(entry.id))?.date;

  function toggle(id: number) {
    const entry = entries.find(item => item.id === id);
    if (!entry) return;
    setSelected(current => togglePrintSelection(current, entry, entries));
    setMessage("");
  }

  function print() {
    const html = buildFattoriaPrintDocument(entries, selected);
    if (!html) {
      setMessage("Seleziona almeno un'esperienza da stampare.");
      return;
    }
    setMessage("");
    setDocument(current => ({ html, key: (current?.key ?? 0) + 1 }));
  }

  return (
    <SelectionContext.Provider value={{ selected, date, toggle }}>
      <div className="flex flex-wrap items-center gap-3 border-t border-zinc-200 px-4 py-3">
        <button type="button" onClick={print} className="min-h-11 rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white">Stampa selezionate</button>
        {date ? <>
          <span className="text-sm text-zinc-700">{selected.length} selezionate · {formatPrintDate(date)}. Per un altro giorno, azzera la selezione.</span>
          <button type="button" onClick={() => { setSelected([]); setMessage(""); }} className="min-h-11 rounded-xl border border-zinc-300 px-3 text-sm">Azzera selezione</button>
        </> : <span className="text-sm text-zinc-600">Seleziona le voci di un giorno da includere nella stampa.</span>}
        {message && <p role="alert" className="w-full text-sm text-red-700">{message}</p>}
      </div>
      {children}
      {document && <iframe key={document.key} title="Foglio operativo Fattoria" srcDoc={document.html}
        aria-hidden="true" tabIndex={-1} className="fixed -left-[10000px] top-0 h-px w-px border-0"
        onLoad={event => {
          const printWindow = event.currentTarget.contentWindow;
          if (printWindow) { printWindow.focus(); printWindow.print(); }
        }} />}
    </SelectionContext.Provider>
  );
}

export function FattoriaPrintCheckbox({ id, date, label }: { id: number; date: string; label: string }) {
  const selection = useContext(SelectionContext);
  if (!selection) return null;
  const disabled = !!selection.date && selection.date !== date;
  return <label className="absolute left-0 top-0 z-10 flex min-h-8 w-5 cursor-pointer items-center justify-center sm:w-6"
    title={disabled ? "Azzera la selezione per scegliere un altro giorno" : "Includi nella stampa"}
    onClick={event => event.stopPropagation()}>
    <input type="checkbox" checked={selection.selected.includes(id)} disabled={disabled}
      aria-label={`Includi nella stampa: ${label}, ${formatPrintDate(date)}, prenotazione ${id}`}
      className="h-3.5 w-3.5 cursor-pointer accent-zinc-900 disabled:cursor-not-allowed disabled:opacity-40"
      onChange={() => selection.toggle(id)} />
  </label>;
}
