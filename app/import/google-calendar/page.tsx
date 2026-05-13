export const dynamic = "force-dynamic";

import type { ReactNode } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import SectionCard from "@/components/SectionCard";
import { supabaseServer } from "@/lib/supabase-server";
import { cancelBooking } from "@/app/prenotazioni/actions";
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
  booking_date: string | null;
  booking_time: string | null;
  booking_reference: string;
  customer_name: string | null;
  adults: number;
  children: number;
  infants: number | null;
  experience_id: number | null;
  channel_id: number | null;
  booking_source: string | null;
  notes: string | null;
  gcal_uid: string;
  original_title: string | null;
  import_status: string;
  imported_booking_id: number | null;
  gcal_updated_at: string | null;
  gcal_html_link: string | null;
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
  is_cancelled: boolean | null;
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

type ComparisonRow = {
  id: string;
  googleRow?: ComputedStagingRow;
  todoBooking?: BookingRow;
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

function formatDateIt(value?: string | null) {
  if (!value) return "—";

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, (month || 1) - 1, day || 1);

  return new Intl.DateTimeFormat("it-IT", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function formatDateShortIt(value?: string | null) {
  if (!value) return "—";

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, (month || 1) - 1, day || 1);

  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function formatDateTimeIt(value?: string | null) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("it-IT", {
    timeZone: "Europe/Rome",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
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

function totalPeopleNumber(row: {
  adults: number | null;
  children: number | null;
  infants: number | null;
}) {
  return (
    Number(row.adults ?? 0) +
    Number(row.children ?? 0) +
    Number(row.infants ?? 0)
  );
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
    case "probable_match":
      return "Probabile corrispondenza";
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
      return "bg-amber-100 text-amber-900 ring-amber-200";
    case "already_exists":
      return "bg-blue-100 text-blue-900 ring-blue-200";
    case "possible_duplicate":
    case "probable_match":
    case "needs_review":
      return "bg-amber-100 text-amber-900 ring-amber-200";
    case "gcal_cancelled":
      return "bg-red-100 text-red-900 ring-red-200";
    case "imported":
      return "bg-green-100 text-green-900 ring-green-200";
    case "ignored":
      return "bg-zinc-200 text-zinc-700 ring-zinc-300";
    default:
      return "bg-zinc-100 text-zinc-700 ring-zinc-200";
  }
}

function rowToneClass(status?: string, todoOnly = false) {
  if (todoOnly) {
    return "border-blue-200 bg-blue-50/20";
  }

  switch (status) {
    case "imported":
      return "border-green-200 bg-green-50/20";
    case "already_exists":
      return "border-blue-200 bg-blue-50/20";
    case "possible_duplicate":
    case "probable_match":
    case "needs_review":
      return "border-amber-300 bg-amber-50/30";
    case "gcal_cancelled":
      return "border-red-300 bg-red-50/30";
    case "ignored":
      return "border-zinc-300 bg-zinc-50";
    case "pending":
    case "rolled_back":
    default:
      return "border-amber-200 bg-white";
  }
}

function cardToneClass(status?: string, side: "google" | "todo" = "google") {
  if (side === "todo") {
    switch (status) {
      case "gcal_cancelled":
        return "border-red-300 bg-red-50/40";
      case "possible_duplicate":
      case "probable_match":
      case "needs_review":
        return "border-amber-300 bg-amber-50/30";
      case "already_exists":
        return "border-blue-300 bg-blue-50/30";
      case "imported":
        return "border-green-300 bg-green-50/30";
      default:
        return "border-green-200 bg-white";
    }
  }

  switch (status) {
    case "gcal_cancelled":
      return "border-red-300 bg-white";
    case "possible_duplicate":
    case "probable_match":
    case "needs_review":
      return "border-amber-300 bg-white";
    case "already_exists":
      return "border-blue-300 bg-white";
    case "imported":
      return "border-green-300 bg-white";
    case "ignored":
      return "border-zinc-300 bg-white";
    default:
      return "border-amber-200 bg-white";
  }
}

function isImportable(status: string) {
  return status === "pending" || status === "rolled_back";
}

function isForceImportable(status: string) {
  return status === "possible_duplicate" || status === "probable_match";
}

function isActionSelectable(status: string) {
  return status !== "imported" && status !== "already_exists";
}

function canIgnore(status: string) {
  return [
    "pending",
    "rolled_back",
    "needs_review",
    "possible_duplicate",
    "probable_match",
    "gcal_cancelled",
  ].includes(status);
}

function canReset(status: string) {
  return [
    "rolled_back",
    "ignored",
    "needs_review",
    "possible_duplicate",
    "probable_match",
    "gcal_cancelled",
  ].includes(status);
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

function buildProbableMatchKey(row: {
  booking_time: string | null;
  experience_id: number | null;
  channel_id: number | null;
}) {
  return [
    normalizeTime(row.booking_time),
    row.experience_id ?? "",
    row.channel_id ?? "",
  ].join("|");
}

function getBestProbableMatch(
  row: StagingRow,
  candidates: BookingRow[] | undefined
) {
  if (!candidates || candidates.length === 0) return undefined;

  const rowPeople = totalPeopleNumber(row);

  const sorted = [...candidates].sort((a, b) => {
    const diffA = Math.abs(totalPeopleNumber(a) - rowPeople);
    const diffB = Math.abs(totalPeopleNumber(b) - rowPeople);

    if (diffA !== diffB) return diffA - diffB;

    return a.id - b.id;
  });

  return sorted[0];
}

function todoStatusLabel(options: {
  booking: BookingRow;
  importedFromGoogleCalendar: boolean;
  linkedAsAlreadyImported: boolean;
  linkedAsGoogleCancelled: boolean;
  linkedAsProbableMatch: boolean;
}) {
  const {
    booking,
    importedFromGoogleCalendar,
    linkedAsAlreadyImported,
    linkedAsGoogleCancelled,
    linkedAsProbableMatch,
  } = options;

  if (booking.is_cancelled) return "Prenotazione annullata";
  if (linkedAsGoogleCancelled) return "Evento Google cancellato";
  if (linkedAsProbableMatch) return "Probabile corrispondenza";
  if (importedFromGoogleCalendar) return "Importata da Google Calendar";
  if (linkedAsAlreadyImported) return "Collegata a evento Google Calendar";

  return "Presente in Todo Manager";
}

function MetricCard({
  label,
  value,
  tone = "zinc",
}: {
  label: string;
  value: number;
  tone?: "zinc" | "green" | "amber" | "red" | "blue";
}) {
  const toneClass =
    tone === "green"
      ? "border-green-200 bg-green-50 text-green-900"
      : tone === "amber"
      ? "border-amber-200 bg-amber-50 text-amber-900"
      : tone === "red"
      ? "border-red-200 bg-red-50 text-red-900"
      : tone === "blue"
      ? "border-blue-200 bg-blue-50 text-blue-900"
      : "border-zinc-200 bg-white text-zinc-900";

  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${toneClass}`}>
      <div className="text-xs font-bold uppercase tracking-wide opacity-70">
        {label}
      </div>
      <div className="mt-1 text-3xl font-black">{value}</div>
    </div>
  );
}

function FieldLine({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="grid grid-cols-[125px_minmax(0,1fr)] gap-3 text-sm">
      <div className="text-[11px] font-bold uppercase tracking-wide text-zinc-500">
        {label}
      </div>
      <div
        className={`min-w-0 break-words ${
          strong ? "font-black text-zinc-950" : "font-semibold text-zinc-800"
        }`}
      >
        {value || "—"}
      </div>
    </div>
  );
}

function NotesBox({
  children,
  tone = "zinc",
}: {
  children: ReactNode;
  tone?: "zinc" | "green" | "amber" | "red";
}) {
  const toneClass =
    tone === "green"
      ? "border-green-200 bg-green-50 text-green-900"
      : tone === "amber"
      ? "border-amber-200 bg-amber-50 text-amber-900"
      : tone === "red"
      ? "border-red-200 bg-red-50 text-red-900"
      : "border-zinc-200 bg-zinc-50 text-zinc-700";

  return (
    <div className={`rounded-xl border p-3 text-xs ${toneClass}`}>
      <div className="mb-1 font-black uppercase tracking-wide">
        Note interne / avvisi
      </div>
      <div className="whitespace-pre-wrap leading-relaxed">{children}</div>
    </div>
  );
}

function GoogleCalendarCard({
  row,
  experienceName,
  channelName,
}: {
  row: ComputedStagingRow;
  experienceName: string;
  channelName: string;
}) {
  const title = String(row.notes || row.original_title || "").trim();
  const isCancelledByGoogle = row.computedStatus === "gcal_cancelled";
  const noteTone =
    row.computedStatus === "gcal_cancelled"
      ? "red"
      : row.computedStatus === "possible_duplicate" ||
        row.computedStatus === "probable_match" ||
        row.computedStatus === "needs_review"
      ? "amber"
      : row.computedStatus === "imported"
      ? "green"
      : "zinc";

  return (
    <div
      className={`h-full rounded-2xl border p-4 shadow-sm ${cardToneClass(
        row.computedStatus,
        "google"
      )}`}
    >
      <div className="mb-4 flex flex-wrap items-start gap-2">
        <span className="rounded-full bg-zinc-900 px-2.5 py-1 text-xs font-black text-white">
          {normalizeTime(row.booking_time) || "—"}
        </span>

        <div className="min-w-0 flex-1 text-sm font-black text-zinc-950">
          {title || "Senza titolo"}
        </div>

        <span
          className={`rounded-full px-2.5 py-1 text-xs font-black ring-1 ${statusClass(
            row.computedStatus
          )}`}
        >
          {statusLabel(row.computedStatus)}
        </span>
      </div>

      <div className="space-y-2">
        <FieldLine
          label="Nome cliente"
          value={row.customer_name || "Da verificare"}
          strong
        />
        <FieldLine label="Stato" value={statusLabel(row.computedStatus)} />
        <FieldLine
          label="Data evento GCal"
          value={formatDateTimeIt(row.gcal_updated_at)}
        />
        <FieldLine
          label="Data esperienza"
          value={formatDateShortIt(row.booking_date)}
        />
        <FieldLine
          label="Ora esperienza"
          value={normalizeTime(row.booking_time) || "—"}
          strong
        />
        <FieldLine label="Esperienza" value={experienceName} />
        <FieldLine label="Canale" value={channelName} />
        <FieldLine label="Persone" value={peopleLabel(row)} strong />
        <FieldLine label="Rif. / ID" value={row.booking_reference || "—"} />
        <FieldLine
          label="Rif. collegamento"
          value={
            row.matchedBooking
              ? `Todo #${row.matchedBooking.id}${
                  row.matchReason ? ` - ${row.matchReason}` : ""
                }`
              : "—"
          }
        />
      </div>

      <div className="mt-4 space-y-3">
        {row.gcal_html_link ? (
          <a
            href={row.gcal_html_link}
            target="_blank"
            rel="noreferrer"
            className="inline-flex rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-800 underline-offset-4 hover:underline"
          >
            Apri evento Google Calendar
          </a>
        ) : null}

        {row.matchReason && row.matchedBooking ? (
          <NotesBox tone="amber">
            Collegamento rilevato:{" "}
            <span className="font-black">{row.matchReason}</span> con
            prenotazione Todo Manager #{row.matchedBooking.id}.
          </NotesBox>
        ) : null}

        {isCancelledByGoogle ? (
          <NotesBox tone="red">
            Evento cancellato da Google Calendar. La prenotazione Todo Manager
            collegata non viene cancellata automaticamente: controllala e decidi
            manualmente.
          </NotesBox>
        ) : row.computedStatus === "possible_duplicate" ? (
          <NotesBox tone="amber">
            Possibile doppione. Se hai verificato che non è un doppione, usa
            “Importa comunque”.
          </NotesBox>
        ) : row.computedStatus === "probable_match" ? (
          <NotesBox tone="amber">
            Probabile corrispondenza trovata, ma i dati non coincidono al 100%.
            Controlla soprattutto il numero persone prima di importare o
            modificare.
          </NotesBox>
        ) : null}

        <NotesBox tone={noteTone}>
          {title || "Nessuna nota disponibile per questo evento."}
        </NotesBox>
      </div>
    </div>
  );
}

function EmptyGoogleCard() {
  return (
    <div className="flex h-full min-h-[320px] flex-col justify-center rounded-2xl border border-dashed border-blue-300 bg-blue-50/40 p-5 text-center">
      <div className="text-lg font-black text-blue-900">
        Nessun evento Google Calendar abbinato
      </div>
      <div className="mt-2 text-sm font-medium text-blue-800">
        Questa prenotazione esiste in Todo Manager ma non ha una riga Google
        Calendar corrispondente in questa schermata.
      </div>
    </div>
  );
}

function TodoBookingCard({
  booking,
  selectedDate,
  importedFromGoogleCalendar,
  linkedAsAlreadyImported,
  linkedAsGoogleCancelled,
  linkedAsProbableMatch,
}: {
  booking: BookingRow;
  selectedDate: string;
  importedFromGoogleCalendar: boolean;
  linkedAsAlreadyImported: boolean;
  linkedAsGoogleCancelled: boolean;
  linkedAsProbableMatch: boolean;
}) {
  const isCancelledBooking = booking.is_cancelled === true;

  const status = todoStatusLabel({
    booking,
    importedFromGoogleCalendar,
    linkedAsAlreadyImported,
    linkedAsGoogleCancelled,
    linkedAsProbableMatch,
  });

  const tone =
    linkedAsGoogleCancelled || isCancelledBooking
      ? "red"
      : importedFromGoogleCalendar ||
        linkedAsAlreadyImported ||
        linkedAsProbableMatch
      ? "amber"
      : "green";

  return (
    <div
      className={`h-full rounded-2xl border p-4 shadow-sm ${
        linkedAsGoogleCancelled
          ? "border-red-300 bg-red-50/40 ring-2 ring-red-100"
          : isCancelledBooking
          ? "border-zinc-300 bg-zinc-100 text-zinc-500"
          : importedFromGoogleCalendar ||
            linkedAsAlreadyImported ||
            linkedAsProbableMatch
          ? "border-amber-300 bg-amber-50/30 ring-2 ring-amber-100"
          : "border-green-200 bg-white"
      }`}
    >
      <div className="mb-4 flex flex-wrap items-start gap-2">
        <span className="rounded-full bg-zinc-900 px-2.5 py-1 text-xs font-black text-white">
          {normalizeTime(booking.booking_time) || "—"}
        </span>

        <div
          className={`min-w-0 flex-1 text-sm font-black ${
            isCancelledBooking ? "text-zinc-500 line-through" : "text-zinc-950"
          }`}
        >
          {booking.customer_name || "Senza nome"}
        </div>

        <span className="rounded-full bg-green-100 px-2.5 py-1 text-xs font-black text-green-900 ring-1 ring-green-200">
          #{booking.id}
        </span>

        <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-black text-blue-900 ring-1 ring-blue-200">
          BU {booking.business_unit_id ?? "—"}
        </span>
      </div>

      <div className="space-y-2">
        <FieldLine
          label="Nome cliente"
          value={booking.customer_name || "Senza nome"}
          strong
        />
        <FieldLine label="Stato" value={status} />
        <FieldLine label="Data evento GCal" value="—" />
        <FieldLine
          label="Data esperienza"
          value={formatDateShortIt(selectedDate)}
        />
        <FieldLine
          label="Ora esperienza"
          value={normalizeTime(booking.booking_time) || "—"}
          strong
        />
        <FieldLine label="Esperienza" value={booking.experience_name || "—"} />
        <FieldLine label="Canale" value={booking.booking_source || "—"} />
        <FieldLine label="Persone" value={peopleLabel(booking)} strong />
        <FieldLine label="Rif. / ID" value={booking.booking_reference || "—"} />
        <FieldLine
          label="Rif. collegamento"
          value={
            linkedAsGoogleCancelled
              ? "Evento Google cancellato"
              : linkedAsProbableMatch
              ? "Da GCAL - persone diverse"
              : importedFromGoogleCalendar
              ? "Import Google Calendar"
              : linkedAsAlreadyImported
              ? "Da GCAL"
              : "—"
          }
        />
      </div>

      <div className="mt-4 space-y-3">
        {linkedAsGoogleCancelled && !isCancelledBooking ? (
          <NotesBox tone="red">
            Attenzione: l’evento Google Calendar collegato a questa prenotazione
            è stato cancellato. La prenotazione Todo Manager è ancora attiva e
            va controllata manualmente.
          </NotesBox>
        ) : linkedAsProbableMatch ? (
          <NotesBox tone="amber">
            Abbinamento probabile: stessa ora, stessa esperienza e stesso canale,
            ma i dati non coincidono completamente. Controllare prima di
            importare o modificare.
          </NotesBox>
        ) : linkedAsAlreadyImported ? (
          <NotesBox tone="amber">
            Evidenziata perché negli eventi Google Calendar risulta già
            importata con questa prenotazione Todo Manager.
          </NotesBox>
        ) : null}

        <NotesBox tone={tone}>
          {booking.notes || "Nessuna nota interna presente."}
        </NotesBox>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href={bookingEditHref(booking.id, selectedDate)}
          className="rounded-xl bg-zinc-900 px-3 py-2 text-xs font-black text-white shadow-sm hover:bg-zinc-800"
        >
          Modifica
        </Link>

        {!isCancelledBooking ? (
          <form action={cancelBooking} className="inline-block">
            <input type="hidden" name="id" value={booking.id} />
            <button
              type="submit"
              className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-black text-red-700 shadow-sm hover:bg-red-100"
            >
              Cancella
            </button>
          </form>
        ) : null}
      </div>
    </div>
  );
}

function EmptyTodoCard({ googleRow }: { googleRow?: ComputedStagingRow }) {
  const isCancelledByGoogle = googleRow?.computedStatus === "gcal_cancelled";

  return (
    <div
      className={`flex h-full min-h-[320px] flex-col justify-center rounded-2xl border border-dashed p-5 text-center ${
        isCancelledByGoogle
          ? "border-red-300 bg-red-50/40"
          : "border-zinc-300 bg-zinc-50"
      }`}
    >
      <div className="text-lg font-black text-zinc-800">
        Nessuna prenotazione Todo Manager corrispondente
      </div>

      <div className="mx-auto mt-3 max-w-md rounded-xl border border-red-200 bg-red-50 p-3 text-left text-xs font-medium leading-relaxed text-red-800">
        Non è stata trovata una prenotazione Todo Manager probabile per questo
        evento Google Calendar. Verificare manualmente se esiste una
        prenotazione correlata o se occorrono azioni come cancellazione,
        aggiornamento o note interne.
      </div>
    </div>
  );
}

function RowActions({
  googleRow,
  todoBooking,
  selectedDate,
}: {
  googleRow?: ComputedStagingRow;
  todoBooking?: BookingRow;
  selectedDate: string;
}) {
  const status = googleRow?.computedStatus;
  const hasGoogleRow = Boolean(googleRow);

  const canImportNormal = status ? isImportable(status) : false;
  const canForceImportRow = status ? isForceImportable(status) : false;
  const canIgnoreRow = status
    ? canIgnore(status) && isActionSelectable(status)
    : false;
  const canResetRow = status ? canReset(status) : false;
  const canModifyBooking = Boolean(todoBooking);
  const canCancelBooking = Boolean(todoBooking && !todoBooking.is_cancelled);

  const statusText = status
    ? status === "possible_duplicate"
      ? "Da controllare"
      : status === "probable_match"
      ? "Da controllare - persone diverse"
      : status === "gcal_cancelled"
      ? "Cancellazione / controllo"
      : status === "pending" || status === "rolled_back"
      ? "OK / abbinabile"
      : statusLabel(status)
    : "Solo Todo Manager";

  const statusTone =
    status === "gcal_cancelled"
      ? "border-red-200 bg-red-50 text-red-800"
      : status === "possible_duplicate" ||
        status === "probable_match" ||
        status === "needs_review"
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : status === "pending" || status === "rolled_back" || status === "imported"
      ? "border-green-200 bg-green-50 text-green-800"
      : "border-zinc-200 bg-zinc-50 text-zinc-700";

  return (
    <div className="flex h-full flex-col justify-center gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
      <div
        className={`rounded-full border px-3 py-2 text-center text-xs font-black ${statusTone}`}
      >
        {statusText}
      </div>

      {hasGoogleRow ? (
        <>
          <form action={importSelectedGoogleCalendarRows}>
            <input type="hidden" name="return_date" value={selectedDate} />
            <input type="hidden" name="row_ids" value={googleRow!.id} />
            <button
              type="submit"
              disabled={!canImportNormal}
              className="w-full rounded-xl bg-green-700 px-3 py-3 text-xs font-black text-white shadow-sm hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-35"
            >
              Importa
            </button>
          </form>

          <form action={importSelectedGoogleCalendarRows}>
            <input type="hidden" name="return_date" value={selectedDate} />
            <input type="hidden" name="row_ids" value={googleRow!.id} />
            <input type="hidden" name="force_import" value="true" />
            <button
              type="submit"
              disabled={!canForceImportRow}
              className="w-full rounded-xl border border-red-200 bg-white px-3 py-3 text-xs font-black text-red-700 shadow-sm hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-35"
            >
              Importa comunque
            </button>
          </form>

          <form action={ignoreSelectedGoogleCalendarRows}>
            <input type="hidden" name="return_date" value={selectedDate} />
            <input type="hidden" name="row_ids" value={googleRow!.id} />
            <button
              type="submit"
              disabled={!canIgnoreRow}
              className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-3 text-xs font-black text-zinc-800 shadow-sm hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-35"
            >
              Ignora
            </button>
          </form>

          <form action={resetSelectedGoogleCalendarRows}>
            <input type="hidden" name="return_date" value={selectedDate} />
            <input type="hidden" name="row_ids" value={googleRow!.id} />
            <button
              type="submit"
              disabled={!canResetRow}
              className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-3 text-xs font-black text-zinc-800 shadow-sm hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-35"
            >
              Rimetti da importare
            </button>
          </form>
        </>
      ) : (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-center text-xs font-bold text-blue-800">
          Nessuna azione Google Calendar disponibile.
        </div>
      )}

      {canModifyBooking ? (
        <Link
          href={bookingEditHref(todoBooking!.id, selectedDate)}
          className="w-full rounded-xl bg-zinc-900 px-3 py-3 text-center text-xs font-black text-white shadow-sm hover:bg-zinc-800"
        >
          Modifica prenotazione
        </Link>
      ) : (
        <button
          type="button"
          disabled
          className="w-full cursor-not-allowed rounded-xl bg-zinc-200 px-3 py-3 text-xs font-black text-zinc-500 opacity-60"
        >
          Modifica prenotazione
        </button>
      )}

      {canCancelBooking ? (
        <form action={cancelBooking}>
          <input type="hidden" name="id" value={todoBooking!.id} />
          <button
            type="submit"
            className="w-full rounded-xl border border-red-200 bg-red-50 px-3 py-3 text-xs font-black text-red-700 shadow-sm hover:bg-red-100"
          >
            Cancella prenotazione
          </button>
        </form>
      ) : (
        <button
          type="button"
          disabled
          className="w-full cursor-not-allowed rounded-xl border border-zinc-200 bg-white px-3 py-3 text-xs font-black text-zinc-400 opacity-60"
        >
          Cancella prenotazione
        </button>
      )}
    </div>
  );
}

export default async function GoogleCalendarImportPage({
  searchParams,
}: PageProps) {
  const params = await searchParams;
  const selectedDate = getParam(params.date) || todayRome();

  const { data: stagingData, error: stagingError } = await supabaseServer
    .from("google_calendar_import_staging")
    .select(
      "id, booking_date, booking_time, booking_reference, customer_name, adults, children, infants, experience_id, channel_id, booking_source, notes, gcal_uid, original_title, import_status, imported_booking_id, gcal_updated_at, gcal_html_link"
    )
    .eq("booking_date", selectedDate)
    .order("booking_time", { ascending: true })
    .order("id", { ascending: true });

  const stagingRows = (stagingData ?? []) as StagingRow[];

  const { data: bookingsData } = await supabaseServer
    .from("bookings")
    .select(
      "id, booking_reference, booking_time, experience_id, channel_id, adults, children, infants, customer_name, experience_name, booking_source, notes, business_unit_id, is_cancelled"
    )
    .eq("booking_date", selectedDate)
    .order("booking_time", { ascending: true })
    .order("id", { ascending: true });

  const existingBookings = (bookingsData ?? []) as BookingRow[];

  const experienceIds = Array.from(
    new Set(
      stagingRows
        .map((row) => row.experience_id)
        .filter((id): id is number => typeof id === "number")
    )
  );

  const channelIds = Array.from(
    new Set(
      stagingRows
        .map((row) => row.channel_id)
        .filter((id): id is number => typeof id === "number")
    )
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
  const probableMatchMap = new Map<string, BookingRow[]>();

  for (const booking of existingBookings) {
    if (booking.is_cancelled) continue;

    duplicateKeyMap.set(buildPossibleDuplicateKey(booking), booking);

    const probableKey = buildProbableMatchKey(booking);
    const existingList = probableMatchMap.get(probableKey) ?? [];
    existingList.push(booking);
    probableMatchMap.set(probableKey, existingList);
  }

  const rowsWithComputedStatus: ComputedStagingRow[] = stagingRows.map((row) => {
    const existingByReference = existingReferenceMap.get(row.booking_reference);
    const existingByImportedId = row.imported_booking_id
      ? existingIdMap.get(row.imported_booking_id)
      : undefined;
    const possibleDuplicate = duplicateKeyMap.get(buildPossibleDuplicateKey(row));

    const probableMatch = getBestProbableMatch(
      row,
      probableMatchMap.get(buildProbableMatchKey(row))
    );

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
    } else if (
      (row.import_status === "pending" || row.import_status === "rolled_back") &&
      probableMatch
    ) {
      computedStatus = "probable_match";
      matchedBooking = probableMatch;
      matchReason = "stessa ora, esperienza e canale, ma persone diverse";
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

  const probableMatchLinkedBookingIds = new Set(
    rowsWithComputedStatus
      .filter(
        (row) => row.computedStatus === "probable_match" && row.matchedBooking?.id
      )
      .map((row) => row.matchedBooking!.id)
  );

  const matchedBookingIds = new Set(
    rowsWithComputedStatus
      .filter((row) => row.matchedBooking?.id)
      .map((row) => row.matchedBooking!.id)
  );

  const comparisonRows: ComparisonRow[] = [
    ...rowsWithComputedStatus.map((row) => ({
      id: `gcal-${row.id}`,
      googleRow: row,
      todoBooking: row.matchedBooking,
    })),
    ...existingBookings
      .filter((booking) => !matchedBookingIds.has(booking.id))
      .map((booking) => ({
        id: `todo-${booking.id}`,
        todoBooking: booking,
      })),
  ];

  return (
    <AppShell
      title="Import Google Calendar"
      subtitle="Controllo storico per giorno: ogni riga confronta Google Calendar e Todo Manager"
    >
      <div className="space-y-6">
        <SectionCard title="Seleziona giorno">
          <form
            method="get"
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
          >
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-700">
                Giorno esperienza da controllare
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
          <div className="mb-5 grid gap-3 md:grid-cols-5">
            <MetricCard label="Google Calendar" value={googleCount} tone="zinc" />
            <MetricCard label="Todo Manager" value={todoCount} tone="blue" />
            <MetricCard label="Importabili" value={importableCount} tone="green" />
            <MetricCard
              label="Possibili / probabili"
              value={forceImportableCount}
              tone="amber"
            />
            <MetricCard
              label="Cancellate GCal"
              value={cancelledGoogleCount}
              tone="red"
            />
          </div>

          {stagingError ? (
            <div className="rounded-xl bg-red-50 p-4 text-sm text-red-800">
              Errore lettura staging: {stagingError.message}
            </div>
          ) : comparisonRows.length === 0 ? (
            <div className="rounded-xl bg-white p-4 text-sm text-zinc-600">
              Nessun evento Google Calendar e nessuna prenotazione Todo Manager
              trovata per questa data.
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
              <div className="hidden border-b border-zinc-200 bg-zinc-50 xl:grid xl:grid-cols-[minmax(0,1fr)_220px_minmax(0,1fr)]">
                <div className="px-4 py-3 text-center text-sm font-black text-zinc-900">
                  Evento Google Calendar
                </div>
                <div className="border-x border-zinc-200 px-4 py-3 text-center text-sm font-black text-zinc-900">
                  Azioni
                </div>
                <div className="px-4 py-3 text-center text-sm font-black text-zinc-900">
                  Prenotazione Todo Manager probabile
                </div>
              </div>

              <div className="divide-y divide-zinc-200">
                {comparisonRows.map((comparisonRow) => {
                  const googleRow = comparisonRow.googleRow;
                  const todoBooking = comparisonRow.todoBooking;

                  const experienceName =
                    googleRow?.experience_id !== null &&
                    googleRow?.experience_id !== undefined
                      ? experienceMap.get(googleRow.experience_id) ??
                        `ID ${googleRow.experience_id}`
                      : "Da verificare";

                  const channelName =
                    googleRow?.channel_id !== null &&
                    googleRow?.channel_id !== undefined
                      ? channelMap.get(googleRow.channel_id) ??
                        `ID ${googleRow.channel_id}`
                      : "Da verificare";

                  const importedFromGoogleCalendar = todoBooking
                    ? importedBookingIdsFromGoogle.has(todoBooking.id)
                    : false;

                  const linkedAsAlreadyImported = todoBooking
                    ? alreadyImportedLinkedBookingIds.has(todoBooking.id)
                    : false;

                  const linkedAsGoogleCancelled = todoBooking
                    ? googleCancelledLinkedBookingIds.has(todoBooking.id)
                    : false;

                  const linkedAsProbableMatch = todoBooking
                    ? probableMatchLinkedBookingIds.has(todoBooking.id)
                    : false;

                  return (
                    <div
                      key={comparisonRow.id}
                      className={`grid gap-3 border-l-4 p-3 xl:grid-cols-[minmax(0,1fr)_220px_minmax(0,1fr)] ${rowToneClass(
                        googleRow?.computedStatus,
                        !googleRow && Boolean(todoBooking)
                      )}`}
                    >
                      <div>
                        <div className="mb-2 text-xs font-black uppercase tracking-wide text-zinc-500 xl:hidden">
                          Evento Google Calendar
                        </div>

                        {googleRow ? (
                          <GoogleCalendarCard
                            row={googleRow}
                            experienceName={experienceName}
                            channelName={channelName}
                          />
                        ) : (
                          <EmptyGoogleCard />
                        )}
                      </div>

                      <div>
                        <div className="mb-2 text-xs font-black uppercase tracking-wide text-zinc-500 xl:hidden">
                          Azioni
                        </div>

                        <RowActions
                          googleRow={googleRow}
                          todoBooking={todoBooking}
                          selectedDate={selectedDate}
                        />
                      </div>

                      <div>
                        <div className="mb-2 text-xs font-black uppercase tracking-wide text-zinc-500 xl:hidden">
                          Prenotazione Todo Manager probabile
                        </div>

                        {todoBooking ? (
                          <TodoBookingCard
                            booking={todoBooking}
                            selectedDate={selectedDate}
                            importedFromGoogleCalendar={
                              importedFromGoogleCalendar
                            }
                            linkedAsAlreadyImported={linkedAsAlreadyImported}
                            linkedAsGoogleCancelled={linkedAsGoogleCancelled}
                            linkedAsProbableMatch={linkedAsProbableMatch}
                          />
                        ) : (
                          <EmptyTodoCard googleRow={googleRow} />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </SectionCard>
      </div>
    </AppShell>
  );
}