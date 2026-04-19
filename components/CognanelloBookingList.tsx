"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type BookingItem = {
  id: number;
  booking_reference: string | null;
  booking_date: string | null;
  booking_time: string | null;
  booking_created_at: string | null;
  customer_name: string | null;
  adults: number | null;
  children: number | null;
  infants: number | null;
  channel_name: string;
  experience_name: string;
};

type Props = {
  bookings: BookingItem[];
  today: string;
  tomorrow: string;
};

function formatDateIt(value: string | null) {
  if (!value) return "—";
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);

  return new Intl.DateTimeFormat("it-IT", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(dt);
}

function formatTime(value: string | null) {
  if (!value) return "—";
  return value.slice(0, 5);
}

function formatCreatedAt(value: string | null) {
  if (!value) return "—";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "—";

  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(dt);
}

function peopleLabel(row: BookingItem) {
  const adults = Number(row.adults || 0);
  const children = Number(row.children || 0);
  const infants = Number(row.infants || 0);
  const total = adults + children + infants;

  const parts: string[] = [];
  if (adults) parts.push(`${adults} adulti`);
  if (children) parts.push(`${children} bambini`);
  if (infants) parts.push(`${infants} infanti`);

  if (parts.length === 0) return "0 persone";
  return `${total} persone · ${parts.join(" · ")}`;
}

function getDateClass(bookingDate: string | null, today: string, tomorrow: string) {
  if (!bookingDate) return "text-zinc-900";
  if (bookingDate === today) return "text-green-700";
  if (bookingDate === tomorrow) return "text-amber-600";
  return "text-zinc-900";
}

export default function CognanelloBookingList({
  bookings,
  today,
  tomorrow,
}: Props) {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const visibleIds = useMemo(() => bookings.map((b) => b.id), [bookings]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const toggleOne = (id: number) => {
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id]
    );
  };

  const selectVisible = () => {
    setSelectedIds(visibleIds);
  };

  const clearSelected = () => {
    setSelectedIds([]);
  };

  const openSummary = () => {
    if (selectedIds.length === 0) return;
    router.push(`/prenotazioni/riepilogo?ids=${selectedIds.join(",")}`);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <h2 className="text-2xl font-extrabold tracking-tight text-zinc-900">
          Elenco Prenotazioni ({bookings.length})
        </h2>

        <div className="mt-4 rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-lg font-bold text-zinc-900">
                Prenotazioni selezionate: {selectedIds.length}
              </div>
              <div className="text-sm text-zinc-500">
                Seleziona le righe e poi apri il riepilogo.
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={selectVisible}
                disabled={bookings.length === 0}
                className="inline-flex items-center justify-center rounded-2xl border border-zinc-300 bg-white px-4 py-3 text-sm font-bold text-zinc-800 shadow-sm transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Seleziona visibili
              </button>

              <button
                type="button"
                onClick={clearSelected}
                disabled={selectedIds.length === 0}
                className="inline-flex items-center justify-center rounded-2xl border border-zinc-300 bg-zinc-100 px-4 py-3 text-sm font-bold text-zinc-500 shadow-sm transition disabled:cursor-not-allowed disabled:opacity-70"
              >
                Annulla selezionati
              </button>

              <button
                type="button"
                onClick={openSummary}
                disabled={selectedIds.length === 0}
                className="inline-flex items-center justify-center rounded-2xl bg-zinc-700 px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
              >
                Apri riepilogo
              </button>
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-700">
          Seleziona le prenotazioni con la spunta e poi apri il riepilogo per
          stampare il PDF o inviarlo via WhatsApp.
        </div>
      </div>

      {bookings.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-500">
          Nessuna prenotazione trovata con questi filtri.
        </div>
      ) : (
        <div className="space-y-3">
          {bookings.map((row) => {
            const isSelected = selectedSet.has(row.id);
            const dateClass = getDateClass(row.booking_date, today, tomorrow);

            return (
              <article
                key={row.id}
                className={`rounded-2xl border bg-white p-4 shadow-sm transition ${
                  isSelected
                    ? "border-zinc-900 ring-1 ring-zinc-900/10"
                    : "border-zinc-200"
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="pt-1">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleOne(row.id)}
                      className="h-5 w-5 rounded border-zinc-300"
                    />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className={`text-base font-extrabold ${dateClass}`}>
                      {formatDateIt(row.booking_date)} ·{" "}
                      <span className="inline-flex rounded-md bg-blue-50 px-2 py-0.5 text-sm font-bold text-blue-700">
                        {formatTime(row.booking_time)}
                      </span>
                    </div>

                    <div className="mt-1 text-xs text-zinc-500">
                      Rif. {row.booking_reference || "—"}
                    </div>

                    <div className="mt-4">
                      <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                        Cliente
                      </div>
                      <div className="text-base font-bold text-zinc-900">
                        {row.customer_name || "—"}
                      </div>
                    </div>

                    <div className="mt-4">
                      <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                        Canale / Esperienza
                      </div>
                      <div className="mt-1 flex flex-wrap gap-2">
                        <span className="inline-flex rounded-md border border-zinc-300 bg-zinc-50 px-2 py-1 text-xs font-semibold text-zinc-700">
                          {row.channel_name}
                        </span>
                        <span className="inline-flex rounded-md border border-violet-200 bg-violet-50 px-2 py-1 text-xs font-semibold text-violet-700">
                          {row.experience_name}
                        </span>
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                          Persone
                        </div>
                        <div className="text-sm font-semibold text-zinc-800">
                          {peopleLabel(row)}
                        </div>
                      </div>

                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                          Prenotazione creata il
                        </div>
                        <div className="text-sm font-semibold text-zinc-800">
                          {formatCreatedAt(row.booking_created_at)}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}