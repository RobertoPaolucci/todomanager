export const dynamic = "force-dynamic";

import Link from "next/link";
import { supabase } from "@/lib/supabase";
import PrintPdfButton from "@/components/PrintPdfButton";

type PageProps = {
  searchParams: Promise<{
    ids?: string | string[];
  }>;
};

function formatDateOnly(value: string | null) {
  if (!value) return "-";
  const clean = value.slice(0, 10);
  const [year, month, day] = clean.split("-");
  if (!year || !month || !day) return "-";
  return `${day}/${month}/${year}`;
}

function formatTime(value: string | null) {
  if (!value) return "-";
  return value.slice(0, 5);
}

function formatBookingCreatedDate(value: string | null) {
  if (!value) return "-";

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return formatDateOnly(value);
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  return new Intl.DateTimeFormat("it-IT", {
    timeZone: "Europe/Rome",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function formatDocumentCreatedAt(date: Date) {
  return new Intl.DateTimeFormat("it-IT", {
    timeZone: "Europe/Rome",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function getChannelName(booking: any) {
  if (Array.isArray(booking.channels)) {
    return booking.channels[0]?.name || booking.booking_source || "-";
  }
  return booking.channels?.name || booking.booking_source || "-";
}

export default async function PrenotazioniRiepilogoPage({
  searchParams,
}: PageProps) {
  const params = await searchParams;
  const idsParam = params.ids;

  const ids = Array.isArray(idsParam) ? idsParam : idsParam ? [idsParam] : [];

  const selectedIds = Array.from(
    new Set(
      ids
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id) && id > 0)
    )
  );

  const documentCreatedAt = new Date();

  if (selectedIds.length === 0) {
    return (
      <div className="bg-zinc-100 px-4 py-8 text-zinc-900">
        <div className="mx-auto max-w-3xl rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="mb-4 text-2xl font-black">Riepilogo prenotazioni</div>
          <p className="text-sm text-zinc-600">
            Non hai selezionato nessuna prenotazione.
          </p>

          <div className="mt-6">
            <Link
              href="/prenotazioni"
              className="inline-flex items-center rounded-xl bg-zinc-900 px-4 py-3 text-sm font-bold text-white hover:bg-zinc-700"
            >
              Torna a Prenotazioni
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const { data: bookings, error } = await supabase
    .from("bookings")
    .select(
      "id, booking_date, booking_time, booking_created_at, customer_name, booking_reference, booking_source, experience_name, total_people, adults, children, infants, channels(name)"
    )
    .in("id", selectedIds);

  if (error) {
    return (
      <div className="bg-zinc-100 px-4 py-8 text-zinc-900">
        <div className="mx-auto max-w-3xl rounded-3xl border border-red-200 bg-white p-6 shadow-sm">
          <div className="mb-4 text-2xl font-black text-red-700">
            Errore nel caricamento
          </div>
          <p className="text-sm text-zinc-600">{error.message}</p>

          <div className="mt-6">
            <Link
              href="/prenotazioni"
              className="inline-flex items-center rounded-xl bg-zinc-900 px-4 py-3 text-sm font-bold text-white hover:bg-zinc-700"
            >
              Torna a Prenotazioni
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const rows = (bookings || []).map((booking) => {
    const totalPeople =
      Number(booking.total_people || 0) ||
      Number(booking.adults || 0) +
        Number(booking.children || 0) +
        Number(booking.infants || 0);

    return {
      ...booking,
      totalPeople,
      channelName: getChannelName(booking),
      experienceType: booking.experience_name || "-",
    };
  });

  rows.sort((a, b) => {
    const dateA = `${a.booking_date || ""} ${a.booking_time || ""}`.trim();
    const dateB = `${b.booking_date || ""} ${b.booking_time || ""}`.trim();

    if (dateA < dateB) return -1;
    if (dateA > dateB) return 1;

    const nameA = (a.customer_name || "").toLowerCase();
    const nameB = (b.customer_name || "").toLowerCase();

    if (nameA < nameB) return -1;
    if (nameA > nameB) return 1;
    return 0;
  });

  const totalBookings = rows.length;
  const totalPeople = rows.reduce((sum, booking) => sum + booking.totalPeople, 0);

  return (
    <div className="bg-zinc-100 px-4 py-6 text-zinc-900 print:bg-white print:px-0 print:py-0">
      <style>{`
        @page {
          size: A4 landscape;
          margin: 10mm;
        }

        @media print {
          .no-print {
            display: none !important;
          }

          html, body {
            margin: 0 !important;
            padding: 0 !important;
            background: white !important;
          }

          .print-wrapper {
            margin: 0 !important;
            padding: 0 !important;
            border: 0 !important;
            box-shadow: none !important;
            border-radius: 0 !important;
            max-width: none !important;
          }

          .print-table-wrap {
            overflow: visible !important;
          }

          table {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
          }

          thead {
            display: table-header-group;
          }

          tr, td, th {
            page-break-inside: avoid;
          }
        }
      `}</style>

      <div className="print-wrapper mx-auto max-w-7xl rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm print:p-0">
        <div className="no-print mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Link
            href="/prenotazioni"
            className="inline-flex items-center justify-center rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm font-bold text-zinc-700 hover:bg-zinc-100"
          >
            ← Torna a Prenotazioni
          </Link>

          <PrintPdfButton />
        </div>

        <div className="border-b border-zinc-200 pb-5">
          <div className="text-3xl font-black tracking-tight">
            Riepilogo Prenotazioni
          </div>
          <div className="mt-2 text-sm text-zinc-500">
            Documento creato il {formatDocumentCreatedAt(documentCreatedAt)}
          </div>
        </div>

        <div className="print-table-wrap mt-6 overflow-x-auto">
          <table className="w-full table-fixed border-collapse text-[12px]">
            <thead>
              <tr className="border-b-2 border-zinc-900 text-[10px] font-black uppercase tracking-wide text-zinc-700">
                <th className="w-[80px] px-2 py-3 text-right">Num clienti</th>
                <th className="w-[150px] px-2 py-3">Data e ora esperienza</th>
                <th className="w-[160px] px-2 py-3">Nome cliente</th>
                <th className="w-[150px] px-2 py-3">Rif prenotazione</th>
                <th className="w-[130px] px-2 py-3">Canale prenotazione</th>
                <th className="w-[180px] px-2 py-3">Tipo esperienza</th>
                <th className="w-[130px] px-2 py-3">Data prenotazione</th>
              </tr>
            </thead>

            <tbody>
              {rows.map((booking) => (
                <tr key={booking.id} className="border-b border-zinc-200">
                  <td className="px-2 py-3 text-right font-black">
                    {booking.totalPeople}
                  </td>

                  <td className="px-2 py-3 align-top font-medium">
                    {formatDateOnly(booking.booking_date)}
                    {formatTime(booking.booking_time) !== "-" && (
                      <span className="block text-zinc-500">
                        ore {formatTime(booking.booking_time)}
                      </span>
                    )}
                  </td>

                  <td className="break-words px-2 py-3 align-top">
                    {booking.customer_name || "-"}
                  </td>

                  <td className="break-words px-2 py-3 align-top font-mono text-[11px]">
                    {booking.booking_reference || "-"}
                  </td>

                  <td className="break-words px-2 py-3 align-top">
                    {booking.channelName || "-"}
                  </td>

                  <td className="break-words px-2 py-3 align-top">
                    {booking.experienceType || "-"}
                  </td>

                  <td className="px-2 py-3 align-top">
                    {formatBookingCreatedDate(booking.booking_created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-8 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
            <div className="text-[11px] font-bold uppercase tracking-wide text-zinc-500">
              Numero di prenotazioni
            </div>
            <div className="mt-2 text-2xl font-black text-zinc-900">
              {totalBookings}
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
            <div className="text-[11px] font-bold uppercase tracking-wide text-zinc-500">
              Persone totali
            </div>
            <div className="mt-2 text-2xl font-black text-zinc-900">
              {totalPeople}
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
            <div className="text-[11px] font-bold uppercase tracking-wide text-zinc-500">
              Data creazione documento
            </div>
            <div className="mt-2 text-lg font-black text-zinc-900">
              {formatDocumentCreatedAt(documentCreatedAt)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}