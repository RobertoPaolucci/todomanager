import { getBookingDisplayNotes } from "./booking-display-notes";

export type FattoriaPrintEntry = {
  id: number;
  date: string;
  service: string;
  people: string;
  detail: string;
  customer: string;
  channel: string;
  notes: string | null;
};

export function formatPrintDate(date: string) {
  return date.split("-").reverse().join("/");
}

export function togglePrintSelection(selected: number[], entry: FattoriaPrintEntry, entries: FattoriaPrintEntry[]) {
  if (selected.includes(entry.id)) return selected.filter(id => id !== entry.id);
  const first = entries.find(item => selected.includes(item.id));
  if (first && first.date !== entry.date) return selected;
  return [...selected, entry.id];
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]!);

export function buildFattoriaPrintDocument(entries: FattoriaPrintEntry[], selected: number[]) {
  const rows = entries.filter(entry => selected.includes(entry.id));
  if (!rows.length || rows.some(row => row.date !== rows[0].date)) return null;
  const date = escapeHtml(formatPrintDate(rows[0].date));
  const bookings = rows.map(row => {
    const names = [...new Set([row.customer.trim(), row.channel.trim()].filter(Boolean))];
    const notes = getBookingDisplayNotes(row.notes).trim();
    return `<article><h2>${escapeHtml(row.people)} · ${escapeHtml(row.service)}</h2>${row.detail ? `<p>${escapeHtml(row.detail)}</p>` : ""}${names.map(name => `<p>${escapeHtml(name)}</p>`).join("")}${notes ? `<p class="notes">${escapeHtml(notes)}</p>` : ""}</article>`;
  }).join("");
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>Fattoria ${date}</title><style>
    @page { size: A4 portrait; margin: 15mm; }
    body { font: 14pt/1.4 Arial, sans-serif; color: #000; background: #fff; margin: 0; }
    h1 { font-size: 24pt; margin: 0 0 10mm; }
    article { margin-bottom: 8mm; break-inside: avoid; page-break-inside: avoid; overflow-wrap: anywhere; }
    h2 { font-size: 16pt; margin: 0 0 2mm; }
    p { margin: 1mm 0; white-space: pre-wrap; }
    @media print { html, body { width: auto; height: auto; overflow: visible; } article { break-inside: avoid; } }
  </style></head><body><h1>${date}</h1>${bookings}</body></html>`;
}
