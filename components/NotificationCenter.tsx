import Link from "next/link";
import { supabaseServer } from "@/lib/supabase-server";

function formatDate(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

export default async function NotificationCenter() {
  const { data: bookings, error } = await supabaseServer
    .from("bookings")
    .select(
      "id, customer_name, experience_name, notes, booking_date, total_people, booking_source"
    )
    .not("notes", "is", null)
    .order("id", { ascending: false });

  if (error) {
    console.error("Errore notifiche:", error.message);
  }

  const alerts =
    bookings?.filter(
      (b) =>
        b.notes?.includes("🔴") ||
        b.notes?.includes("🟡") ||
        b.notes?.includes("🟢")
    ) || [];

  if (alerts.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="mb-2 text-lg font-bold text-zinc-900">🔔 Notifiche</h2>
        <p className="text-sm text-zinc-500">
          Ottimo lavoro! Nessun avviso da leggere.
        </p>
      </div>
    );
  }

  return (
    <div className="flex max-h-[500px] flex-col rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold text-zinc-900">🔔 Da controllare</h2>
        <span className="animate-pulse rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-bold text-red-700">
          {alerts.length} {alerts.length === 1 ? "Avviso" : "Avvisi"}
        </span>
      </div>

      <div className="custom-scrollbar space-y-3 overflow-y-auto pr-2">
        {alerts.map((alert) => {
          const notes = alert.notes || "";
          const isRed = notes.includes("🔴");
          const isYellow = notes.includes("🟡");
          const isGreen = notes.includes("🟢");

          let bgClass = "bg-zinc-50 border-zinc-200";
          if (isRed) bgClass = "bg-red-50 border-red-200";
          else if (isYellow) bgClass = "bg-amber-50 border-amber-200";
          else if (isGreen) bgClass = "bg-green-50 border-green-200";

          return (
            <Link
              key={alert.id}
              href={`/prenotazioni?highlight=${alert.id}`}
              className={`block rounded-lg border p-3 transition hover:shadow-md ${bgClass}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="mb-1.5 flex items-start justify-between gap-2">
                    <div className="text-[11px] font-bold leading-tight text-zinc-800">
                      {notes}
                    </div>
                    <div className="whitespace-nowrap pt-0.5 text-[10px] font-bold text-zinc-500">
                      {formatDate(alert.booking_date)}
                    </div>
                  </div>

                  <div className="mb-0.5 flex flex-wrap items-center gap-1.5">
                    <span className="max-w-full truncate text-sm font-bold text-zinc-900">
                      {alert.customer_name}
                    </span>
                    <span className="text-[10px] text-zinc-300">●</span>
                    <span className="whitespace-nowrap text-xs font-bold text-zinc-700">
                      {alert.total_people || 0} Pax
                    </span>
                    <span className="text-[10px] text-zinc-300">●</span>
                    <span className="whitespace-nowrap text-[9px] font-bold uppercase tracking-wider text-blue-600">
                      {alert.booking_source || "Bokun"}
                    </span>
                  </div>

                  <div className="truncate text-[11px] font-medium text-zinc-500">
                    {alert.experience_name}
                  </div>
                </div>

                <div className="shrink-0 self-center text-zinc-400">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    className="h-5 w-5"
                  >
                    <path
                      fillRule="evenodd"
                      d="M8.22 5.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L11.94 10 8.22 6.28a.75.75 0 0 1 0-1.06Z"
                      clipRule="evenodd"
                    />
                  </svg>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}