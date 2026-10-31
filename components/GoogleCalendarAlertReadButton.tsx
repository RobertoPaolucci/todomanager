"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { acknowledgeGoogleCalendarAlert } from "@/app/google-calendar-alert-actions";
import { withDashboardAlertSession } from "@/lib/dashboard-alert-session";

export default function GoogleCalendarAlertReadButton({ alertId, eventVersion }: {
  alertId: number;
  eventVersion: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function acknowledge() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await withDashboardAlertSession(() => acknowledgeGoogleCalendarAlert(alertId, eventVersion));
        if (!result.success) {
          setError(result.error || "Lettura non confermata. Riprova.");
          return;
        }
        // Refresh both the row and its counters only after confirmed persistence.
        router.refresh();
      } catch {
        setError("Lettura non confermata. L'avviso resta visibile. Riprova.");
      }
    });
  }

  return (
    <div>
      <button type="button" onClick={acknowledge} disabled={pending}
        title="Conferma solo la lettura: non riconcilia la cancellazione né modifica prenotazioni."
        className="inline-flex rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-[11px] font-bold text-zinc-800 shadow-sm transition hover:bg-zinc-100 disabled:opacity-50">
        {pending ? "Salvataggio..." : "Letto · Nascondi avviso"}
      </button>
      {error && <p role="alert" className="mt-1 text-xs font-semibold text-red-800">{error}</p>}
    </div>
  );
}
