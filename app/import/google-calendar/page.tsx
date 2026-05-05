export const dynamic = "force-dynamic";

import Link from "next/link";
import AppShell from "@/components/AppShell";
import SectionCard from "@/components/SectionCard";
import { supabaseServer } from "@/lib/supabase-server";
import {
  importSelectedGoogleCalendarRows,
  ignoreSelectedGoogleCalendarRows,
  resetSelectedGoogleCalendarRows,
} from "./actions";

type PageProps = {
  searchParams: Promise<{
    date?: string | string[];
  }>;
};

type StagingRow = {
  id: number;
  booking_date: string;
  booking_time: string | null;
  booking_reference: string;
  customer_name: string | null;
  adults: number;
  children: number;
  infants: number | null;
  experience_id: number;
  channel_id: number;
  booking_source: string | null;
  notes: string | null;
  gcal_uid: string;
  original_title: string | null;
  import_status: string;
  imported_booking_id: number | null;
};

type BookingRow = {
  id: number;
  booking_reference: string | null;
  booking_time: string | null;
  experience_id: number | null;
  channel_id: number | null;
  adults: number | null;
  children: number | null;
  infants: number | null;
  customer_name: string;
  experience_name: string;
  booking_source: string;
  notes: string | null;
};

type ExperienceRow = {
  id: number;
  name: string;
};

type ChannelRow = {
  id: number;
  name: string;
};

