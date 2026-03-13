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
  const arrow =
    currentSort === column ? (currentDir === "asc" ? " ↑" : " ↓") : "";

  return (
    <Link
      href={`/prenotazioni?sort=${column}&dir=${nextDir}&q=${encodeURIComponent(
        q
      )}&showPast=${showPast ? "1" : "0"}`}
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

  let query = supabase
    .from("bookings")
    .select("*")
    .order(sortColumn, { ascending: dir === "asc", nullsFirst: false });

  if (!showPast) {
    query = query.gte("booking_date", todayStr);
  }

  if (q) {
    const safeQ = q.replace(/,/g, " ").replace(/\./g, " ").trim();

    query = query.or(
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

  const { data: bookings, error } = await query;

  return (
    <AppShell
      title="Prenotazioni"
      subtitle="Elenco prenotazioni e stato pagamenti"
    >
      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <form action="/prenotazioni" method="get" className="flex items-center gap-2">
            <input type="hidden" name="sort" value={sortColumn} />
            <input type="hidden" name="dir" value={dir} />
            <input type="hidden" name="showPast" value={showPast ? "1" : "0"} />
            <input
              name="q"
              defaultValue={q}
              placeholder="Cerca cliente, esperienza, canale, riferimento..."
              className="w-[360px] rounded-xl border border-zinc-300 px-4 py-3 text-sm outline-none transition focus:border-zinc-500"
            />
            <button
              type="submit"
              className="rounded-xl border border-zinc-300 px-4 py-3 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100"
            >
              Cerca
            </button>
          </form>

          <Link
            href={`/prenotazioni?sort=${sortColumn}&dir=${dir}&q=${encodeURIComponent(
              q
            )}&showPast=${showPast ? "0" : "1"}`}
            className={`rounded-xl border px-4 py-3 text-sm font-medium transition ${
              showPast
                ? "border-purple-300 bg-purple-50 text-purple-700 hover:bg-purple-100"
                : "border-zinc-300 text-zinc-700 hover:bg-zinc-100"
            }`}
          >
            {showPast ? "Nascondi passate" : "Mostra passate"}
          </Link>

          {(q || showPast) ? (
            <Link
              href="/prenotazioni"
              className="rounded-xl border border-zinc-300 px-4 py-3 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100"
            >
              Reset
            </Link>
          ) : null}
        </div>

        <Link
          href="/prenotazioni/nuova"
          className="rounded-xl bg-zinc-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-zinc-700"
        >
          + Nuova prenotazione
        </Link>
      </div>

      <SectionCard title="Lista prenotazioni">
        {error ? (
          <p className="text-sm text-red-600">
            Errore nel caricamento prenotazioni: {error.message}
          </p>
        ) : !bookings || bookings.length === 0 ? (
          <p className="text-sm text-zinc-600">Nessuna prenotazione trovata.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-zinc-200 text-zinc-500">
                <tr>
                  <th className="py-3 pr-4">ID</th>
                  <th className="py-3 pr-4">
                    <SortLink
                      label="Canale"
                      column="booking_source"
                      currentSort={sortColumn}
                      currentDir={dir}
                      q={q}
                      showPast={showPast}
                    />
                  </th>
                  <th className="py-3 pr-4">Rif.</th>
                  <th className="py-3 pr-4">
                    <SortLink
                      label="Data pren."
                      column="booking_created_at"
                      currentSort={sortColumn}
                      currentDir={dir}
                      q={q}
                      showPast={showPast}
                    />
                  </th>
                  <th className="py-3 pr-4">
                    <SortLink
                      label="Cliente"
                      column="customer_name"
                      currentSort={sortColumn}
                      currentDir={dir}
                      q={q}
                      showPast={showPast}
                    />
                  </th>
                  <th className="py-3 pr-4">
                    <SortLink
                      label="Esperienza"
                      column="experience_name"
                      currentSort={sortColumn}
                      currentDir={dir}
                      q={q}
                      showPast={showPast}
                    />
                  </th>
                  <th className="py-3 pr-4">
                    <SortLink
                      label="Data"
                      column="booking_date"
                      currentSort={sortColumn}
                      currentDir={dir}
                      q={q}
                      showPast={showPast}
                    />
                  </th>
                  <th className="py-3 pr-4">
                    <SortLink
                      label="Ora"
                      column="booking_time"
                      currentSort={sortColumn}
                      currentDir={dir}
                      q={q}
                      showPast={showPast}
                    />
                  </th>
                  <th className="py-3 pr-4">
                    <SortLink
                      label="Persone"
                      column="total_people"
                      currentSort={sortColumn}
                      currentDir={dir}
                      q={q}
                      showPast={showPast}
                    />
                  </th>
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
                  const isPast = booking.booking_date < todayStr;

                  return (
                    <tr key={booking.id} className="border-b border-zinc-100">
                      <td className="py-3 pr-4">{booking.id}</td>
                      <td className="py-3 pr-4">{booking.booking_source}</td>
                      <td className="py-3 pr-4">{booking.booking_reference || "-"}</td>
                      <td className="py-3 pr-4">{formatDate(booking.booking_created_at)}</td>
                      <td className="py-3 pr-4">{booking.customer_name}</td>

                      <td className="py-3 pr-4">
                        <div className="flex flex-col gap-1">
                          <span>{booking.experience_name}</span>
                          {isCancelled ? (
                            <span className="inline-block w-fit rounded px-2 py-1 text-xs font-semibold text-red-700">
                              cancellata
                            </span>
                          ) : null}
                        </div>
                      </td>

                      <td className="py-3 pr-4">
                        <span
                          className={`font-semibold ${
                            isToday
                              ? "bg-lime-200 px-1 text-lime-900"
                              : isTomorrow
                              ? "bg-fuchsia-200 px-1 text-fuchsia-900"
                              : isPast
                              ? "bg-yellow-200 px-1 text-yellow-900"
                              : ""
                          }`}
                        >
                          {formatDate(booking.booking_date)}
                        </span>
                      </td>

                      <td className="py-3 pr-4">{booking.booking_time || "-"}</td>
                      <td className="py-3 pr-4">{booking.total_people ?? booking.pax}</td>
                      <td className="py-3 pr-4">{formatEuro(booking.total_customer)}</td>
                      <td className="py-3 pr-4">{formatEuro(booking.total_to_you)}</td>
                      <td className="py-3 pr-4">{formatEuro(booking.total_supplier_cost)}</td>
                      <td className="py-3 pr-4 font-semibold">
                        {formatEuro(booking.margin_total)}
                      </td>

                      <td className="py-3 pr-4">
                        <div className="flex gap-2">
                          <Link
                            href={`/prenotazioni/${booking.id}/modifica`}
                            className="rounded-lg border border-zinc-300 px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
                          >
                            Modifica
                          </Link>

                          {!isCancelled ? (
                            <form action={cancelBooking}>
                              <input type="hidden" name="id" value={booking.id} />
                              <button
                                type="submit"
                                className="rounded-lg border border-red-200 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50"
                              >
                                Cancella
                              </button>
                            </form>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </AppShell>
  );
}