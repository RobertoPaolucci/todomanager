import Link from "next/link";
import { supabaseServer } from "@/lib/supabase-server";
import { confirmCognanelloAvailability } from "@/app/disponibilita-cavalli/actions";

function formatDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);

  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Rome",
  }).format(new Date(value));
}

function getPeriodLabel(period: string) {
  if (period === "day") return "Giornata intera";
  if (period === "morning") return "Mattina";
  return "Pomeriggio";
}

export default async function CognanelloAvailabilityNotifications() {
  const { data, error } = await supabaseServer
    .from("horseback_availability_history")
    .select("id, availability_date, period, action, requested_by, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Errore comunicazioni Cognanello:", error.message);
  }

  const latestByDate = new Map<
    string,
    NonNullable<typeof data>[number]
  >();

  for (const notification of data || []) {
    if (!latestByDate.has(notification.availability_date)) {
      latestByDate.set(notification.availability_date, notification);
    }
  }

  const notifications = Array.from(latestByDate.values())
    .filter((notification) => notification.requested_by === "Cognanello")
    .slice(0, 10);

  return (
    <div className="flex max-h-[500px] flex-col rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-zinc-900">
          🐴 Comunicazioni Cognanello
        </h2>
        <Link
          href="/disponibilita-cavalli"
          className="shrink-0 text-xs font-bold text-zinc-600 hover:text-zinc-900"
        >
          Vedi calendario
        </Link>
      </div>

      {notifications.length === 0 ? (
        <p className="text-sm text-zinc-500">
          Nessuna chiusura o riapertura comunicata.
        </p>
      ) : (
        <div className="custom-scrollbar space-y-3 overflow-y-auto pr-2">
          {notifications.map((notification) => {
            const isClosure = notification.action === "close";
            const month = String(notification.availability_date).slice(0, 7);

            return (
              <div
                key={notification.id}
                className={`block rounded-lg border p-3 transition hover:shadow-md ${
                  isClosure
                    ? "border-red-200 bg-red-50"
                    : "border-green-200 bg-green-50"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <Link
                      href={`/disponibilita-cavalli?month=${month}`}
                      className="text-sm font-bold text-zinc-900 hover:underline"
                    >
                      {isClosure ? "🔴 Chiusura" : "🟢 Riapertura"}
                    </Link>
                    <div className="mt-1 text-xs font-semibold text-zinc-700">
                      {formatDate(notification.availability_date)} ·{" "}
                      {getPeriodLabel(notification.period)}
                    </div>
                    <div className="mt-1 text-[11px] text-zinc-500">
                      Comunicata da {notification.requested_by || "Cognanello"}
                    </div>
                  </div>
                  <span className="shrink-0 text-[10px] font-semibold text-zinc-500">
                    {formatDateTime(notification.created_at)}
                  </span>
                </div>

                <form action={confirmCognanelloAvailability} className="mt-3">
                  <input
                    type="hidden"
                    name="notification_id"
                    value={notification.id}
                  />
                  <button
                    type="submit"
                    className={`w-full rounded-lg px-3 py-2 text-xs font-bold text-white transition ${
                      isClosure
                        ? "bg-red-600 hover:bg-red-700"
                        : "bg-green-600 hover:bg-green-700"
                    }`}
                  >
                    {isClosure
                      ? "Chiusura eseguita"
                      : "Riapertura eseguita"}
                  </button>
                </form>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
