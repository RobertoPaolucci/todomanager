export const dynamic = "force-dynamic";

import Link from "next/link";
import AppShell from "@/components/AppShell";
import { supabaseServer } from "@/lib/supabase-server";

const HORSEBACK_EXPERIENCE_IDS = [1, 8, 9];

type SearchParams = Promise<{
  month?: string | string[];
}>;

type HistoryRow = {
  id: number;
  availability_date: string;
  period: "day" | "morning" | "afternoon";
  action: "open" | "close";
  morning_open: boolean;
  afternoon_open: boolean;
  requested_by: string | null;
  created_at: string;
};

type AvailabilityRow = {
  availability_date: string;
  morning_open: boolean;
  afternoon_open: boolean;
};

type BookingRow = {
  id: number;
  booking_date: string | null;
  adults: number | null;
  children: number | null;
  infants: number | null;

  status?: string | null;
  booking_status?: string | null;
  state?: string | null;

  deleted_at?: string | null;
  cancelled_at?: string | null;
  canceled_at?: string | null;

  is_cancelled?: boolean | string | number | null;
  is_canceled?: boolean | string | number | null;
  is_deleted?: boolean | string | number | null;

  active?: boolean | string | number | null;
};

function getParam(value?: string | string[]) {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }

  return value ?? "";
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function getCurrentMonth() {
  const now = new Date();

  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
}

function normalizeMonth(value: string) {
  if (!/^\d{4}-\d{2}$/.test(value)) {
    return getCurrentMonth();
  }

  const [, month] = value.split("-").map(Number);

  if (month < 1 || month > 12) {
    return getCurrentMonth();
  }

  return value;
}

function changeMonth(month: string, offset: number) {
  const [year, monthNumber] = month.split("-").map(Number);

  const result = new Date(
    year,
    monthNumber - 1 + offset,
    1
  );

  return `${result.getFullYear()}-${pad2(
    result.getMonth() + 1
  )}`;
}

function getMonthLabel(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);

  return new Intl.DateTimeFormat("it-IT", {
    month: "long",
    year: "numeric",
  }).format(
    new Date(year, monthNumber - 1, 1)
  );
}

function getMonthDates(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);

  const daysInMonth = new Date(
    year,
    monthNumber,
    0
  ).getDate();

  return {
    year,
    monthNumber,
    daysInMonth,
    firstDate: `${month}-01`,
    lastDate: `${month}-${pad2(daysInMonth)}`,
  };
}

function formatEventDate(value: string) {
  const [year, month, day] = value.split("-");

  return `${day}/${month}/${year.slice(2)}`;
}

function formatCreatedAt(value: string) {
  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Rome",
  }).format(new Date(value));
}

function getPeriodLabel(period: HistoryRow["period"]) {
  if (period === "day") return "Giorno";
  if (period === "morning") return "Mattina";

  return "Pomeriggio";
}

function getActionLabel(action: HistoryRow["action"]) {
  return action === "close"
    ? "CHIUSURA"
    : "RIAPERTURA";
}

function getCurrentState(row: HistoryRow) {
  if (
    row.morning_open &&
    row.afternoon_open
  ) {
    return "Aperto";
  }

  if (
    !row.morning_open &&
    !row.afternoon_open
  ) {
    return "Chiuso";
  }

  if (!row.morning_open) {
    return "AM chiuso";
  }

  return "PM chiuso";
}

function truthyFlag(value: unknown) {
  if (value === true) return true;

  if (
    value === false ||
    value == null
  ) {
    return false;
  }

  if (typeof value === "number") {
    return value === 1;
  }

  if (typeof value === "string") {
    const normalized = value
      .toLowerCase()
      .trim();

    return [
      "true",
      "1",
      "yes",
      "y",
      "t",
    ].includes(normalized);
  }

  return false;
}

