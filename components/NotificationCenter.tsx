import Link from "next/link";
import { supabase } from "@/lib/supabase";

function formatDate(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

export default async function NotificationCenter() {
  // Recupera tutte le prenotazioni che hanno una nota (il semaforo acceso)
  const { data: bookings, error } = await supabase
    .from("bookings")
    .select("id, customer_name, experience_name, notes, booking_date")
    .not("notes", "is", null)
    .order("id", { ascending: false });

  if (error) {
    console.error("Errore notifiche:", error.message);
  }

  // Filtra solo quelle che contengono fisicamente l'emoji del semaforo
  const alerts = bookings?.filter(b => 
    b.notes.includes('🔴') || b.notes.includes('🟡') || b.notes.includes('🟢')
  ) || [];

  if (alerts.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-bold text-zinc-900 mb-2">🔔 Notifiche</h2>
        <p className="text-sm text-zinc-500">Ottimo lavoro! Nessun avviso da leggere.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm flex flex-col max-h-[500px]">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-zinc-900">🔔 Da controllare</h2>
        <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-bold text-red-700 animate-pulse">
          {alerts.length} {alerts.length === 1 ? 'Avviso' : 'Avvisi'}
        </span>
      </div>
      
      <div className="space-y-3 overflow-y-auto pr-2 custom-scrollbar">
        {alerts.map((alert) => {
          const isRed = alert.notes.includes('🔴');
          const isYellow = alert.notes.includes('🟡');
          const isGreen = alert.notes.includes('🟢');
          
          let bgClass = "bg-zinc-50 border-zinc-200";
          if (isRed) bgClass = "bg-red-50 border-red-200";
          else if (isYellow) bgClass = "bg-amber-50 border-amber-200";
          else if (isGreen) bgClass = "bg-green-50 border-green-200";

          return (
            <Link 
              key={alert.id}
              // QUI LA MAGIA: Cliccando porta alla riga evidenziata!
              href={`/prenotazioni?highlight=${alert.id}`}
              className={`block rounded-lg border p-3 transition hover:shadow-md ${bgClass}`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex justify-between items-center mb-1">
                    <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                      Tour: {formatDate(alert.booking_date)}
                    </div>
                  </div>
                  <div className="text-sm font-bold text-zinc-900 truncate">
                    {alert.customer_name}
                  </div>
                  <div className="text-xs font-medium text-zinc-600 mt-0.5 truncate">
                    {alert.experience_name}
                  </div>
                  <div className="text-xs font-bold mt-2 text-zinc-800 bg-white/50 inline-block px-2 py-1 rounded">
                    {alert.notes}
                  </div>
                </div>
                <div className="text-zinc-400 self-center">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                    <path fillRule="evenodd" d="M8.22 5.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L11.94 10 8.22 6.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
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