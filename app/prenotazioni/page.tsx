import Link from "next/link";
import AppShell from "@/components/AppShell";
import SectionCard from "@/components/SectionCard";
import { supabase } from "@/lib/supabase";
import { cancelBooking } from "./actions";

type PageProps = {
  searchParams?: Promise<{
    q?: string;
    sort?: string;
    dir?: string;
    showPast?: string;
  }>;
};

type BookingRow = {
  id: number;
  supplier_id: number | null;
  booking_source: string | null;
  booking_reference: string | null;
  booking_created_at: string | null;
  customer_name: string | null;
  experience_name: string | null;
  booking_date: string | null;
  booking_time: string | null;
  total_people: number | null;
  pax: number | null;
  total_customer: number | null;
  total_to_you: number | null;
  total_supplier_cost: number | null;
  margin_total: number | null;
  is_cancelled: boolean | null;
  customer_email: string | null;
  customer_phone: string | null;
  notes: string | null;
};

type SupplierRow = {
  id: number;
  phone: string | null;
};

function formatEuro(value: number | null) {
  return new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function formatDate(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function formatWhatsappTime(value: string | null) {
  if (!value) return "";
  return value.replace(":", ",");
}

function normalizePhoneForWhatsApp(value: string | null) {
  if (!value) return "";
  return value.replace(/[^\d]/g, "");
}

function buildWhatsappLink(
  booking: BookingRow,
  supplierPhoneById: Record<number, string>
) {
  const supplierId = Number(booking.supplier_id || 0);
  if (!supplierId) return null;
  const rawPhone = supplierPhoneById[supplierId];
  if (!rawPhone) return null;
  const phone = normalizePhoneForWhatsApp(rawPhone);
  if (!phone) return null;

  const people = booking.total_people ?? booking.pax ?? 0;
  const formattedDate = formatDate(booking.booking_date || null);
  const formattedTime = formatWhatsappTime(booking.booking_time || null);
  const source = booking.booking_source || "-";
  const reference = booking.booking_reference || "-";
  const experienceName = booking.experience_name || "-";
  const customerName = booking.customer_name || "-";

  const message = `${people} persone
${formattedDate}${formattedTime ? ` ore ${formattedTime}` : ""}
${experienceName}

Canale: ${source}
Ref: ${reference}
Cliente: ${customerName}`;

  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

function getNextDir(currentSort: string, currentDir: string, column: string) {
  if (currentSort === column) {
    return currentDir === "asc" ? "desc" : "asc";
  }
  return "asc";
}

function SortLink({
  label,
  column,
  currentSort,
  currentDir,
  q,
  showPast,
}: {
  label: string;
  column: string;
  currentSort: string;
  currentDir: string;
  q: string;
  showPast: boolean;
}) {
  const nextDir = getNextDir(currentSort, currentDir, column);
  const arrow = currentSort === column ? (currentDir === "asc" ? " ↑" : " ↓") : "";

  return (
    <Link
      href={`/prenotazioni?sort=${column}&dir=${nextDir}&q=${encodeURIComponent(q)}&showPast=${showPast ? "1" : "0"}`}
      className="transition hover:text-zinc-900"
    >
      {label}
      {arrow}
    </Link>
  );
}

export default async function PrenotazioniPage({ searchParams }: PageProps) {
  const params = (await searchParams) || {};
  const q = params.q?.trim() || "";
  const sort = params.sort || "booking_date";
  const dir = params.dir === "desc" ? "desc" : "asc";
  const showPast = params.showPast === "1";

  const sortableColumns = [
    "booking_source",
    "booking_created_at",
    "customer_name",
    "experience_name",
    "booking_date",
    "booking_time",
    "total_people",
  ];

  const sortColumn = sortableColumns.includes(sort) ? sort : "booking_date";
  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];

  let bookingsQuery = supabase
    .from("bookings")
    .select("*")
    .order(sortColumn, { ascending: dir === "asc", nullsFirst: false });

  if (!showPast) {
    bookingsQuery = bookingsQuery.gte("booking_date", todayStr);
  }

  if (q) {
    const safeQ = q.replace(/,/g, " ").replace(/\./g, " ").trim();
    bookingsQuery = bookingsQuery.or(
      [
        `booking_source.ilike.%${safeQ}%`,
        `booking_reference.ilike.%${safeQ}%`,
        `customer_name.ilike.%${safeQ}%`,
        `experience_name.ilike.%${safeQ}%`,
        `customer_email.ilike.%${safeQ}%`,
        `customer_phone.ilike.%${safeQ}%`,
        `notes.ilike.%${safeQ}%`,
      ].join(",")
    );
  }

  const [bookingsRes, suppliersRes] = await Promise.all([
    bookingsQuery,
    supabase.from("suppliers").select("id, phone").order("id", { ascending: true }),
  ]);

  const bookings = (bookingsRes.data || []) as BookingRow[];
  const suppliers = (suppliersRes.data || []) as SupplierRow[];
  const error = bookingsRes.error || suppliersRes.error;

  const supplierPhoneById: Record<number, string> = {};
  for (const supplier of suppliers) {
    if (supplier.id && supplier.phone) {
      supplierPhoneById[supplier.id] = supplier.phone;
    }
  }

  return (
    <AppShell title="Prenotazioni" subtitle="Elenco prenotazioni e stato pagamenti">
      {/* HEADER: RICERCA E BOTTONE NUOVA PRENOTAZIONE (REDACT RESPONSIVE) */}
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <form action="/prenotazioni" method="get" className="flex flex-1 items-center gap-2">
            <input type="hidden" name="sort" value={sortColumn} />
            <input type="hidden" name="dir" value={dir} />
            <input type="hidden" name="showPast" value={showPast ? "1" : "0"} />
            <input
              name="q"
              defaultValue={q}
              placeholder="Cerca..."
              className="w-full sm:w-[300px] lg:w-[360px] rounded-xl border border-zinc-300 px-4 py-3 text-sm outline-none transition focus:border-zinc-500"
            />
            <button
              type="submit"
              className="rounded-xl border border-zinc-300 px-4 py-3 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100"
            >
              Cerca
            </button>
          </form>

          <div className="flex gap-2">
            <Link
              href={`/prenotazioni?sort=${sortColumn}&dir=${dir}&q=${encodeURIComponent(q)}&showPast=${showPast ? "0" : "1"}`}
              className={`flex-1 sm:flex-none text-center rounded-xl border px-4 py-3 text-sm font-medium transition ${
                showPast
                  ? "border-purple-300 bg-purple-50 text-purple-700 hover:bg-purple-100"
                  : "border-zinc-300 text-zinc-700 hover:bg-zinc-100"
              }`}
            >
              {showPast ? "Nascondi" : "Passate"}
            </Link>

            {(q || showPast) ? (
              <Link
                href="/prenotazioni"
                className="flex-1 sm:flex-none text-center rounded-xl border border-zinc-300 px-4 py-3 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100"
              >
                Reset
              </Link>
            ) : null}
          </div>
        </div>

        <Link
          href="/prenotazioni/nuova"
          className="rounded-xl bg-zinc-900 px-4 py-3 text-center text-sm font-medium text-white transition hover:bg-zinc-700"
        >
          + Nuova prenotazione
        </Link>
      </div>

      <SectionCard title="Lista prenotazioni">
        {error ? (
          <p className="text-sm text-red-600">Errore: {error.message}</p>
        ) : bookings.length === 0 ? (
          <p className="text-sm text-zinc-600">Nessuna prenotazione trovata.</p>
        ) : (
          <>
            {/* --- VERSIONE MOBILE (VISIBILE SOLO SU SCHERMI PICCOLI) --- */}
            <div className="grid grid-cols-1 gap-4 lg:hidden">
              {bookings.map((booking) => {
                const isCancelled = booking.is_cancelled === true;
                const isToday = booking.booking_date === todayStr;
                const isPast = !!booking.booking_date && booking.booking_date < todayStr;
                const waLink = buildWhatsappLink(booking, supplierPhoneById);

                return (
                  <div key={booking.id} className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
                    <div className="mb-3 flex items-start justify-between">
                      <div className="flex flex-col">
                        <span className="text-[10px] font-bold uppercase text-zinc-400">ID #{booking.id}</span>
                        <span className="font-bold text-zinc-900">{booking.customer_name}</span>
                      </div>
                      <div className={`rounded-lg px-2 py-1 text-xs font-bold ${
                        isToday ? "bg-lime-200 text-lime-900" : isPast ? "bg-yellow-100 text-yellow-800" : "bg-zinc-100 text-zinc-600"
                      }`}>
                        {formatDate(booking.booking_date)}
                      </div>
                    </div>

                    <div className="mb-3">
                      <p className="text-sm font-medium text-zinc-700">{booking.experience_name}</p>
                      <div className="mt-1 flex gap-2 text-xs text-zinc-500">
                        <span>{booking.booking_time || "--:--"}</span>
                        <span>•</span>
                        <span>{booking.total_people ?? booking.pax} persone</span>
                        <span>•</span>
                        <span className="font-semibold text-zinc-900">{booking.booking_source}</span>
                      </div>
                      {isCancelled && (
                        <span className="mt-2 inline-block rounded bg-red-100 px-2 py-0.5 text-[10px] font-bold uppercase text-red-700">
                          Cancellata
                        </span>
                      )}
                    </div>

                    <div className="flex items-center justify-between border-t border-zinc-100 pt-3">
                      <div className="flex flex-col">
                        <span className="text-[10px] uppercase text-zinc-400">Margine</span>
                        <span className="text-sm font-bold text-zinc-900">{formatEuro(booking.margin_total)}</span>
                      </div>
                      <div className="flex gap-2">
                        {waLink && (
                          <a href={waLink} target="_blank" className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs font-medium text-green-700">
                            WA
                          </a>
                        )}
                        <Link href={`/prenotazioni/${booking.id}/modifica`} className="rounded-lg border border-zinc-300 px-3 py-2 text-xs font-medium text-zinc-700">
                          Modifica
                        </Link>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* --- VERSIONE DESKTOP (TABELLA ORIGINALE - NASCOSTA SU MOBILE) --- */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-zinc-200 text-zinc-500">
                  <tr>
                    <th className="py-3 pr-4">ID</th>
                    <th className="py-3 pr-4"><SortLink label="Canale" column="booking_source" currentSort={sortColumn} currentDir={dir} q={q} showPast={showPast} /></th>
                    <th className="py-3 pr-4">Rif.</th>
                    <th className="py-3 pr-4"><SortLink label="Data pren." column="booking_created_at" currentSort={sortColumn} currentDir={dir} q={q} showPast={showPast} /></th>
                    <th className="py-3 pr-4"><SortLink label="Cliente" column="customer_name" currentSort={sortColumn} currentDir={dir} q={q} showPast={showPast} /></th>
                    <th className="py-3 pr-4"><SortLink label="Esperienza" column="experience_name" currentSort={sortColumn} currentDir={dir} q={q} showPast={showPast} /></th>
                    <th className="py-3 pr-4"><SortLink label="Data" column="booking_date" currentSort={sortColumn} currentDir={dir} q={q} showPast={showPast} /></th>
                    <th className="py-3 pr-4"><SortLink label="Ora" column="booking_time" currentSort={sortColumn} currentDir={dir} q={q} showPast={showPast} /></th>
                    <th className="py-3 pr-4"><SortLink label="Persone" column="total_people" currentSort={sortColumn} currentDir={dir} q={q} showPast={showPast} /></th>
                    <th className="py-3 pr-4">Cliente €</th>
                    <th className="py-3 pr-4">A te €</th>
                    <th className="py-3 pr-4">Fornitore €</th>
                    <th className="py-3 pr-4">Margine €</th>
                    <th className="py-3 pr-4">Azioni</th>
                  </tr>
                </thead>
                <tbody>
                  {bookings.map((booking) => {
                    const isCancelled = booking.is_cancelled === true;
                    const tomorrow = new Date();
                    tomorrow.setDate(today.getDate() + 1);
                    const tomorrowStr = tomorrow.toISOString().split("T")[0];
                    const isToday = booking.booking_date === todayStr;
                    const isTomorrow = booking.booking_date === tomorrowStr;
                    const isPast = !!booking.booking_date && booking.booking_date < todayStr;
                    const waLink = buildWhatsappLink(booking, supplierPhoneById);

                    return (
                      <tr key={booking.id} className="border-b border-zinc-100 transition hover:bg-zinc-50/50">
                        <td className="py-3 pr-4">{booking.id}</td>
                        <td className="py-3 pr-4">{booking.booking_source}</td>
                        <td className="py-3 pr-4 text-xs font-mono">{booking.booking_reference || "-"}</td>
                        <td className="py-3 pr-4">{formatDate(booking.booking_created_at)}</td>
                        <td className="py-3 pr-4 font-medium">{booking.customer_name}</td>
                        <td className="py-3 pr-4">
                          <div className="flex flex-col">
                            <span>{booking.experience_name}</span>
                            {isCancelled && <span className="text-[10px] font-bold uppercase text-red-600">cancellata</span>}
                          </div>
                        </td>
                        <td className="py-3 pr-4">
                          <span className={`rounded px-1.5 py-0.5 font-semibold ${
                            isToday ? "bg-lime-200 text-lime-900" : isTomorrow ? "bg-fuchsia-200 text-fuchsia-900" : isPast ? "bg-yellow-100 text-yellow-800" : ""
                          }`}>
                            {formatDate(booking.booking_date)}
                          </span>
                        </td>
                        <td className="py-3 pr-4">{booking.booking_time || "-"}</td>
                        <td className="py-3 pr-4 text-center">{booking.total_people ?? booking.pax}</td>
                        <td className="py-3 pr-4">{formatEuro(booking.total_customer)}</td>
                        <td className="py-3 pr-4">{formatEuro(booking.total_to_you)}</td>
                        <td className="py-3 pr-4">{formatEuro(booking.total_supplier_cost)}</td>
                        <td className="py-3 pr-4 font-bold text-zinc-900">{formatEuro(booking.margin_total)}</td>
                        <td className="py-3 pr-4">
                          <div className="flex gap-2">
                            {waLink && (
                              <a href={waLink} target="_blank" className="rounded-lg border border-green-200 px-3 py-2 text-xs font-medium text-green-700 hover:bg-green-50">
                                WA
                              </a>
                            )}
                            <Link href={`/prenotazioni/${booking.id}/modifica`} className="rounded-lg border border-zinc-300 px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-100">
                              Modifica
                            </Link>
                            {!isCancelled && (
                              <form action={cancelBooking}>
                                <input type="hidden" name="id" value={booking.id} />
                                <button type="submit" className="rounded-lg border border-red-200 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50">
                                  Cancella
                                </button>
                              </form>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </SectionCard>
    </AppShell>
  );
}