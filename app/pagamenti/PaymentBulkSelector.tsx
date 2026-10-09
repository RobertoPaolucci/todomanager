"use client";

import { useMemo, useState, useTransition } from "react";
import { bulkMarkSupplierPaymentsPaid } from "./actions";
import { PAYMENT_METHOD_OPTIONS } from "./payment-selection";

type Movement = {
  id: number;
  booking_date: string | null;
  customer_name: string | null;
  booking_reference: string | null;
  experience_name: string | null;
  channel_name: string;
  business_unit_code: string;
  costo: number;
  pagato: number;
  residuo: number;
  stato: string;
  isCancelled: boolean;
  isFuture: boolean;
  isInternal: boolean;
  selectableCents: number;
};

type Props = { supplierId: number; rows: Movement[]; today: string; returnToPath: string; initialQuery: string };

function euro(value: number) {
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(value);
}

function selectable(row: Movement) { return row.selectableCents > 0; }

export default function PaymentBulkSelector({ supplierId, rows, today, returnToPath, initialQuery }: Props) {
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const [customer, setCustomer] = useState("");
  const [channel, setChannel] = useState("");
  const [query, setQuery] = useState(initialQuery);
  const [selected, setSelected] = useState<number[]>([]);
  const [method, setMethod] = useState("Bonifico Bancario");
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: number[]; errors: { id: number; reason: string }[] } | null>(null);

  const years = useMemo(() => Array.from(new Set(rows.map((row) => row.booking_date?.slice(0, 4)).filter(Boolean))).sort().reverse() as string[], [rows]);
  const channels = useMemo(() => Array.from(new Set(rows.map((row) => row.channel_name).filter(Boolean))).sort(), [rows]);
  const filteredRows = useMemo(() => rows.filter((row) => {
    const date = row.booking_date || "";
    return (!month || date.slice(5, 7) === month) && (!year || date.slice(0, 4) === year) &&
      (!customer || (row.customer_name || "").toLowerCase().includes(customer.toLowerCase())) &&
      (!channel || row.channel_name === channel) &&
      (!query || [row.customer_name, row.booking_reference, row.experience_name, row.channel_name, row.stato, row.booking_date, String(row.id)].some((value) => String(value || "").toLowerCase().includes(query.toLowerCase())));
  }), [rows, month, year, customer, channel, query]);
  const selectedRows = rows.filter((row) => selected.includes(row.id) && selectable(row));
  const total = selectedRows.reduce((sum, row) => sum + row.residuo, 0);
  const eligibleInFilter = filteredRows.filter(selectable);

  function toggle(id: number) {
    setMessage(null);
    setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }

  function selectMonth() {
    setSelected((current) => Array.from(new Set([...current, ...eligibleInFilter.map((row) => row.id)])));
  }

  function submit() {
    if (!selectedRows.length) return;
    const confirmed = window.confirm(`Confermi il pagamento di ${selectedRows.length} movimenti per un totale di ${euro(total)}?`);
    if (!confirmed) return;
    const formData = new FormData();
    formData.set("supplier_id", String(supplierId));
    formData.set("booking_ids", JSON.stringify(selectedRows.map((row) => row.id)));
    formData.set("payment_method", method);
    formData.set("payment_date", today);
    startTransition(async () => {
      const result = await bulkMarkSupplierPaymentsPaid(formData);
      setMessage({ ok: result.paid, errors: result.failures });
      setSelected((current) => current.filter((id) => !result.paid.includes(id)));
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
        <div className="grid gap-3 md:grid-cols-4">
          <label className="text-sm font-medium text-zinc-700 md:col-span-2">Ricerca
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cliente, riferimento, esperienza, stato..." className="mt-1 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2" />
          </label>
          <label className="text-sm font-medium text-zinc-700">Mese
            <select value={month} onChange={(event) => setMonth(event.target.value)} className="mt-1 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2">
              <option value="">Tutti</option>{Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={String(index + 1).padStart(2, "0")}>{String(index + 1).padStart(2, "0")}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium text-zinc-700">Anno
            <select value={year} onChange={(event) => setYear(event.target.value)} className="mt-1 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2">
              <option value="">Tutti</option>{years.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium text-zinc-700">Cliente
            <input value={customer} onChange={(event) => setCustomer(event.target.value)} placeholder="Cerca cliente" className="mt-1 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2" />
          </label>
          <label className="text-sm font-medium text-zinc-700">Canale
            <select value={channel} onChange={(event) => setChannel(event.target.value)} className="mt-1 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2">
              <option value="">Tutti</option>{channels.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" onClick={selectMonth} disabled={!month || !year || eligibleInFilter.length === 0} className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40">Seleziona mese</button>
          <span className="text-sm font-medium text-zinc-700">{selectedRows.length} selezionati · <strong>{euro(total)}</strong></span>
          <select value={method} onChange={(event) => setMethod(event.target.value)} className="rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm" aria-label="Metodo di pagamento">
            {PAYMENT_METHOD_OPTIONS.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <button type="button" onClick={submit} disabled={isPending || !selectedRows.length} className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40">{isPending ? "Salvataggio..." : "Segna selezionati come pagati"}</button>
        </div>
        {message && <div className="mt-3 rounded-xl border border-zinc-200 bg-white p-3 text-sm"><p className="text-emerald-700">Aggiornati: {message.ok.length}</p>{message.errors.length > 0 && <p className="mt-1 text-red-700">Non aggiornati: {message.errors.map((error) => `#${error.id}: ${error.reason}`).join(" · ")}</p>}</div>}
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-zinc-200 text-[10px] font-bold uppercase text-zinc-500"><tr><th className="py-3 pr-4">Sel.</th><th className="py-3 pr-4">Data Exp</th><th className="py-3 pr-4">Cliente / Rif.</th><th className="py-3 pr-4">Esperienza / Canale</th><th className="py-3 pr-4">Importo</th><th className="py-3 pr-4">Stato</th><th className="py-3 pr-4 text-right">Azioni</th></tr></thead>
          <tbody>{filteredRows.map((row) => <tr key={row.id} className={`border-b border-zinc-100 ${row.isCancelled ? "bg-zinc-50/50 opacity-50" : ""}`}>
            <td className="py-4 pr-4"><input type="checkbox" checked={selected.includes(row.id)} onChange={() => toggle(row.id)} disabled={!selectable(row)} aria-label={`Seleziona movimento ${row.id}`} className="h-4 w-4" /></td>
            <td className="whitespace-nowrap py-4 pr-4">{row.booking_date ? new Intl.DateTimeFormat("it-IT").format(new Date(row.booking_date)) : "-"}</td>
            <td className="py-4 pr-4"><div className="font-medium text-zinc-900">{row.customer_name}</div><div className="font-mono text-xs text-zinc-500">{row.booking_reference || `#${row.id}`}</div></td>
            <td className="py-4 pr-4"><div>{row.experience_name}</div><div className="text-xs text-zinc-500">{row.channel_name || "Canale non indicato"}</div></td>
            <td className="py-4 pr-4"><div className="font-bold">{euro(row.costo)}</div>{row.residuo > 0 && row.pagato > 0 && <div className="text-[11px] text-blue-600">Residuo: {euro(row.residuo)}</div>}</td>
            <td className="py-4 pr-4"><span className="rounded-lg bg-zinc-100 px-2 py-1 text-[10px] font-bold uppercase">{row.stato}</span></td>
            <td className="py-4 pr-4 text-right"><a href={`/prenotazioni/${row.id}/modifica?viewOnly=true&returnTo=${encodeURIComponent(returnToPath)}`} className="rounded-lg border border-zinc-300 px-3 py-2 text-xs">Apri</a></td>
          </tr>)}{filteredRows.length === 0 && <tr><td colSpan={7} className="py-8 text-center text-zinc-500">Nessuna prenotazione trovata con i filtri attuali.</td></tr>}</tbody>
        </table>
      </div>
    </div>
  );
}
