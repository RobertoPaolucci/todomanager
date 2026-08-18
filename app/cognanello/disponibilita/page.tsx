"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

const WHATSAPP_NUMBER = "393493417301";

type AvailabilityRow = {
  availability_date: string;
  morning_open: boolean;
  afternoon_open: boolean;
  updated_at?: string | null;
  updated_by?: string | null;
};

type Booking = {
  id: number;
  booking_reference: string | null;
  booking_date: string;
  booking_time: string | null;
  customer_name: string | null;
  channel_name: string;
  people: number;
};

type ApiData = {
  bookings: Booking[];
  availability: AvailabilityRow[];
};

function dateToString(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function monthToString(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");

  return `${year}-${month}`;
}

function getMonthLabel(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);

  return new Intl.DateTimeFormat("it-IT", {
    month: "long",
    year: "numeric",
  }).format(new Date(year, monthNumber - 1, 1));
}

function formatSelectedDate(dateString: string) {
  const [year, month, day] = dateString.split("-").map(Number);

  return new Intl.DateTimeFormat("it-IT", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
}

function formatWhatsappDate(dateString: string) {
  const [year, month, day] = dateString.split("-");
  return `${day}/${month}/${year}`;
}

function formatTime(value: string | null) {
  if (!value) return "—";

  return value.slice(0, 5);
}

function changeMonth(month: string, offset: number) {
  const [year, monthNumber] = month.split("-").map(Number);

  return monthToString(
    new Date(year, monthNumber - 1 + offset, 1)
  );
}

export default function CognanelloDisponibilitaPage() {
  const today = useMemo(() => dateToString(new Date()), []);

  const [month, setMonth] = useState(() =>
    monthToString(new Date())
  );

  const [selectedDate, setSelectedDate] = useState(today);

  const [bookings, setBookings] = useState<Booking[]>([]);

  const [availability, setAvailability] = useState<
    Record<string, AvailabilityRow>
  >({});

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const loadMonth = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch(
        `/api/cognanello/availability?month=${encodeURIComponent(
          month
        )}`,
        {
          cache: "no-store",
        }
      );

      const data = (await response.json()) as
        | ApiData
        | { error?: string };

      if (!response.ok) {
        throw new Error(
          "error" in data
            ? data.error || "Errore caricamento"
            : "Errore caricamento"
        );
      }

      const apiData = data as ApiData;

      setBookings(apiData.bookings || []);

      const availabilityMap: Record<
        string,
        AvailabilityRow
      > = {};

      for (const row of apiData.availability || []) {
        availabilityMap[row.availability_date] = row;
      }

      setAvailability(availabilityMap);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Errore caricamento"
      );
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    loadMonth();

    const interval = window.setInterval(() => {
      loadMonth();
    }, 60000);

    return () => window.clearInterval(interval);
  }, [loadMonth]);

  useEffect(() => {
    if (selectedDate.startsWith(month)) return;

    if (today.startsWith(month)) {
      setSelectedDate(today);
    } else {
      setSelectedDate(`${month}-01`);
    }
  }, [month, selectedDate, today]);

  const [year, monthNumber] = month.split("-").map(Number);

  const daysInMonth = new Date(
    year,
    monthNumber,
    0
  ).getDate();

  const firstWeekDay =
    (new Date(year, monthNumber - 1, 1).getDay() + 6) % 7;

  const peopleByDate = useMemo(() => {
    const result: Record<string, number> = {};

    for (const booking of bookings) {
      result[booking.booking_date] =
        (result[booking.booking_date] || 0) +
        booking.people;
    }

    return result;
  }, [bookings]);

  const selectedBookings = useMemo(
    () =>
      bookings.filter(
        (booking) => booking.booking_date === selectedDate
      ),
    [bookings, selectedDate]
  );

  const selectedPeople = selectedBookings.reduce(
    (sum, booking) => sum + booking.people,
    0
  );

  const selectedAvailability =
    availability[selectedDate] || {
      availability_date: selectedDate,
      morning_open: true,
      afternoon_open: true,
    };

  async function changeAvailability(
    period: "day" | "morning" | "afternoon",
    action: "open" | "close"
  ) {
    if (saving) return;

    setSaving(true);
    setError("");

    try {
      const response = await fetch(
        "/api/cognanello/availability",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            date: selectedDate,
            period,
            action,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data?.error || "Errore durante il salvataggio"
        );
      }

      const updated =
        data.availability as AvailabilityRow;

      setAvailability((current) => ({
        ...current,
        [selectedDate]: updated,
      }));

      const periodLabel =
        period === "day"
          ? "GIORNATA INTERA"
          : period === "morning"
          ? "MATTINA"
          : "POMERIGGIO";

      const actionLabel =
        action === "close"
          ? "CHIUSURA"
          : "RIAPERTURA";

      const message = [
        formatWhatsappDate(selectedDate),
        `${actionLabel} ${periodLabel}`,
        `Persone già prenotate: ${selectedPeople}`,
        `Prenotazioni: ${selectedBookings.length}`,
      ].join("\n");

      const whatsappUrl =
        `https://wa.me/${WHATSAPP_NUMBER}` +
        `?text=${encodeURIComponent(message)}`;

      window.location.href = whatsappUrl;
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Errore durante il salvataggio"
      );
    } finally {
      setSaving(false);
    }
  }

  const dayAction =
    selectedAvailability.morning_open &&
    selectedAvailability.afternoon_open
      ? "close"
      : "open";

  const morningAction =
    selectedAvailability.morning_open
      ? "close"
      : "open";

  const afternoonAction =
    selectedAvailability.afternoon_open
      ? "close"
      : "open";

  return (
    <main className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-3xl px-3 py-4 sm:px-5">
        <div className="mb-4">
          <Link
            href="/cognanello"
            className="inline-flex rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm font-bold text-zinc-700"
          >
            ← Prenotazioni
          </Link>
        </div>

        {/* CALENDARIO */}
        <div className="rounded-3xl bg-white p-4 shadow-sm sm:p-6">
          <div className="mb-4">
            <h1 className="text-2xl font-extrabold text-zinc-900">
              Disponibilità cavalli
            </h1>

            <p className="mt-1 text-sm text-zinc-600">
              Seleziona un giorno e indica eventuali chiusure o
              riaperture.
            </p>
          </div>

          <div className="mb-4 flex items-center justify-between">
            <button
              type="button"
              onClick={() =>
                setMonth((current) =>
                  changeMonth(current, -1)
                )
              }
              className="flex h-11 w-11 items-center justify-center rounded-2xl border border-zinc-300 bg-white text-2xl font-bold"
            >
              ‹
            </button>

            <h2 className="text-lg font-extrabold capitalize text-zinc-900">
              {getMonthLabel(month)}
            </h2>

            <button
              type="button"
              onClick={() =>
                setMonth((current) =>
                  changeMonth(current, 1)
                )
              }
              className="flex h-11 w-11 items-center justify-center rounded-2xl border border-zinc-300 bg-white text-2xl font-bold"
            >
              ›
            </button>
          </div>

          <div className="mb-2 grid grid-cols-7 gap-1 text-center text-xs font-bold text-zinc-500">
            <div>L</div>
            <div>M</div>
            <div>M</div>
            <div>G</div>
            <div>V</div>
            <div>S</div>
            <div>D</div>
          </div>

          {loading ? (
            <div className="py-16 text-center font-semibold text-zinc-500">
              Caricamento calendario...
            </div>
          ) : (
            <div className="grid grid-cols-7 gap-1">
              {Array.from({
                length: firstWeekDay,
              }).map((_, index) => (
                <div
                  key={`empty-${index}`}
                  className="min-h-[68px]"
                />
              ))}

              {Array.from({
                length: daysInMonth,
              }).map((_, index) => {
                const day = index + 1;

                const date = `${month}-${String(day).padStart(
                  2,
                  "0"
                )}`;

                const current =
                  availability[date] || {
                    availability_date: date,
                    morning_open: true,
                    afternoon_open: true,
                  };

                const bothOpen =
                  current.morning_open &&
                  current.afternoon_open;

                const bothClosed =
                  !current.morning_open &&
                  !current.afternoon_open;

                const partial =
                  !bothOpen && !bothClosed;

                const people =
                  peopleByDate[date] || 0;

                let background =
                  "bg-green-100 border-green-300";

                if (bothClosed) {
                  background =
                    "bg-red-100 border-red-300";
                } else if (partial) {
                  background =
                    "bg-yellow-100 border-yellow-300";
                }

                const selected =
                  selectedDate === date;

                return (
                  <button
                    key={date}
                    type="button"
                    onClick={() =>
                      setSelectedDate(date)
                    }
                    className={[
                      "relative min-h-[68px] rounded-xl border p-1 text-left transition",
                      background,
                      selected
                        ? "ring-2 ring-zinc-900 ring-offset-1"
                        : "",
                    ].join(" ")}
                  >
                    <div className="text-sm font-extrabold text-zinc-900">
                      {day}
                    </div>

                    <div
                      className={[
                        "mt-1 text-center text-base font-extrabold",
                        people > 0
                          ? "text-red-600"
                          : "text-green-700",
                      ].join(" ")}
                    >
                      {people}
                    </div>

                    {partial && (
                      <div className="mt-1 text-center text-[9px] font-extrabold leading-tight text-zinc-800">
                        {!current.morning_open
                          ? "AM chiuso"
                          : "PM chiuso"}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold">
            <span className="rounded-full bg-green-100 px-3 py-1">
              🟢 Aperto
            </span>

            <span className="rounded-full bg-yellow-100 px-3 py-1">
              🟡 Mezza giornata
            </span>

            <span className="rounded-full bg-red-100 px-3 py-1">
              🔴 Chiuso
            </span>
          </div>
        </div>

        {/* GIORNO SELEZIONATO */}
        <div className="mt-4 rounded-3xl bg-white p-4 shadow-sm sm:p-6">
          <h2 className="text-lg font-extrabold capitalize text-zinc-900">
            {formatSelectedDate(selectedDate)}
          </h2>

          <div className="mt-2 flex flex-wrap gap-2">
            <span className="rounded-full bg-zinc-100 px-3 py-1 text-sm font-bold">
              Persone: {selectedPeople}
            </span>

            <span className="rounded-full bg-zinc-100 px-3 py-1 text-sm font-bold">
              Prenotazioni: {selectedBookings.length}
            </span>
          </div>

          {error && (
            <div className="mt-4 rounded-2xl bg-red-50 p-3 text-sm font-bold text-red-700">
              {error}
            </div>
          )}

          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <button
              type="button"
              disabled={saving}
              onClick={() =>
                changeAvailability("day", dayAction)
              }
              className={[
                "min-h-[58px] rounded-2xl px-4 py-3 text-base font-extrabold text-white disabled:opacity-50",
                dayAction === "close"
                  ? "bg-red-600"
                  : "bg-green-600",
              ].join(" ")}
            >
              {dayAction === "close"
                ? "Chiudi giorno"
                : "Apri giorno"}
            </button>

            <button
              type="button"
              disabled={saving}
              onClick={() =>
                changeAvailability(
                  "morning",
                  morningAction
                )
              }
              className={[
                "min-h-[58px] rounded-2xl px-4 py-3 text-base font-extrabold text-white disabled:opacity-50",
                morningAction === "close"
                  ? "bg-red-600"
                  : "bg-green-600",
              ].join(" ")}
            >
              {morningAction === "close"
                ? "Chiudi mattina"
                : "Apri mattina"}
            </button>

            <button
              type="button"
              disabled={saving}
              onClick={() =>
                changeAvailability(
                  "afternoon",
                  afternoonAction
                )
              }
              className={[
                "min-h-[58px] rounded-2xl px-4 py-3 text-base font-extrabold text-white disabled:opacity-50",
                afternoonAction === "close"
                  ? "bg-red-600"
                  : "bg-green-600",
              ].join(" ")}
            >
              {afternoonAction === "close"
                ? "Chiudi pomeriggio"
                : "Apri pomeriggio"}
            </button>
          </div>

          {saving && (
            <p className="mt-3 text-center text-sm font-semibold text-zinc-500">
              Salvataggio...
            </p>
          )}
        </div>

        {/* PRENOTAZIONI DEL GIORNO */}
        <div className="mt-4 rounded-3xl bg-white p-4 shadow-sm sm:p-6">
          <h2 className="text-lg font-extrabold text-zinc-900">
            Prenotazioni del giorno
          </h2>

          {selectedBookings.length === 0 ? (
            <div className="mt-4 rounded-2xl bg-zinc-50 p-5 text-center text-sm font-semibold text-zinc-500">
              Nessuna prenotazione
            </div>
          ) : (
            <div className="mt-4">
              <div className="grid grid-cols-[55px_minmax(105px,1.3fr)_85px_minmax(100px,1fr)_48px] gap-2 border-b border-zinc-200 px-2 pb-2 text-[11px] font-bold uppercase text-zinc-500">
                <div>Pers.</div>
                <div>Prenotazione</div>
                <div>Canale</div>
                <div>Nome</div>
                <div className="text-right">Ora</div>
              </div>

              <div className="divide-y divide-zinc-200">
                {selectedBookings.map((booking) => (
                  <div
                    key={booking.id}
                    className="grid grid-cols-[55px_minmax(105px,1.3fr)_85px_minmax(100px,1fr)_48px] items-center gap-2 px-2 py-3 text-sm"
                  >
                    <div className="font-extrabold text-zinc-900">
                      {booking.people}
                    </div>

                    <div className="truncate font-semibold text-zinc-700">
                      {booking.booking_reference || "—"}
                    </div>

                    <div className="truncate font-semibold text-zinc-700">
                      {booking.channel_name}
                    </div>

                    <div className="truncate font-bold text-zinc-900">
                      {booking.customer_name || "—"}
                    </div>

                    <div className="text-right font-bold text-zinc-700">
                      {formatTime(booking.booking_time)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}