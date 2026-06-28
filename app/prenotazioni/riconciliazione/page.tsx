"use client";

import { useEffect, useMemo, useState } from "react";
import AppShell from "@/components/AppShell";
import SectionCard from "@/components/SectionCard";
import { getPaymentReconciliationImportHistory, reconcilePayments } from "./actions";
import * as XLSX from "xlsx";
import Link from "next/link";

type ExtractedReferenceItem = {
  booking_reference: string;
  booking_date: string;
};

type ReconciledBookingItem = {
  id: number;
  booking_reference: string;
  booking_date: string | null;
  customer_name: string | null;
  experience_name: string | null;
};

type NotFoundReferenceItem = {
  booking_reference: string;
  booking_date: string;
};

type ReconcileStatus = {
  parsed: number;
  foundInDb: number;
  updated: number;
  alreadyPaid: number;
  notFound: number;
  notFoundReferences: string[];
  notFoundItems: NotFoundReferenceItem[];
  updatedBookings: ReconciledBookingItem[];
  alreadyPaidBookings: ReconciledBookingItem[];
};

type ImportHistoryItem = {
  id: number;
  created_at: string;
  file_name: string | null;
  file_type: string | null;
  reference_month: string | null;
  reference_start_date: string | null;
  reference_end_date: string | null;
  parsed: number;
  found_in_db: number;
  updated: number;
  already_paid: number;
  not_found: number;
};

function normalizeBookingReference(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
}

function isLikelyBookingReference(value: unknown) {
  const ref = normalizeBookingReference(value);

  if (!ref) return false;
  if (ref === "UNDEFINED" || ref === "NULL" || ref === "N/A") return false;
  if (ref.length < 6 || ref.length > 40) return false;
  if (ref.indexOf(":") !== -1) return false;
  if (!/^[A-Z0-9/_-]+$/.test(ref)) return false;
  if (!/\d/.test(ref)) return false;

  return true;
}

function isValidYmdDate(value: unknown) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim());
}

function formatDateIt(value: string | null) {
  if (!value) return "Data non disponibile";

  const parts = value.split("-").map(Number);
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];

  const dt = new Date(y, (m || 1) - 1, d || 1);

  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(dt);
}

