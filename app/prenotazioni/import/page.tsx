"use client";

import { useState, useEffect } from "react";
import AppShell from "@/components/AppShell";
import SectionCard from "@/components/SectionCard";
import { importBokunBookings } from "./actions";
import { supabase } from "@/lib/supabase";
import * as XLSX from "xlsx";
import Link from "next/link";

export default function ImportPage() {
  const [fileData, setFileData] = useState<any[]>([]);
  const [uniqueTitles, setUniqueTitles] = useState<string[]>([]);
  const [mappings, setMappings] = useState<Record<string, number>>({});
  const [experiences, setExperiences] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.from("experiences").select("id, name").order("name")
      .then(({ data }) => setExperiences(data || []));
  }, []);

  const handleFileUpload = (e: any) => {
    setError(null);
    setStatus(null);
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = (event) => {
      try {
        // Leggiamo come ArrayBuffer per la massima compatibilità con .xlsx
        const data = new Uint8Array(event.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        
        const worksheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[worksheetName];
        
        // Convertiamo in JSON (defval evita che le celle vuote facciano saltare la mappatura)
        const rows: any[] = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

        if (rows.length === 0) {
          setError("Il file caricato sembra essere vuoto.");
          return;
        }

        // Verifica colonna chiave di Bokun
        if (!rows[0].hasOwnProperty("Product title")) {
          setError("Errore: Non trovo la colonna 'Product title'. Verifica che sia l'export originale di Bokun.");
          return;
        }

        const titles = Array.from(new Set(rows.map((r: any) => r["Product title"]).filter(Boolean)));
        setFileData(rows);
        setUniqueTitles(titles as string[]);
      } catch (err) {
        console.error(err);
        setError("Errore critico durante la lettura del file Excel.");
      }
    };

    reader.readAsArrayBuffer(file);
  };

  const startImport = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await importBokunBookings(fileData, mappings);
      setStatus(res);
    } catch (err: any) {
      setError(`Errore durante l'importazione: ${err.message}`);
    }
    setLoading(false);
  };

  return (
    <AppShell title="Importatore Excel" subtitle="Recupera lo storico da Bokun (.xlsx)">
      <div className="space-y-6 max-w-4xl">
        <SectionCard title="1. Carica il file Excel">
          <input 
            type="file" 
            // Accetta tutti i formati Excel moderni e vecchi
            accept=".xlsx, .xls, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel" 
            onChange={handleFileUpload} 
            className="block w-full text-sm text-zinc-500 file:mr-4 file:py-2.5 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-bold file:bg-zinc-900 file:text-white hover:file:bg-zinc-700"
          />
          {error && <p className="mt-3 text-sm font-bold text-red-600 bg-red-50 p-3 rounded-lg border border-red-100">{error}</p>}
        </SectionCard>

        {uniqueTitles.length > 0 && !status && (
          <SectionCard title="2. Mappatura Esperienze">
            <p className="text-sm text-zinc-500 mb-6">Ho trovato {uniqueTitles.length} esperienze diverse nel file. Collegale a quelle nel tuo gestionale:</p>
            <div className="space-y-4">
              {uniqueTitles.map(title => (
                <div key={title} className="flex flex-col gap-2 p-3 rounded-xl border border-zinc-100 bg-zinc-50/50 sm:flex-row sm:items-center sm:gap-6">
                  <span className="flex-1 text-xs font-bold text-zinc-600 truncate" title={title}>{title}</span>
                  <select 
                    className="flex-1 rounded-lg border border-zinc-300 p-2.5 text-sm bg-white outline-none focus:border-zinc-500"
                    onChange={(e) => setMappings(prev => ({...prev, [title]: Number(e.target.value)}))}
                  >
                    <option value="">-- Ignora --</option>
                    {experiences.map(ex => <option key={ex.id} value={ex.id}>{ex.name}</option>)}
                  </select>
                </div>
              ))}
            </div>

            <div className="mt-8 pt-6 border-t border-zinc-100">
              <button 
                onClick={startImport}
                disabled={loading}
                className="w-full rounded-xl bg-zinc-900 py-4 font-bold text-white shadow-lg transition hover:bg-zinc-700 disabled:bg-zinc-300"
              >
                {loading ? "Importazione in corso..." : `Avvia importazione di ${fileData.length} righe`}
              </button>
            </div>
          </SectionCard>
        )}

        {status && (
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <h4 className="text-lg font-bold text-zinc-900">Importazione Completata!</h4>
            <div className="mt-4 grid grid-cols-3 gap-4 text-center">
              <div className="p-3 rounded-xl bg-green-50 border border-green-100">
                <p className="text-[10px] font-bold text-green-600 uppercase">Importate</p>
                <p className="text-2xl font-black text-green-700">{status.imported}</p>
              </div>
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-100">
                <p className="text-[10px] font-bold text-amber-600 uppercase">Saltate/Doppie</p>
                <p className="text-2xl font-black text-amber-700">{status.skipped}</p>
              </div>
              <div className="p-3 rounded-xl bg-red-50 border border-red-100">
                <p className="text-[10px] font-bold text-red-600 uppercase">Errori</p>
                <p className="text-2xl font-black text-red-700">{status.errors.length}</p>
              </div>
            </div>
            <Link href="/prenotazioni" className="mt-6 block text-center py-4 rounded-xl bg-zinc-900 font-bold text-white hover:bg-zinc-700 shadow-md">
              Vai a vedere le prenotazioni
            </Link>
          </div>
        )}
      </div>
    </AppShell>
  );
}