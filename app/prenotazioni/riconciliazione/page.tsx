"use client";

import { useState } from "react";
import AppShell from "@/components/AppShell";
import SectionCard from "@/components/SectionCard";
import { reconcilePayments } from "./actions";
import * as XLSX from "xlsx";
import Link from "next/link";

export default function ReconcilePage() {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [extractedRefs, setExtractedRefs] = useState<string[]>([]);
  const [fileType, setFileType] = useState<string>("");

  const handleFileUpload = (e: any) => {
    setError(null);
    setStatus(null);
    setExtractedRefs([]);
    setFileType("");

    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = (event) => {
      try {
        const data = new Uint8Array(event.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        
        // Leggiamo tutto come array di array per trovare l'intestazione fluttuante
        const rows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
        
        let isViator = false;
        let isGYG = false;
        let headerRowIdx = -1;

        // Cerca la riga di intestazione giusta
        for (let i = 0; i < rows.length; i++) {
          const rowStr = rows[i].join(" ").toUpperCase();
          if (rowStr.includes("VIATOR REFERENCE")) {
            isViator = true;
            headerRowIdx = i;
            break;
          } else if (rowStr.includes("BOOKING REF #") || rowStr.includes("BOOKING REF")) {
            isGYG = true;
            headerRowIdx = i;
            break;
          }
        }

        if (headerRowIdx === -1) {
          setError("Formato non riconosciuto. Assicurati che sia un file pagamenti di Viator o GetYourGuide.");
          return;
        }

        const refs = new Set<string>();
        const headers = rows[headerRowIdx].map(String).map(h => h.toUpperCase().trim());

        if (isViator) {
          setFileType("Viator");
          const vRefIdx = headers.indexOf("VIATOR REFERENCE");
          const sRefIdx = headers.indexOf("SUPPLIER CONFIRMATION");
          
          for (let i = headerRowIdx + 1; i < rows.length; i++) {
            if (vRefIdx !== -1 && rows[i][vRefIdx]) refs.add(String(rows[i][vRefIdx]).trim());
            if (sRefIdx !== -1 && rows[i][sRefIdx]) refs.add(String(rows[i][sRefIdx]).trim());
          }
        } else if (isGYG) {
          setFileType("GetYourGuide");
          const gRefIdx = headers.findIndex(h => h.includes("BOOKING REF"));
          
          for (let i = headerRowIdx + 1; i < rows.length; i++) {
            if (gRefIdx !== -1 && rows[i][gRefIdx]) refs.add(String(rows[i][gRefIdx]).trim());
          }
        }

        const finalRefs = Array.from(refs).filter(r => r !== "" && r !== "undefined");
        
        if (finalRefs.length === 0) {
          setError("Nessun codice di prenotazione trovato nel file.");
        } else {
          setExtractedRefs(finalRefs);
        }

      } catch (err) {
        console.error(err);
        setError("Errore nella lettura del file. Verifica che non sia corrotto.");
      }
    };

    reader.readAsArrayBuffer(file);
  };

  const handleReconcile = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await reconcilePayments(extractedRefs);
      setStatus(result);
    } catch (err: any) {
      setError(`Errore: ${err.message}`);
    }
    setLoading(false);
  };

  return (
    <AppShell title="Riconciliazione Pagamenti" subtitle="Segna le prenotazioni incassate dai file delle OTA">
      <div className="space-y-6 max-w-4xl pb-10">
        <SectionCard title="1. Carica la Fattura/Report Pagamenti">
          <p className="text-sm text-zinc-500 mb-4">
            Carica il file Excel o CSV scaricato dal portale pagamenti di Viator o GetYourGuide. Il sistema ignorerà le righe inutili e cercherà in automatico i codici.
          </p>
          <input 
            type="file" 
            accept=".xlsx, .xls, .csv" 
            onChange={handleFileUpload} 
            className="block w-full text-sm text-zinc-500 file:mr-4 file:py-2.5 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-bold file:bg-zinc-900 file:text-white hover:file:bg-zinc-700 cursor-pointer"
          />
          {error && <p className="mt-4 text-sm font-bold text-red-600 bg-red-50 p-3 rounded-lg border border-red-100">{error}</p>}
        </SectionCard>

        {extractedRefs.length > 0 && !status && (
          <SectionCard title="2. Conferma e Riconcilia">
            <div className="flex items-center gap-4 mb-6 p-4 rounded-xl border border-blue-100 bg-blue-50">
              <div className="flex-1">
                <p className="text-sm font-bold text-blue-900">File riconosciuto: {fileType}</p>
                <p className="text-xs text-blue-700 mt-1">Trovati <strong>{extractedRefs.length}</strong> codici riferimento da controllare.</p>
              </div>
            </div>

            <button 
              onClick={handleReconcile}
              disabled={loading}
              className="w-full rounded-xl bg-zinc-900 py-4 font-bold text-white shadow-lg transition hover:bg-zinc-700 disabled:bg-zinc-300 disabled:shadow-none"
            >
              {loading ? "Riconciliazione in corso..." : "Segna come Incassate"}
            </button>
          </SectionCard>
        )}

        {status && (
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <h4 className="text-lg font-bold text-zinc-900 mb-4">Risultato Riconciliazione</h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center">
              <div className="p-4 rounded-xl bg-green-50 border border-green-100">
                <p className="text-[10px] font-bold text-green-600 uppercase">Aggiornate a Incassate</p>
                <p className="text-3xl font-black text-green-700 mt-1">{status.updated}</p>
              </div>
              <div className="p-4 rounded-xl bg-zinc-50 border border-zinc-100">
                <p className="text-[10px] font-bold text-zinc-500 uppercase">Già Incassate (Ignorate)</p>
                <p className="text-3xl font-black text-zinc-700 mt-1">{status.alreadyPaid}</p>
              </div>
              <div className="p-4 rounded-xl bg-amber-50 border border-amber-100">
                <p className="text-[10px] font-bold text-amber-600 uppercase">Non trovate nel DB</p>
                <p className="text-3xl font-black text-amber-700 mt-1">{status.parsed - status.foundInDb}</p>
              </div>
            </div>
            
            <div className="mt-6 pt-6 border-t border-zinc-100 flex gap-3">
              <button onClick={() => {setStatus(null); setExtractedRefs([]);}} className="flex-1 rounded-xl border-2 border-zinc-200 py-4 font-bold text-zinc-700 hover:bg-zinc-50 transition">
                Carica altro file
              </button>
              <Link href="/prenotazioni" className="flex-1 text-center py-4 rounded-xl bg-zinc-900 font-bold text-white hover:bg-zinc-700 shadow-md">
                Torna all'elenco
              </Link>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}