function getParam(value?: string | string[]) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function todayRome() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function formatDateIt(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, (month || 1) - 1, day || 1);

  return new Intl.DateTimeFormat("it-IT", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function normalizeTime(value: string | null | undefined) {
  if (!value) return "";
  return String(value).slice(0, 5);
}

function peopleLabel(row: {
  adults: number | null;
  children: number | null;
  infants: number | null;
}) {
  const adults = Number(row.adults ?? 0);
  const children = Number(row.children ?? 0);
  const infants = Number(row.infants ?? 0);

  const parts = [`${adults} adulti`];

  if (children > 0) parts.push(`${children} bambini`);
  if (infants > 0) parts.push(`${infants} neonati`);

  return parts.join(" + ");
}

function statusLabel(status: string) {
  switch (status) {
    case "pending":
      return "Da importare";
    case "rolled_back":
      return "Da importare";
    case "already_exists":
      return "Già presente";
    case "possible_duplicate":
      return "Possibile doppione";
    case "imported":
      return "Importata";
    case "ignored":
      return "Ignorata";
    case "needs_review":
      return "Da verificare";
    default:
      return status;
  }
}

function statusClass(status: string) {
  switch (status) {
    case "pending":
    case "rolled_back":
      return "bg-amber-100 text-amber-900";
    case "already_exists":
      return "bg-zinc-100 text-zinc-700";
    case "possible_duplicate":
    case "needs_review":
      return "bg-red-100 text-red-900";
    case "imported":
      return "bg-green-100 text-green-900";
    case "ignored":
      return "bg-zinc-200 text-zinc-600";
    default:
      return "bg-zinc-100 text-zinc-700";
  }
}

function isSelectable(status: string) {
  return status === "pending" || status === "rolled_back";
}

function buildPossibleDuplicateKey(row: {
  booking_time: string | null;
  experience_id: number | null;
  channel_id: number | null;
  adults: number | null;
  children: number | null;
  infants: number | null;
}) {
  return [
    normalizeTime(row.booking_time),
    row.experience_id ?? "",
    row.channel_id ?? "",
    Number(row.adults ?? 0),
    Number(row.children ?? 0),
    Number(row.infants ?? 0),
  ].join("|");
}

export default async function GoogleCalendarImportPage({
  searchParams,
}: PageProps) {
  const params = await searchParams;
  const selectedDate = getParam(params.date) || todayRome();

  const { data: stagingData, error: stagingError } = await supabaseServer
    .from("google_calendar_import_staging")
    .select(
      "id, booking_date, booking_time, booking_reference, customer_name, adults, children, infants, experience_id, channel_id, booking_source, notes, gcal_uid, original_title, import_status, imported_booking_id"
    )
    .eq("booking_date", selectedDate)
    .order("booking_time", { ascending: true })
    .order("id", { ascending: true });

  const stagingRows = (stagingData ?? []) as StagingRow[];

  const { data: bookingsData } = await supabaseServer
    .from("bookings")
    .select(
      "id, booking_reference, booking_time, experience_id, channel_id, adults, children, infants, customer_name, experience_name, booking_source, notes"
    )
    .eq("business_unit_id", 1)
    .eq("booking_date", selectedDate);

  const existingBookings = (bookingsData ?? []) as BookingRow[];

  const experienceIds = Array.from(
    new Set(stagingRows.map((row) => row.experience_id).filter(Boolean))
  );

  const channelIds = Array.from(
    new Set(stagingRows.map((row) => row.channel_id).filter(Boolean))
  );

  const { data: experiencesData } =
    experienceIds.length > 0
      ? await supabaseServer
          .from("experiences")
          .select("id, name")
          .in("id", experienceIds)
      : { data: [] };

  const { data: channelsData } =
    channelIds.length > 0
      ? await supabaseServer
          .from("channels")
          .select("id, name")
          .in("id", channelIds)
      : { data: [] };

  const experiences = (experiencesData ?? []) as ExperienceRow[];
  const channels = (channelsData ?? []) as ChannelRow[];

  const experienceMap = new Map(experiences.map((item) => [item.id, item.name]));
  const channelMap = new Map(channels.map((item) => [item.id, item.name]));

  const existingReferenceMap = new Map(
    existingBookings
      .filter((booking) => booking.booking_reference)
      .map((booking) => [booking.booking_reference as string, booking])
  );

  const duplicateKeyMap = new Map<string, BookingRow>();

  for (const booking of existingBookings) {
    duplicateKeyMap.set(buildPossibleDuplicateKey(booking), booking);
  }

  const rowsWithComputedStatus = stagingRows.map((row) => {
    const existingByReference = existingReferenceMap.get(row.booking_reference);
    const possibleDuplicate = duplicateKeyMap.get(buildPossibleDuplicateKey(row));

    let computedStatus = row.import_status;

    if (row.import_status === "pending" || row.import_status === "rolled_back") {
      if (existingByReference) {
        computedStatus = "already_exists";
      } else if (possibleDuplicate) {
        computedStatus = "possible_duplicate";
      }
    }

    return {
      ...row,
      computedStatus,
      existingByReference,
      possibleDuplicate,
    };
  });

  const selectableCount = rowsWithComputedStatus.filter((row) =>
    isSelectable(row.computedStatus)
  ).length;

  return (
    <AppShell
      title="Import Google Calendar"
      subtitle="Import manuale storico, un giorno alla volta"
    >
      <div className="space-y-6">
        <SectionCard title="Seleziona giorno">
          <form method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-700">
                Giorno da controllare
              </label>
              <input
                type="date"
                name="date"
                defaultValue={selectedDate}
                className="w-full rounded-xl border border-zinc-300 px-3 py-3 text-[16px] sm:w-auto"
              />
            </div>

            <button
              type="submit"
              className="rounded-xl bg-zinc-900 px-4 py-3 text-sm font-semibold text-white"
            >
              Mostra eventi
            </button>
          </form>
        </SectionCard>

        <SectionCard title="Eventi Google Calendar">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-zinc-900">
                {formatDateIt(selectedDate)}
              </h2>
              <p className="text-sm text-zinc-500">
                Eventi trovati: {rowsWithComputedStatus.length} · Importabili:{" "}
                {selectableCount}
              </p>
            </div>

            <Link
              href="/prenotazioni"
              className="text-sm font-medium text-zinc-700 underline underline-offset-4"
            >
              Vai alle prenotazioni
            </Link>
          </div>

          {stagingError ? (
            <div className="rounded-xl bg-red-50 p-4 text-sm text-red-800">
              Errore lettura staging: {stagingError.message}
            </div>
          ) : rowsWithComputedStatus.length === 0 ? (
            <div className="rounded-xl bg-zinc-50 p-4 text-sm text-zinc-600">
              Nessun evento Google Calendar trovato per questa data.
            </div>
          ) : (
            <form action={importSelectedGoogleCalendarRows} className="space-y-4">
              <input type="hidden" name="return_date" value={selectedDate} />

              <div className="overflow-hidden rounded-2xl border border-zinc-200">
                <div className="hidden grid-cols-[48px_80px_1.5fr_1fr_1fr_120px] gap-3 bg-zinc-50 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-zinc-500 md:grid">
                  <div></div>
                  <div>Ora</div>
                  <div>Titolo originale</div>
                  <div>Esperienza</div>
                  <div>Canale</div>
                  <div>Stato</div>
                </div>

                <div className="divide-y divide-zinc-200">
                  {rowsWithComputedStatus.map((row) => {
                    const selectable = isSelectable(row.computedStatus);
                    const title = row.notes || row.original_title || "";

                    return (
                      <div
                        key={row.id}
                        className="grid gap-3 px-4 py-4 md:grid-cols-[48px_80px_1.5fr_1fr_1fr_120px] md:items-start"
                      >
                        <div>
                          <input
                            type="checkbox"
                            name="row_ids"
                            value={row.id}
                            disabled={!selectable}
                            className="h-5 w-5 rounded border-zinc-300"
                          />
                        </div>

                        <div className="text-sm font-semibold text-zinc-900">
                          {normalizeTime(row.booking_time) || "—"}
                        </div>

                        <div>
                          <div className="text-sm font-medium text-zinc-900">
                            {title || "Senza titolo"}
                          </div>
                          <div className="mt-1 text-xs text-zinc-500">
                            {peopleLabel(row)} · Rif. {row.booking_reference}
                          </div>

                          {row.computedStatus === "possible_duplicate" &&
                            row.possibleDuplicate && (
                              <div className="mt-2 rounded-xl bg-red-50 p-2 text-xs text-red-800">
                                Possibile doppione con prenotazione #
                                {row.possibleDuplicate.id}:{" "}
                                {row.possibleDuplicate.customer_name} ·{" "}
                                {row.possibleDuplicate.experience_name}
                              </div>
                            )}

                          {row.computedStatus === "already_exists" &&
                            row.existingByReference && (
                              <div className="mt-2 rounded-xl bg-zinc-50 p-2 text-xs text-zinc-700">
                                Già presente in Todo Manager come prenotazione #
                                {row.existingByReference.id}
                              </div>
                            )}
                        </div>

                        <div className="text-sm text-zinc-700">
                          <span className="md:hidden font-semibold">
                            Esperienza:{" "}
                          </span>
                          {experienceMap.get(row.experience_id) ??
                            `ID ${row.experience_id}`}
                        </div>

                        <div className="text-sm text-zinc-700">
                          <span className="md:hidden font-semibold">
                            Canale:{" "}
                          </span>
                          {channelMap.get(row.channel_id) ?? `ID ${row.channel_id}`}
                        </div>

                        <div>
                          <span
                            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass(
                              row.computedStatus
                            )}`}
                          >
                            {statusLabel(row.computedStatus)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  type="submit"
                  className="rounded-xl bg-green-700 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
                  disabled={selectableCount === 0}
                >
                  Importa selezionate
                </button>

                <button
                  type="submit"
                  formAction={ignoreSelectedGoogleCalendarRows}
                  className="rounded-xl bg-zinc-200 px-4 py-3 text-sm font-semibold text-zinc-900"
                >
                  Ignora selezionate
                </button>

                <button
                  type="submit"
                  formAction={resetSelectedGoogleCalendarRows}
                  className="rounded-xl border border-zinc-300 px-4 py-3 text-sm font-semibold text-zinc-900"
                >
                  Rimetti da importare
                </button>
              </div>
            </form>
          )}
        </SectionCard>
      </div>
    </AppShell>
  );
}