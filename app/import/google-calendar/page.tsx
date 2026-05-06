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
  business_unit_id: number | null;
};

type ExperienceRow = {
  id: number;
  name: string;
};

type ChannelRow = {
  id: number;
  name: string;
};

type ComputedStagingRow = StagingRow & {
  computedStatus: string;
  matchedBooking?: BookingRow;
  matchReason?: string;
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
    case "rolled_back":
      return "Nuova";
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
    case "gcal_cancelled":
      return "Cancellata da Google Calendar";
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
    case "gcal_cancelled":
      return "bg-red-100 text-red-900";
    case "imported":
      return "bg-green-100 text-green-900";
    case "ignored":
      return "bg-zinc-200 text-zinc-600";
    default:
      return "bg-zinc-100 text-zinc-700";
  }
}

function isImportable(status: string) {
  return status === "pending" || status === "rolled_back";
}

function isForceImportable(status: string) {
  return status === "possible_duplicate";
}

function isActionSelectable(status: string) {
  return status !== "imported" && status !== "already_exists";
}

function importPageHref(date: string) {
  return `/import/google-calendar?date=${encodeURIComponent(date)}`;
}

function bookingEditHref(id: number, selectedDate: string) {
  const returnTo = importPageHref(selectedDate);
  return `/prenotazioni/${id}/modifica?returnTo=${encodeURIComponent(returnTo)}`;
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
      "id, booking_reference, booking_time, experience_id, channel_id, adults, children, infants, customer_name, experience_name, booking_source, notes, business_unit_id"
    )
    .eq("booking_date", selectedDate)
    .order("booking_time", { ascending: true })
    .order("id", { ascending: true });

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

  const existingIdMap = new Map(
    existingBookings.map((booking) => [booking.id, booking])
  );

  const duplicateKeyMap = new Map<string, BookingRow>();

  for (const booking of existingBookings) {
    duplicateKeyMap.set(buildPossibleDuplicateKey(booking), booking);
  }

  const rowsWithComputedStatus: ComputedStagingRow[] = stagingRows.map((row) => {
    const existingByReference = existingReferenceMap.get(row.booking_reference);
    const existingByImportedId = row.imported_booking_id
      ? existingIdMap.get(row.imported_booking_id)
      : undefined;
    const possibleDuplicate = duplicateKeyMap.get(buildPossibleDuplicateKey(row));

    let computedStatus = row.import_status;
    let matchedBooking: BookingRow | undefined;
    let matchReason = "";

    if (row.import_status === "gcal_cancelled") {
      computedStatus = "gcal_cancelled";
      matchedBooking = existingByImportedId;
      matchReason = existingByImportedId
        ? "evento cancellato da Google Calendar"
        : "";
    } else if (
      (row.import_status === "pending" || row.import_status === "rolled_back") &&
      existingByReference
    ) {
      computedStatus = "already_exists";
      matchedBooking = existingByReference;
      matchReason = "stesso riferimento";
    } else if (
      (row.import_status === "pending" || row.import_status === "rolled_back") &&
      possibleDuplicate
    ) {
      computedStatus = "possible_duplicate";
      matchedBooking = possibleDuplicate;
      matchReason = "stessa data, ora, esperienza, canale e persone";
    } else if (existingByImportedId) {
      matchedBooking = existingByImportedId;
      matchReason = "già importata";
    }

    return {
      ...row,
      computedStatus,
      matchedBooking,
      matchReason,
    };
  });

  const googleCount = rowsWithComputedStatus.length;
  const todoCount = existingBookings.length;

  const importableCount = rowsWithComputedStatus.filter((row) =>
    isImportable(row.computedStatus)
  ).length;

  const forceImportableCount = rowsWithComputedStatus.filter((row) =>
    isForceImportable(row.computedStatus)
  ).length;

  const cancelledGoogleCount = rowsWithComputedStatus.filter(
    (row) => row.computedStatus === "gcal_cancelled"
  ).length;

  const importedBookingIdsFromGoogle = new Set(
    rowsWithComputedStatus
      .filter((row) => row.import_status === "imported" && row.imported_booking_id)
      .map((row) => row.imported_booking_id as number)
  );

  const alreadyImportedLinkedBookingIds = new Set(
    rowsWithComputedStatus
      .filter(
        (row) => row.matchReason === "già importata" && row.matchedBooking?.id
      )
      .map((row) => row.matchedBooking!.id)
  );

  const googleCancelledLinkedBookingIds = new Set(
    rowsWithComputedStatus
      .filter(
        (row) =>
          row.computedStatus === "gcal_cancelled" && row.matchedBooking?.id
      )
      .map((row) => row.matchedBooking!.id)
  );

  return (
    <AppShell
      title="Import Google Calendar"
      subtitle="Controllo storico per giorno: Google Calendar a sinistra, Todo Manager a destra"
    >
      <div className="space-y-6">
        <SectionCard title="Seleziona giorno">
          <form
            method="get"
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
          >
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
              Mostra giorno
            </button>
          </form>
        </SectionCard>

        <SectionCard title={`Confronto del giorno - ${formatDateIt(selectedDate)}`}>
          <div className="mb-5 grid gap-3 rounded-2xl bg-zinc-50 p-4 text-sm text-zinc-700 md:grid-cols-5">
            <div>
              <div className="text-xs font-semibold uppercase text-zinc-500">
                Google Calendar
              </div>
              <div className="text-xl font-bold text-zinc-900">
                {googleCount}
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold uppercase text-zinc-500">
                Todo Manager
              </div>
              <div className="text-xl font-bold text-zinc-900">{todoCount}</div>
            </div>

            <div>
              <div className="text-xs font-semibold uppercase text-zinc-500">
                Importabili
              </div>
              <div className="text-xl font-bold text-zinc-900">
                {importableCount}
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold uppercase text-zinc-500">
                Possibili doppioni
              </div>
              <div className="text-xl font-bold text-red-700">
                {forceImportableCount}
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold uppercase text-zinc-500">
                Cancellate GCal
              </div>
              <div className="text-xl font-bold text-red-700">
                {cancelledGoogleCount}
              </div>
            </div>
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <div className="rounded-2xl border border-amber-200 bg-amber-50/30 p-4">
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-zinc-900">
                  Eventi Google Calendar
                </h2>
                <p className="text-sm text-zinc-500">
                  Seleziona solo quelli da importare. Le cancellazioni Google
                  Calendar non cancellano automaticamente Todo Manager: vanno
                  verificate.
                </p>
              </div>

              {stagingError ? (
                <div className="rounded-xl bg-red-50 p-4 text-sm text-red-800">
                  Errore lettura staging: {stagingError.message}
                </div>
              ) : rowsWithComputedStatus.length === 0 ? (
                <div className="rounded-xl bg-white p-4 text-sm text-zinc-600">
                  Nessun evento Google Calendar trovato per questa data.
                </div>
              ) : (
                <form
                  action={importSelectedGoogleCalendarRows}
                  className="space-y-4"
                >
                  <input type="hidden" name="return_date" value={selectedDate} />

                  <div className="space-y-3">
                    {rowsWithComputedStatus.map((row) => {
                      const title = row.notes || row.original_title || "";
                      const experienceName =
                        experienceMap.get(row.experience_id) ??
                        `ID ${row.experience_id}`;
                      const channelName =
                        channelMap.get(row.channel_id) ?? `ID ${row.channel_id}`;
                      const selectable = isActionSelectable(row.computedStatus);
                      const isCancelledByGoogle =
                        row.computedStatus === "gcal_cancelled";

                      return (
                        <div
                          key={row.id}
                          className={`rounded-2xl border bg-white p-4 shadow-sm ${
                            isCancelledByGoogle ||
                            row.computedStatus === "possible_duplicate"
                              ? "border-red-300"
                              : "border-amber-200"
                          }`}
                        >
                          <div className="mb-3 flex items-start gap-3">
                            <input
                              type="checkbox"
                              name="row_ids"
                              value={row.id}
                              disabled={!selectable}
                              className="mt-1 h-5 w-5 rounded border-zinc-300 disabled:opacity-30"
                            />

                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded-full bg-zinc-900 px-2.5 py-1 text-xs font-semibold text-white">
                                  {normalizeTime(row.booking_time) || "—"}
                                </span>

                                <span
                                  className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass(
                                    row.computedStatus
                                  )}`}
                                >
                                  {statusLabel(row.computedStatus)}
                                </span>
                              </div>

                              <div className="mt-2 text-sm font-bold text-zinc-900">
                                {title || "Senza titolo"}
                              </div>
                            </div>
                          </div>

                          <div className="grid gap-2 text-sm text-zinc-700 sm:grid-cols-2">
                            <div>
                              <span className="font-semibold">Esperienza:</span>{" "}
                              {experienceName}
                            </div>

                            <div>
                              <span className="font-semibold">Canale:</span>{" "}
                              {channelName}
                            </div>

                            <div>
                              <span className="font-semibold">Persone:</span>{" "}
                              {peopleLabel(row)}
                            </div>

                            <div className="break-all">
                              <span className="font-semibold">Rif:</span>{" "}
                              {row.booking_reference}
                            </div>
                          </div>

                          {row.matchReason && row.matchedBooking ? (
                            <div className="mt-3 rounded-xl bg-red-50 p-3 text-xs text-red-800">
                              Collegamento rilevato:{" "}
                              <span className="font-semibold">
                                {row.matchReason}
                              </span>{" "}
                              con prenotazione Todo Manager #
                              {row.matchedBooking.id}
                            </div>
                          ) : null}

                          {isCancelledByGoogle ? (
                            <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                              Evento cancellato da Google Calendar. La
                              prenotazione Todo Manager collegata non viene
                              cancellata automaticamente: controllala e decidi
                              manualmente.
                            </div>
                          ) : null}

                          {row.computedStatus === "possible_duplicate" ? (
                            <div className="mt-3 rounded-xl border border-red-200 bg-white p-3 text-xs text-red-800">
                              Se hai verificato che non è un doppione, seleziona
                              questa riga e premi{" "}
                              <span className="font-bold">
                                Importa comunque selezionate
                              </span>
                              .
                            </div>
                          ) : null}

                          {row.matchedBooking ? (
                            <div className="mt-3 flex flex-wrap gap-2">
                              <Link
                                href={bookingEditHref(
                                  row.matchedBooking.id,
                                  selectedDate
                                )}
                                className="rounded-xl bg-zinc-900 px-3 py-2 text-xs font-semibold text-white"
                              >
                                Modifica prenotazione
                              </Link>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                    <button
                      type="submit"
                      className="rounded-xl bg-green-700 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
                      disabled={importableCount === 0}
                    >
                      Importa selezionate
                    </button>

                    <button
                      type="submit"
                      name="force_import"
                      value="true"
                      className="rounded-xl bg-red-700 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
                      disabled={forceImportableCount === 0}
                    >
                      Importa comunque selezionate
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
            </div>

            <div className="rounded-2xl border border-green-200 bg-green-50/30 p-4">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-zinc-900">
                    Prenotazioni Todo Manager
                  </h2>
                  <p className="text-sm text-zinc-500">
                    Elenco completo già presente nello stesso giorno.
                  </p>
                </div>

                <Link
                  href="/prenotazioni"
                  className="text-sm font-medium text-zinc-700 underline underline-offset-4"
                >
                  Apri
                </Link>
              </div>

              {existingBookings.length === 0 ? (
                <div className="rounded-xl bg-white p-4 text-sm text-zinc-600">
                  Nessuna prenotazione già presente in Todo Manager per questa
                  data.
                </div>
              ) : (
                <div className="space-y-3">
                  {existingBookings.map((booking) => {
                    const importedFromGoogleCalendar =
                      importedBookingIdsFromGoogle.has(booking.id);

                    const linkedAsAlreadyImported =
                      alreadyImportedLinkedBookingIds.has(booking.id);

                    const linkedAsGoogleCancelled =
                      googleCancelledLinkedBookingIds.has(booking.id);

                    const highlightGoogleCalendarBooking =
                      importedFromGoogleCalendar ||
                      linkedAsAlreadyImported ||
                      linkedAsGoogleCancelled;

                    return (
                      <div
                        key={booking.id}
                        className={`rounded-2xl border p-4 shadow-sm ${
                          linkedAsGoogleCancelled
                            ? "border-red-300 bg-red-50 ring-2 ring-red-200"
                            : highlightGoogleCalendarBooking
                            ? "border-amber-300 bg-amber-50 ring-2 ring-amber-200"
                            : "border-green-200 bg-white"
                        }`}
                      >
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-zinc-900 px-2.5 py-1 text-xs font-semibold text-white">
                            {normalizeTime(booking.booking_time) || "—"}
                          </span>

                          <span className="rounded-full bg-green-100 px-2.5 py-1 text-xs font-semibold text-green-900">
                            #{booking.id}
                          </span>

                          <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-900">
                            BU {booking.business_unit_id ?? "—"}
                          </span>

                          {importedFromGoogleCalendar ? (
                            <span className="rounded-full bg-amber-200 px-2.5 py-1 text-xs font-semibold text-amber-900">
                              Import Google Calendar
                            </span>
                          ) : null}

                          {!importedFromGoogleCalendar &&
                          linkedAsAlreadyImported ? (
                            <span className="rounded-full bg-amber-200 px-2.5 py-1 text-xs font-semibold text-amber-900">
                              Collegata a evento Google Calendar
                            </span>
                          ) : null}

                          {linkedAsGoogleCancelled ? (
                            <span className="rounded-full bg-red-200 px-2.5 py-1 text-xs font-semibold text-red-900">
                              Evento Google cancellato
                            </span>
                          ) : null}
                        </div>

                        {linkedAsGoogleCancelled ? (
                          <div className="mb-3 rounded-xl bg-red-100 p-3 text-xs font-bold text-red-900">
                            Attenzione: l’evento Google Calendar collegato a
                            questa prenotazione è stato cancellato. La
                            prenotazione Todo Manager è ancora attiva e va
                            controllata manualmente.
                          </div>
                        ) : linkedAsAlreadyImported ? (
                          <div className="mb-3 rounded-xl bg-red-50 p-3 text-xs text-red-800">
                            Evidenziata perché negli eventi Google Calendar
                            risulta già importata con questa prenotazione Todo
                            Manager.
                          </div>
                        ) : null}

                        <div className="text-sm font-bold text-zinc-900">
                          {booking.customer_name || "Senza nome"}
                        </div>

                        <div className="mt-3 grid gap-2 text-sm text-zinc-700 sm:grid-cols-2">
                          <div>
                            <span className="font-semibold">Ora:</span>{" "}
                            {normalizeTime(booking.booking_time) || "—"}
                          </div>

                          <div>
                            <span className="font-semibold">Persone:</span>{" "}
                            {peopleLabel(booking)}
                          </div>

                          <div>
                            <span className="font-semibold">Esperienza:</span>{" "}
                            {booking.experience_name || "—"}
                          </div>

                          <div>
                            <span className="font-semibold">Canale:</span>{" "}
                            {booking.booking_source || "—"}
                          </div>

                          <div className="break-all sm:col-span-2">
                            <span className="font-semibold">Rif:</span>{" "}
                            {booking.booking_reference || "—"}
                          </div>
                        </div>

                        {booking.notes ? (
                          <div className="mt-3 rounded-xl bg-zinc-50 p-3 text-xs text-zinc-600">
                            {booking.notes}
                          </div>
                        ) : null}

                        <div className="mt-3 flex flex-wrap gap-2">
                          <Link
                            href={bookingEditHref(booking.id, selectedDate)}
                            className="rounded-xl bg-zinc-900 px-3 py-2 text-xs font-semibold text-white"
                          >
                            Modifica
                          </Link>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </SectionCard>
      </div>
    </AppShell>
  );
}