function formatDateTimeIt(value: string | null) {
  if (!value) return { date: "Data non disponibile", time: "" };

  const dt = new Date(value);
  if (isNaN(dt.getTime())) return { date: "Data non disponibile", time: "" };

  return {
    date: new Intl.DateTimeFormat("it-IT", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(dt),
    time: new Intl.DateTimeFormat("it-IT", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(dt),
  };
}

function formatReferenceMonth(value: string | null) {
  if (!value) return "Mese non trovato";

  const match = value.match(/^(\d{4})-(\d{2})$/);
  if (!match) return value;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const dt = new Date(year, month - 1, 1);

  return new Intl.DateTimeFormat("it-IT", {
    month: "long",
    year: "numeric",
  }).format(dt);
}

function formatReferencePeriod(
  startDate: string | null,
  endDate: string | null,
  fallbackMonth: string | null
) {
  if (startDate && endDate) {
    if (startDate === endDate) return formatDateIt(startDate);
    return `${formatDateIt(startDate)} - ${formatDateIt(endDate)}`;
  }

  if (startDate) return formatDateIt(startDate);
  if (endDate) return formatDateIt(endDate);

  return formatReferenceMonth(fallbackMonth);
}

function findReferenceMonthInText(value: string) {
  const text = value.toLowerCase();
  const monthNames: Record<string, string> = {
    gennaio: "01",
    january: "01",
    febbraio: "02",
    february: "02",
    marzo: "03",
    march: "03",
    aprile: "04",
    april: "04",
    maggio: "05",
    may: "05",
    giugno: "06",
    june: "06",
    luglio: "07",
    july: "07",
    agosto: "08",
    august: "08",
    settembre: "09",
    september: "09",
    ottobre: "10",
    october: "10",
    novembre: "11",
    november: "11",
    dicembre: "12",
    december: "12",
  };

  const numericYearMonth = text.match(/\b(20\d{2})[-_/](0?[1-9]|1[0-2])\b/);
  if (numericYearMonth) {
    return `${numericYearMonth[1]}-${pad2(Number(numericYearMonth[2]))}`;
  }

  const numericMonthYear = text.match(/\b(0?[1-9]|1[0-2])[-_/](20\d{2})\b/);
  if (numericMonthYear) {
    return `${numericMonthYear[2]}-${pad2(Number(numericMonthYear[1]))}`;
  }

  const namePattern = new RegExp(
    `\\b(${Object.keys(monthNames).join("|")})\\s+(20\\d{2})\\b`
  );
  const monthNameMatch = text.match(namePattern);
  if (monthNameMatch) {
    return `${monthNameMatch[2]}-${monthNames[monthNameMatch[1]]}`;
  }

  return null;
}

function inferReferenceMonth(
  items: ExtractedReferenceItem[],
  rows: any[][],
  fileName: string
) {
  const monthCounts = new Map<string, number>();

  items.forEach((item) => {
    const month = item.booking_date.slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(month)) {
      monthCounts.set(month, (monthCounts.get(month) || 0) + 1);
    }
  });

  if (monthCounts.size > 0) {
    return Array.from(monthCounts.entries()).sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return b[0].localeCompare(a[0]);
    })[0][0];
  }

  const topRowsText = rows
    .slice(0, 40)
    .map((row) => row.join(" "))
    .join(" ");

  return findReferenceMonthInText(topRowsText) || findReferenceMonthInText(fileName);
}

function inferReferencePeriod(items: ExtractedReferenceItem[]) {
  const dates = Array.from(
    new Set(
      items
        .map((item) => item.booking_date)
        .filter((date) => isValidYmdDate(date))
    )
  ).sort();

  return {
    startDate: dates[0] || null,
    endDate: dates[dates.length - 1] || null,
  };
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function buildYmd(year: number, month: number, day: number): string | null {
  if (isNaN(year) || isNaN(month) || isNaN(day)) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;

  const dt = new Date(year, month - 1, day);

  if (
    dt.getFullYear() !== year ||
    dt.getMonth() !== month - 1 ||
    dt.getDate() !== day
  ) {
    return null;
  }

  return `${String(year).padStart(4, "0")}-${pad2(month)}-${pad2(day)}`;
}

function normalizeDateToYmd(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;

  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    return buildYmd(
      value.getFullYear(),
      value.getMonth() + 1,
      value.getDate()
    );
  }

  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed && parsed.y && parsed.m && parsed.d) {
      return buildYmd(parsed.y, parsed.m, parsed.d);
    }
  }

  const raw = String(value).trim();
  if (!raw) return null;

  const isoMatch = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (isoMatch !== null) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    return buildYmd(year, month, day);
  }

  const shortMatch = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (shortMatch !== null) {
    const first = Number(shortMatch[1]);
    const second = Number(shortMatch[2]);
    let year = Number(shortMatch[3]);

    if (shortMatch[3].length === 2) {
      year = year >= 70 ? 1900 + year : 2000 + year;
    }

    // Priorità formato americano: M/D/Y
    const usDate = buildYmd(year, first, second);
    if (usDate) return usDate;

    // Fallback formato europeo: D/M/Y
    const euDate = buildYmd(year, second, first);
    if (euDate) return euDate;

    return null;
  }

  return null;
}

