export const dynamic = "force-dynamic";

import AppShell from "@/components/AppShell";
import { supabaseServer } from "@/lib/supabase-server";

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
  return action === "close" ? "CHIUSURA" : "RIAPERTURA";
}

function getCurrentState(row: HistoryRow) {
  if (row.morning_open && row.afternoon_open) {
    return "Aperto";
  }

  if (!row.morning_open && !row.afternoon_open) {
    return "Chiuso";
  }

  if (!row.morning_open) {
    return "AM chiuso";
  }

  return "PM chiuso";
}

export default async function DisponibilitaCavalliPage() {
  const supabase = supabaseServer;

  const { data, error } = await supabase
    .from("horseback_availability_history")
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
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  const history = (data || []) as HistoryRow[];

  const latestIdByDate = new Map<string, number>();

  for (const row of history) {
    if (!latestIdByDate.has(row.availability_date)) {
      latestIdByDate.set(row.availability_date, row.id);
    }
  }

  return (
    <AppShell
      title="Disponibilità cavalli"
      subtitle="Storico chiusure e riaperture Cognanello"
    >
      <div className="w-full max-w-5xl">
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
                <div className="text-right">Richiesta</div>
              </div>

              <div className="divide-y divide-zinc-200">
                {history.map((row) => {
                  const isClosing = row.action === "close";

                  const isLatest =
                    latestIdByDate.get(row.availability_date) === row.id;

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
                        {formatEventDate(row.availability_date)}
                      </div>

                      <div className="flex min-w-0 items-center gap-1.5 whitespace-nowrap">
                        <span
                          className={
                            isClosing
                              ? "font-extrabold text-red-600"
                              : "font-extrabold text-green-700"
                          }
                        >
                          {getActionLabel(row.action)}
                        </span>

                        <span className="font-semibold text-zinc-700">
                          · {getPeriodLabel(row.period)}
                        </span>

                        {isLatest && (
                          <span className="ml-1 rounded-full bg-amber-200 px-1.5 py-0.5 text-[8px] font-extrabold uppercase leading-none text-amber-900">
                            Attuale
                          </span>
                        )}
                      </div>

                      <div className="whitespace-nowrap font-bold text-zinc-700">
                        {getCurrentState(row)}
                      </div>

                      <div className="whitespace-nowrap text-right font-semibold text-zinc-600">
                        {formatCreatedAt(row.created_at)}
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
    </AppShell>
  );
}