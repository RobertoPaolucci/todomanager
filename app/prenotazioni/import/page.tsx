"use client";

import { useState, useEffect } from "react";
import AppShell from "@/components/AppShell";
import SectionCard from "@/components/SectionCard";
import { importBokunBookings, getCloudData, saveMappingToCloud, clearLogsFromCloud } from "./actions";
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
  const [importHistory, setImportHistory] = useState<any[]>([]);
  const [detectedSource, setDetectedSource] = useState<string>("");

  useEffect(() => {
    getCloudData().then(data => {
      setExperiences(data.experiences);
      setMappings(data.mappings);
      setImportHistory(data.logs);
    });
  }, []);

  const handleMappingChange = async (title: string, value: string) => {
    const newMappings = { ...mappings };
    const expId = value ? Number(value) : null;
    
    if (expId) {
      newMappings[title] = expId;
    } else {
      delete newMappings[title];
    }
    
    setMappings(newMappings);
    await saveMappingToCloud(title, expId);
  };

  const handleFileUpload = (e: any) => {
    setError(null);
    setStatus(null);
    setDetectedSource("");
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = new Uint8Array(event.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows: any[] = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

        if (rows.length === 0) {
          setError("Il file caricato sembra essere vuoto.");
          return;
        }

        const isBokun = rows[0].hasOwnProperty("Product title");
        const isGYG = rows[0].hasOwnProperty("Booking Ref #") && rows[0].hasOwnProperty("Product");

        if (!isBokun && !isGYG) {
          setError("Errore: Formato non riconosciuto. Assicurati che sia un export di Bokun o di GetYourGuide.");
          return;
        }

        const titleColumn = isGYG ? "Product" : "Product title";
        setDetectedSource(isGYG ? "GetYourGuide" : "Bokun");

        const titles = Array.from(new Set(rows.map((r: any) => r[titleColumn]).filter(Boolean)));
        setFileData(rows);
        setUniqueTitles(titles as string[]);
      } catch (err) {
        console.error(err);
        setError("Errore critico durante la lettura del file Excel/CSV.");
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
      const updatedData = await getCloudData();
      setImportHistory(updatedData.logs);
    } catch (err: any) {
      setError(`Errore durante l'importazione: ${err.message}`);
    }
    setLoading(false);
  };

  const handleClearHistory = async () => {
    if (confirm("Sei sicuro di voler svuotare lo storico visivo? I dati nel gestionale non verranno toccati.")) {
      await clearLogsFromCloud();
      setImportHistory([]);
    }
  };

  return (
    <AppShell title="Strumenti Dati" subtitle="Gestione massiva di prenotazioni e pagamenti">
      <div className="max-w-4xl pb-10">
        
        <div className="flex gap-8 border-b border-zinc-200 mb-8">
          <Link href="/prenotazioni/import" className="border-b-2 border-zinc-900 py-3 text-sm font-bold text-zinc-900">
            📥 Importa Storico (Bokun/GYG)
          </Link>
          <Link href="/prenotazioni/riconciliazione" className="py-3 text-sm font-medium text-zinc-500 hover:text-zinc-800 transition">
            ✅ Riconcilia Pagamenti OTA
          </Link>
        </div>

        <div className="space-y-6">
          <SectionCard title="1. Carica il file Excel o CSV">
            <p className="text-sm text-zinc-500 mb-4">
              Il sistema riconosce automaticamente se si tratta di un export da <strong>Bokun</strong> o da <strong>GetYourGuide</strong>.
            </p>
            <input 
              type="file" 
              accept=".xlsx, .xls, .csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" 
              onChange={handleFileUpload} 
              className="block w-full text-sm text-zinc-500 file:mr-4 file:py-2.5 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-bold file:bg-zinc-900 file:text-white hover:file:bg-zinc-700 cursor-pointer"
            />
            {error && <p className="mt-3 text-sm font-bold text-red-600 bg-red-50 p-3 rounded-lg border border-red-100">{error}</p>}
          </SectionCard>

          {uniqueTitles.length > 0 && !status && (
            <SectionCard title="2. Mappatura Esperienze">
              <div className="flex items-center gap-4 mb-6 p-4 rounded-xl border border-blue-100 bg-blue-50">
                <div className="flex-1">
                  <p className="text-sm font-bold text-blue-900">File riconosciuto: {detectedSource}</p>
                  <p className="text-xs text-blue-700 mt-1">Le scelte sono salvate in Cloud e saranno visibili su tutti i dispositivi.</p>
                </div>
              </div>

              <div className="space-y-4">
                {uniqueTitles.map(title => (
                  <div key={title} className="flex flex-col gap-3 p-4 rounded-xl border border-zinc-200 bg-zinc-50/50 sm:flex-row sm:items-start sm:gap-6">
                    <span className="flex-1 text-xs font-bold text-zinc-700 break-words leading-relaxed pt-2">
                      {title}
                    </span>
                    <select 
                      className="flex-1 rounded-xl border border-zinc-300 p-3 text-sm bg-white outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 whitespace-normal break-words"
                      value={mappings[title] || ""}
                      onChange={(e) => handleMappingChange(title, e.target.value)}
                    >
                      <option value="">-- Ignora questa esperienza --</option>
                      {experiences.map(ex => (
                        <option key={ex.id} value={ex.id}>{ex.name}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              <div className="mt-8 pt-6 border-t border-zinc-100">
                <button 
                  onClick={startImport}
                  disabled={loading}
                  className="w-full rounded-xl bg-zinc-900 py-4 font-bold text-white shadow-lg transition hover:bg-zinc-700 disabled:bg-zinc-300 disabled:shadow-none"
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
              
              {status.errors.length > 0 && (
                <div className="mt-6">
                  <p className="text-xs font-bold text-red-500 uppercase mb-2">Dettaglio Errori:</p>
                  <div className="max-h-40 overflow-y-auto rounded-lg bg-red-50 p-4 text-[11px] font-mono text-red-900 border border-red-100 space-y-1">
                    {status.errors.map((err: string, i: number) => <div key={i}>{err}</div>)}
                  </div>
                </div>
              )}

              <div className="mt-6 flex gap-3">
                <button onClick={() => setStatus(null)} className="flex-1 rounded-xl border-2 border-zinc-200 py-4 font-bold text-zinc-700 hover:bg-zinc-50 transition">Nuovo caricamento</button>
                <Link href="/prenotazioni" className="flex-1 text-center py-4 rounded-xl bg-zinc-900 font-bold text-white hover:bg-zinc-700 shadow-md">Vedi prenotazioni</Link>
              </div>
            </div>
          )}

          {importHistory.length > 0 && (
            <div className="mt-8 rounded-2xl border border-zinc-200 bg-white overflow-hidden shadow-sm">
              <div className="flex items-center justify-between border-b border-zinc-100 bg-zinc-50/50 px-5 py-4">
                <h3 className="text-sm font-bold text-zinc-900">🕒 Storico Importazioni in Cloud</h3>
                <button onClick={handleClearHistory} className="text-[11px] font-bold text-red-500 hover:text-red-700 uppercase tracking-wide">Svuota elenco</button>
              </div>
              <div className="divide-y divide-zinc-100">
                {importHistory.map((log) => {
                  const dateObj = new Date(log.created_at);
                  const data = dateObj.toLocaleDateString("it-IT", { day: '2-digit', month: '2-digit', year: 'numeric' });
                  const ora = dateObj.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

                  return (
                    <div key={log.id} className="flex items-center justify-between px-5 py-3 hover:bg-zinc-50">
                      <div className="flex flex-col">
                        <span className="text-sm font-bold text-zinc-800">{data}</span>
                        <span className="text-xs font-medium text-zinc-400">{ora}</span>
                      </div>
                      <div className="flex gap-4 text-xs font-bold">
                        <span className="text-green-600">+{log.imported} caricate</span>
                        <span className="text-amber-500">{log.skipped} saltate</span>
                        {log.errors > 0 && <span className="text-red-500">{log.errors} errori</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}