function normalizeHeader(value: unknown) {
  return String(value || "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

function findDateColumnIndex(headers: string[]) {
  const normalizedHeaders = headers.map(normalizeHeader);

  const strongCandidates = [
    "TRAVEL DATE",
    "ACTIVITY DATE",
    "EXPERIENCE DATE",
    "SERVICE DATE",
    "TOUR DATE",
    "DATE OF SERVICE",
    "DATE OF TRAVEL",
  ];

  for (let i = 0; i < strongCandidates.length; i++) {
    const candidate = strongCandidates[i];
    const idx = normalizedHeaders.findIndex(function (h) {
      return h === candidate || h.indexOf(candidate) !== -1;
    });
    if (idx !== -1) return idx;
  }

  const fallbackIdx = normalizedHeaders.findIndex(function (h) {
    if (h.indexOf("DATE") === -1) return false;
    if (h.indexOf("PAYMENT") !== -1) return false;
    if (h.indexOf("PAYOUT") !== -1) return false;
    if (h.indexOf("BOOKING DATE") !== -1) return false;
    if (h.indexOf("CREATED") !== -1) return false;
    if (h.indexOf("ISSUE") !== -1) return false;
    if (h.indexOf("INVOICE") !== -1) return false;
    if (h.indexOf("TRANSFER") !== -1) return false;
    return true;
  });

  return fallbackIdx;
}

function sortBookings(items: ReconciledBookingItem[]) {
  return [...items].sort(function (a, b) {
    const dateA = a.booking_date || "";
    const dateB = b.booking_date || "";

    if (dateA !== dateB) {
      return dateA.localeCompare(dateB);
    }

    return a.booking_reference.localeCompare(b.booking_reference);
  });
}

function sortNotFoundItems(items: NotFoundReferenceItem[]) {
  return [...items].sort(function (a, b) {
    if (a.booking_date !== b.booking_date) {
      return a.booking_date.localeCompare(b.booking_date);
    }
    return a.booking_reference.localeCompare(b.booking_reference);
  });
}

function BookingResultList({
  title,
  subtitle,
  items,
  color,
}: {
  title: string;
  subtitle: string;
  items: ReconciledBookingItem[];
  color: "green" | "zinc";
}) {
  const styles =
    color === "green"
      ? {
          wrapper: "border-green-200 bg-green-50",
          title: "text-green-900",
          subtitle: "text-green-700",
          itemBorder: "divide-green-100 border-green-100",
          ref: "text-green-900",
          meta: "text-green-800",
          empty: "text-green-700",
        }
      : {
          wrapper: "border-zinc-200 bg-zinc-50",
          title: "text-zinc-900",
          subtitle: "text-zinc-600",
          itemBorder: "divide-zinc-100 border-zinc-200",
          ref: "text-zinc-900",
          meta: "text-zinc-700",
          empty: "text-zinc-600",
        };

  return (
    <div className={`mt-6 rounded-2xl border p-4 ${styles.wrapper}`}>
      <div className="mb-3">
        <h5 className={`text-sm font-bold ${styles.title}`}>{title}</h5>
        <p className={`mt-1 text-xs ${styles.subtitle}`}>{subtitle}</p>
      </div>

      {items.length === 0 ? (
        <div className={`rounded-xl bg-white px-4 py-3 text-sm ${styles.empty}`}>
          Nessuna prenotazione in questo gruppo.
        </div>
      ) : (
        <div
          className={`max-h-80 overflow-auto rounded-xl border bg-white ${styles.itemBorder}`}
        >
          <ul className="divide-y">
            {sortBookings(items).map((booking) => (
              <li
                key={`${booking.id}-${booking.booking_reference}`}
                className="px-4 py-3"
              >
                <div className={`text-sm font-bold ${styles.ref}`}>
                  {booking.booking_reference}
                </div>

                <div className={`mt-1 text-sm ${styles.meta}`}>
                  {booking.customer_name || "Cliente non disponibile"}
                </div>

                <div className={`mt-1 text-xs ${styles.meta}`}>
                  {formatDateIt(booking.booking_date)} ·{" "}
                  {booking.experience_name || "Esperienza non disponibile"}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function ReconcilePage() {
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [status, setStatus] = useState<ReconcileStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [extractedItems, setExtractedItems] = useState<ExtractedReferenceItem[]>([]);
  const [fileType, setFileType] = useState<string>("");
  const [fileName, setFileName] = useState<string>("");
  const [referenceMonth, setReferenceMonth] = useState<string>("");
  const [referenceStartDate, setReferenceStartDate] = useState<string>("");
  const [referenceEndDate, setReferenceEndDate] = useState<string>("");
  const [importHistory, setImportHistory] = useState<ImportHistoryItem[]>([]);

  const refreshImportHistory = async () => {
    setHistoryLoading(true);
    setHistoryError(null);

    try {
      const items = await getPaymentReconciliationImportHistory();
      setImportHistory(items);
    } catch (err: any) {
      setHistoryError(`Errore caricamento storico: ${err.message}`);
    }

    setHistoryLoading(false);
  };

  useEffect(function () {
    refreshImportHistory();
  }, []);

  const notFoundDates = useMemo(function () {
    if (!status) return [];

    return Array.from(
      new Set(
        status.notFoundItems
          .map(function (item) {
            return item.booking_date;
          })
          .filter(function (date) {
            return isValidYmdDate(date);
          })
      )
    ).sort();
  }, [status]);

  const notFoundDatesHref = useMemo(function () {
    if (notFoundDates.length === 0) return "/prenotazioni";
    return `/prenotazioni?dates=${encodeURIComponent(notFoundDates.join(","))}`;
  }, [notFoundDates]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    setStatus(null);
    setExtractedItems([]);
    setFileType("");
    setFileName("");
    setReferenceMonth("");
    setReferenceStartDate("");
    setReferenceEndDate("");

    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);

    const reader = new FileReader();

    reader.onload = (event) => {
      try {
        const result = event.target?.result;
        if (!result) {
          setError("Impossibile leggere il file.");
          return;
        }

        const data = new Uint8Array(result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];

        const rows: any[][] = XLSX.utils.sheet_to_json(worksheet, {
          header: 1,
          defval: "",
        });

        let isViator = false;
        let isGYG = false;
        let headerRowIdx = -1;

        for (let i = 0; i < rows.length; i++) {
          const rowStr = rows[i].join(" ").toUpperCase();

          if (rowStr.indexOf("VIATOR REFERENCE") !== -1) {
            isViator = true;
            headerRowIdx = i;
            break;
          }

          if (
            rowStr.indexOf("BOOKING REF #") !== -1 ||
            rowStr.indexOf("BOOKING REF") !== -1
          ) {
            isGYG = true;
            headerRowIdx = i;
            break;
          }
        }

        if (headerRowIdx === -1) {
          setError(
            "Formato non riconosciuto. Assicurati che sia un file pagamenti di Viator o GetYourGuide."
          );
          return;
        }

        const headers = rows[headerRowIdx]
          .map(String)
          .map(function (h) {
            return normalizeHeader(h);
          });

        const dateIdx = findDateColumnIndex(headers);

        if (dateIdx === -1) {
          setError(
            "Colonna data esperienza non trovata nel file. Impossibile filtrare la spazzatura e collegare le date alle prenotazioni non trovate."
          );
          return;
        }

        const itemMap = new Map<string, ExtractedReferenceItem>();

        if (isViator) {
          setFileType("Viator");

          const vRefIdx = headers.indexOf("VIATOR REFERENCE");

          if (vRefIdx === -1) {
            setError("Colonna 'VIATOR REFERENCE' non trovata nel file.");
            return;
          }

          for (let i = headerRowIdx + 1; i < rows.length; i++) {
            const rawRef = rows[i][vRefIdx];
            const rawDate = rows[i][dateIdx];

            if (!isLikelyBookingReference(rawRef)) continue;

            const booking_reference = normalizeBookingReference(rawRef);
            const normalizedDate = normalizeDateToYmd(rawDate);

            if (!normalizedDate) continue;
            if (!isValidYmdDate(normalizedDate)) continue;

            if (!itemMap.has(booking_reference)) {
              itemMap.set(booking_reference, {
                booking_reference,
                booking_date: normalizedDate,
              });
            }
          }
        } else if (isGYG) {
          setFileType("GetYourGuide");

          const gRefIdx = headers.findIndex(function (h) {
            return h.indexOf("BOOKING REF") !== -1;
          });

          if (gRefIdx === -1) {
            setError("Colonna 'BOOKING REF' non trovata nel file.");
            return;
          }

          for (let i = headerRowIdx + 1; i < rows.length; i++) {
            const rawRef = rows[i][gRefIdx];
            const rawDate = rows[i][dateIdx];

            if (!isLikelyBookingReference(rawRef)) continue;

            const booking_reference = normalizeBookingReference(rawRef);
            const normalizedDate = normalizeDateToYmd(rawDate);

            if (!normalizedDate) continue;
            if (!isValidYmdDate(normalizedDate)) continue;

            if (!itemMap.has(booking_reference)) {
              itemMap.set(booking_reference, {
                booking_reference,
                booking_date: normalizedDate,
              });
            }
          }
        }

        const finalItems = Array.from(itemMap.values()).sort(function (a, b) {
          if (a.booking_date !== b.booking_date) {
            return a.booking_date.localeCompare(b.booking_date);
          }
          return a.booking_reference.localeCompare(b.booking_reference);
        });

        if (finalItems.length === 0) {
          setError(
            "Nessun codice di prenotazione valido con data esperienza trovata nel file."
          );
          return;
        }

        const referencePeriod = inferReferencePeriod(finalItems);
        setReferenceMonth(inferReferenceMonth(finalItems, rows, file.name) || "");
        setReferenceStartDate(referencePeriod.startDate || "");
        setReferenceEndDate(referencePeriod.endDate || "");
        setExtractedItems(finalItems);
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
      const result = await reconcilePayments(extractedItems, {
        file_name: fileName || null,
        file_type: fileType || null,
        reference_month: referenceMonth || null,
        reference_start_date: referenceStartDate || null,
        reference_end_date: referenceEndDate || null,
      });
      setStatus(result);
      await refreshImportHistory();
    } catch (err: any) {
      setError(`Errore: ${err.message}`);
    }

    setLoading(false);
  };

  const resetPage = () => {
    setStatus(null);
    setExtractedItems([]);
    setError(null);
    setFileType("");
    setFileName("");
    setReferenceMonth("");
    setReferenceStartDate("");
    setReferenceEndDate("");
  };

  return (
    <AppShell
      title="Riconciliazione Pagamenti"
      subtitle="Segna le prenotazioni incassate dai file delle OTA"
    >
      <div className="max-w-4xl space-y-6 pb-10">
        <SectionCard title="1. Carica la Fattura/Report Pagamenti">
          <p className="mb-4 text-sm text-zinc-500">
            Carica il file Excel o CSV scaricato dal portale pagamenti di Viator
            o GetYourGuide. Il sistema ignorerà le righe inutili e cercherà in
            automatico i codici.
          </p>

          <input
            type="file"
            accept=".xlsx, .xls, .csv"
            onChange={handleFileUpload}
            className="block w-full cursor-pointer text-sm text-zinc-500 file:mr-4 file:rounded-xl file:border-0 file:bg-zinc-900 file:px-4 file:py-2.5 file:text-sm file:font-bold file:text-white hover:file:bg-zinc-700"
          />

          {error && (
            <p className="mt-4 rounded-lg border border-red-100 bg-red-50 p-3 text-sm font-bold text-red-600">
              {error}
            </p>
          )}
        </SectionCard>

        {extractedItems.length > 0 && !status && (
          <SectionCard title="2. Conferma e Riconcilia">
            <div className="mb-6 flex items-center gap-4 rounded-xl border border-blue-100 bg-blue-50 p-4">
              <div className="flex-1">
                <p className="text-sm font-bold text-blue-900">
                  File riconosciuto: {fileType}
                </p>
                <p className="mt-1 text-xs text-blue-700">
                  Trovati <strong>{extractedItems.length}</strong> codici
                  riferimento validi con data esperienza da controllare.
                </p>
                <p className="mt-1 text-xs font-bold text-blue-800">
                  Periodo nel file:{" "}
                  {formatReferencePeriod(
                    referenceStartDate || null,
                    referenceEndDate || null,
                    referenceMonth || null
                  )}
                </p>
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
            <h4 className="mb-4 text-lg font-bold text-zinc-900">
              Risultato Riconciliazione
            </h4>

            <div className="grid grid-cols-1 gap-4 text-center sm:grid-cols-3">
              <div className="rounded-xl border border-green-100 bg-green-50 p-4">
                <p className="text-[10px] font-bold uppercase text-green-600">
                  Aggiornate a Incassate
                </p>
                <p className="mt-1 text-3xl font-black text-green-700">
                  {status.updated}
                </p>
              </div>

              <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-4">
                <p className="text-[10px] font-bold uppercase text-zinc-500">
                  Già Incassate (Ignorate)
                </p>
                <p className="mt-1 text-3xl font-black text-zinc-700">
                  {status.alreadyPaid}
                </p>
              </div>

              <div className="rounded-xl border border-amber-100 bg-amber-50 p-4">
                <p className="text-[10px] font-bold uppercase text-amber-600">
                  Non trovate nel DB
                </p>
                <p className="mt-1 text-3xl font-black text-amber-700">
                  {status.notFound}
                </p>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-zinc-100 bg-zinc-50 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">
                Riepilogo tecnico
              </p>
              <div className="mt-2 grid grid-cols-1 gap-3 text-sm text-zinc-700 sm:grid-cols-3">
                <div>
                  Codici validi letti:{" "}
                  <strong className="text-zinc-900">{status.parsed}</strong>
                </div>
                <div>
                  Prenotazioni trovate nel DB:{" "}
                  <strong className="text-zinc-900">{status.foundInDb}</strong>
                </div>
                <div>
                  Prenotazioni non trovate:{" "}
                  <strong className="text-zinc-900">{status.notFound}</strong>
                </div>
              </div>
            </div>

            <BookingResultList
              title="Prenotazioni aggiornate a incassate"
              subtitle="Queste sono le prenotazioni che erano nel file e sono state appena segnate come pagate."
              items={status.updatedBookings}
              color="green"
            />

            <BookingResultList
              title="Prenotazioni già incassate"
              subtitle="Queste prenotazioni erano presenti nel file ma nel database risultavano già pagate."
              items={status.alreadyPaidBookings}
              color="zinc"
            />

            {status.notFoundItems.length > 0 && (
              <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h5 className="text-sm font-bold text-amber-900">
                      Codici non trovati nel database
                    </h5>
                    <p className="mt-1 text-xs text-amber-700">
                      Questi codici erano nel file caricato ma non esistono nella
                      tabella prenotazioni.
                    </p>
                  </div>

                  {notFoundDates.length > 0 && (
                    <Link
                      href={notFoundDatesHref}
                      className="inline-flex items-center justify-center rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-amber-700"
                    >
                      Apri prenotazioni sulle date dei non trovati
                    </Link>
                  )}
                </div>

                <div className="mb-3 rounded-xl border border-amber-100 bg-white px-4 py-3 text-xs text-amber-800">
                  Date coinvolte:{" "}
                  <strong>
                    {notFoundDates.length > 0
                      ? notFoundDates.map((d) => formatDateIt(d)).join(", ")
                      : "non disponibili"}
                  </strong>
                </div>

                <div className="max-h-72 overflow-auto rounded-xl border border-amber-100 bg-white">
                  <ul className="divide-y divide-amber-100">
                    {sortNotFoundItems(status.notFoundItems).map((item) => (
                      <li
                        key={`${item.booking_reference}-${item.booking_date}`}
                        className="px-4 py-3"
                      >
                        <div className="font-mono text-sm font-bold text-amber-900">
                          {item.booking_reference}
                        </div>
                        <div className="mt-1 text-xs text-amber-800">
                          Data esperienza: {formatDateIt(item.booking_date)}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            <div className="mt-6 flex gap-3 border-t border-zinc-100 pt-6">
              <button
                onClick={resetPage}
                className="flex-1 rounded-xl border-2 border-zinc-200 py-4 font-bold text-zinc-700 transition hover:bg-zinc-50"
              >
                Carica altro file
              </button>

              <Link
                href="/prenotazioni"
                className="flex-1 rounded-xl bg-zinc-900 py-4 text-center font-bold text-white shadow-md hover:bg-zinc-700"
              >
                Torna all&apos;elenco
              </Link>
            </div>
          </div>
        )}

        <SectionCard title={`Storico file riconciliazione (${importHistory.length})`}>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-zinc-500">
              Ultimi file Viator/GetYourGuide caricati per segnare le prenotazioni
              come incassate.
            </p>

            <button
              type="button"
              onClick={refreshImportHistory}
              disabled={historyLoading}
              className="inline-flex items-center justify-center rounded-xl border border-zinc-300 bg-white px-4 py-2.5 text-sm font-bold text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {historyLoading ? "Aggiorno..." : "Aggiorna storico"}
            </button>
          </div>

          {historyError && (
            <p className="mb-4 rounded-lg border border-red-100 bg-red-50 p-3 text-sm font-bold text-red-600">
              {historyError}
            </p>
          )}

          {historyLoading && importHistory.length === 0 ? (
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-6 text-center text-sm text-zinc-500">
              Caricamento storico...
            </div>
          ) : importHistory.length === 0 ? (
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-6 text-center text-sm text-zinc-500">
              Ancora nessun file di riconciliazione salvato.
            </div>
          ) : (
            <div className="max-h-[520px] overflow-auto rounded-xl border border-zinc-200 bg-white">
              <ul className="divide-y divide-zinc-100">
                {importHistory.map((item) => {
                  const created = formatDateTimeIt(item.created_at);

                  return (
                    <li
                      key={item.id}
                      className="grid gap-3 px-4 py-4 sm:grid-cols-[180px_1fr_auto] sm:items-center"
                    >
                      <div>
                        <div className="font-bold text-zinc-900">
                          {created.date}
                        </div>
                        <div className="mt-0.5 text-xs text-zinc-500">
                          {created.time}
                        </div>
                      </div>

                      <div className="min-w-0">
                        <div className="truncate text-sm font-bold text-zinc-900">
                          {item.file_name || "Nome file non salvato"}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-2 text-xs text-zinc-500">
                          <span className="rounded bg-zinc-100 px-2 py-0.5 font-bold text-zinc-700">
                            {item.file_type || "Tipo non riconosciuto"}
                          </span>
                          <span className="rounded bg-blue-50 px-2 py-0.5 font-bold text-blue-700">
                            {formatReferencePeriod(
                              item.reference_start_date,
                              item.reference_end_date,
                              item.reference_month
                            )}
                          </span>
                          <span>{item.parsed} codici letti</span>
                          <span>{item.found_in_db} trovate nel DB</span>
                        </div>
                      </div>

                      <div className="flex flex-wrap justify-start gap-3 text-xs font-bold sm:justify-end">
                        <span className="text-green-700">
                          +{item.updated} incassate
                        </span>
                        <span className="text-zinc-600">
                          {item.already_paid} gia incassate
                        </span>
                        <span className="text-amber-600">
                          {item.not_found} non trovate
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </SectionCard>
      </div>
    </AppShell>
  );
}