function isCancelled(row: BookingRow) {
  const hasCancelledFlag =
    Boolean(row.deleted_at) ||
    Boolean(row.cancelled_at) ||
    Boolean(row.canceled_at) ||
    truthyFlag(row.is_deleted) ||
    truthyFlag(row.is_cancelled) ||
    truthyFlag(row.is_canceled) ||
    row.active === false ||
    row.active === 0 ||
    row.active === "0" ||
    row.active === "false";

  if (hasCancelledFlag) {
    return true;
  }

  const explicit = String(
    row.status ||
      row.booking_status ||
      row.state ||
      ""
  )
    .toLowerCase()
    .trim();

  return (
    explicit.includes("cancel") ||
    explicit.includes("annull")
  );
}

function countPeople(row: BookingRow) {
  return (
    Number(row.adults || 0) +
    Number(row.children || 0) +
    Number(row.infants || 0)
  );
}

export default async function DisponibilitaCavalliPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;

  const month = normalizeMonth(
    getParam(params.month)
  );

  const previousMonth = changeMonth(
    month,
    -1
  );

  const nextMonth = changeMonth(
    month,
    1
  );

  const {
    year,
    monthNumber,
    daysInMonth,
    firstDate,
    lastDate,
  } = getMonthDates(month);

  const firstWeekDay =
    (
      new Date(
        year,
        monthNumber - 1,
        1
      ).getDay() + 6
    ) % 7;

  const supabase = supabaseServer;

  const [
    historyResult,
    availabilityResult,
    bookingsResult,
  ] = await Promise.all([
    supabase
      .from(
        "horseback_availability_history"
      )
      .select(
        `
        id,
        availability_date,
        period,
        action,
        morning_open,
        afternoon_open,
        requested_by,
        created_at
      `
      )
      .order(
        "created_at",
        { ascending: false }
      ),

    supabase
      .from(
        "horseback_availability"
      )
      .select(
        `
        availability_date,
        morning_open,
        afternoon_open
      `
      )
      .gte(
        "availability_date",
        firstDate
      )
      .lte(
        "availability_date",
        lastDate
      ),

    supabase
      .from("bookings")
      .select("*")
      .in(
        "experience_id",
        HORSEBACK_EXPERIENCE_IDS
      )
      .gte(
        "booking_date",
        firstDate
      )
      .lte(
        "booking_date",
        lastDate
      ),
  ]);

  if (historyResult.error) {
    throw new Error(
      historyResult.error.message
    );
  }

  if (availabilityResult.error) {
    throw new Error(
      availabilityResult.error.message
    );
  }

  if (bookingsResult.error) {
    throw new Error(
      bookingsResult.error.message
    );
  }

  const history =
    (historyResult.data ||
      []) as HistoryRow[];

  const availabilityRows =
    (availabilityResult.data ||
      []) as AvailabilityRow[];

  const bookings =
    (bookingsResult.data ||
      []) as BookingRow[];

  const availabilityByDate =
    new Map<
      string,
      AvailabilityRow
    >();

  for (const row of availabilityRows) {
    availabilityByDate.set(
      row.availability_date,
      row
    );
  }

  const peopleByDate =
    new Map<string, number>();

  for (const booking of bookings) {
    if (
      !booking.booking_date ||
      isCancelled(booking)
    ) {
      continue;
    }

    const current =
      peopleByDate.get(
        booking.booking_date
      ) || 0;

    peopleByDate.set(
      booking.booking_date,
      current + countPeople(booking)
    );
  }

  const latestIdByDate =
    new Map<string, number>();

  for (const row of history) {
    if (
      !latestIdByDate.has(
        row.availability_date
      )
    ) {
      latestIdByDate.set(
        row.availability_date,
        row.id
      );
    }
  }

  return (
    <AppShell
      title="Disponibilità cavalli"
      subtitle="Calendario e storico chiusure Cognanello"
    >
      <div className="w-full max-w-5xl space-y-5">
        {/* CALENDARIO SOLO LETTURA */}
        <div className="rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <Link
              href={`/disponibilita-cavalli?month=${previousMonth}`}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-zinc-300 bg-white text-2xl font-bold text-zinc-900 transition hover:bg-zinc-50"
              aria-label="Mese precedente"
            >
              ‹
            </Link>

            <h2 className="text-center text-lg font-extrabold capitalize text-zinc-900">
              {getMonthLabel(month)}
            </h2>

            <Link
              href={`/disponibilita-cavalli?month=${nextMonth}`}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-zinc-300 bg-white text-2xl font-bold text-zinc-900 transition hover:bg-zinc-50"
              aria-label="Mese successivo"
            >
              ›
            </Link>
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

              const date =
                `${month}-${pad2(day)}`;

              const current =
                availabilityByDate.get(
                  date
                ) || {
                  availability_date:
                    date,
                  morning_open: true,
                  afternoon_open: true,
                };

              const people =
                peopleByDate.get(date) ||
                0;

              const bothOpen =
                current.morning_open &&
                current.afternoon_open;

              const bothClosed =
                !current.morning_open &&
                !current.afternoon_open;

              const partial =
                !bothOpen &&
                !bothClosed;

              let background =
                "bg-green-100 border-green-300";

              if (bothClosed) {
                background =
                  "bg-red-100 border-red-300";
              } else if (partial) {
                background =
                  "bg-yellow-100 border-yellow-300";
              }

              return (
                <div
                  key={date}
                  className={[
                    "min-h-[68px] rounded-xl border p-1",
                    background,
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
                </div>
              );
            })}
          </div>

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

            <span className="rounded-full bg-zinc-100 px-3 py-1">
              Numero rosso = persone prenotate
            </span>
          </div>
        </div>

        {/* STORICO */}
        <div>
          <h2 className="mb-3 text-lg font-extrabold text-zinc-900">
            Storico modifiche
          </h2>

          <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
            {history.length === 0 ? (
              <div className="p-6 text-center text-sm font-semibold text-zinc-500">
                Nessuna modifica registrata
              </div>
            ) : (
              <>
                <div className="grid grid-cols-[78px_minmax(190px,1fr)_90px_90px] gap-2 border-b border-zinc-200 bg-zinc-50 px-3 py-2 text-[10px] font-extrabold uppercase text-zinc-500 sm:grid-cols-[100px_minmax(300px,1fr)_130px_130px] sm:text-xs">
                  <div>Data</div>
                  <div>Operazione</div>
                  <div>Stato</div>
                  <div className="text-right">
                    Richiesta
                  </div>
                </div>

                <div className="divide-y divide-zinc-200">
                  {history.map((row) => {
                    const isClosing =
                      row.action ===
                      "close";

                    const isLatest =
                      latestIdByDate.get(
                        row.availability_date
                      ) === row.id;

                    return (
                      <div
                        key={row.id}
                        className={[
                          "grid grid-cols-[78px_minmax(190px,1fr)_90px_90px] items-center gap-2 px-3 py-2 text-xs sm:grid-cols-[100px_minmax(300px,1fr)_130px_130px] sm:text-sm",
                          isLatest
                            ? "border-l-4 border-amber-400 bg-amber-50"
                            : "bg-white",
                        ].join(" ")}
                      >
                        <div className="whitespace-nowrap font-extrabold text-zinc-900">
                          {formatEventDate(
                            row.availability_date
                          )}
                        </div>

                        <div className="flex min-w-0 items-center gap-1.5 whitespace-nowrap">
                          <span
                            className={
                              isClosing
                                ? "font-extrabold text-red-600"
                                : "font-extrabold text-green-700"
                            }
                          >
                            {getActionLabel(
                              row.action
                            )}
                          </span>

                          <span className="font-semibold text-zinc-700">
                            ·{" "}
                            {getPeriodLabel(
                              row.period
                            )}
                          </span>

                          {isLatest && (
                            <span className="ml-1 rounded-full bg-amber-200 px-1.5 py-0.5 text-[8px] font-extrabold uppercase leading-none text-amber-900">
                              Attuale
                            </span>
                          )}
                        </div>

                        <div className="whitespace-nowrap font-bold text-zinc-700">
                          {getCurrentState(
                            row
                          )}
                        </div>

                        <div className="whitespace-nowrap text-right font-semibold text-zinc-600">
                          {formatCreatedAt(
                            row.created_at
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          <div className="mt-3 text-xs text-zinc-500">
            {history.length} modifiche registrate
          </div>
        </div>
      </div>
    </AppShell>
  );
}