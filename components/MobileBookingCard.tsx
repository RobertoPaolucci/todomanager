"use client";

import { useState } from "react";
import Link from "next/link";
import { cancelBooking, clearAlert } from "@/app/prenotazioni/actions";

function formatEuro(value: number) {
  return new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR",
  }).format(value);
}

function formatDate(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

function getBusinessUnitLabel(code: string | null | undefined) {
  if (code === "fmdq") return "FMDQ";
  if (code === "todointheworld") return "Todo";
  return code ? code.toUpperCase() : "-";
}

function getBusinessUnitBadgeClass(code: string | null | undefined) {
  if (code === "fmdq") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (code === "todointheworld") {
    return "border-violet-200 bg-violet-50 text-violet-700";
  }
  return "border-zinc-200 bg-zinc-50 text-zinc-600";
}

type Props = {
  booking: any;
  highlightId?: string;
  todayStr: string;
  tomorrowStr: string;
};

export default function MobileBookingCard({
  booking,
  highlightId = "",
  todayStr,
  tomorrowStr,
}: Props) {
  const [showPayments, setShowPayments] = useState(false);

  const isCancelled = booking.is_cancelled === true;
  const isHighlighted = String(booking.id) === highlightId;
  const isModifiedPermanent = booking.was_modified === true;
  const businessUnitCode = booking._business_unit_code;
  const isInternalSupplier = booking._is_internal_supplier === true;

  const bookingChannelName = Array.isArray(booking.channels)
    ? booking.channels[0]?.name || booking.booking_source || ""
    : booking.channels?.name || booking.booking_source || "";

  const customerStatus = booking.customer_payment_status;
  let customerBadgeClass = "bg-red-100 text-red-700";
  let customerBadgeText = "Da incassare";
  if (customerStatus === "paid") {
    customerBadgeClass = "bg-green-100 text-green-700";
    customerBadgeText = "Incassato";
  } else if (customerStatus === "partial") {
    customerBadgeClass = "bg-blue-100 text-blue-700";
    customerBadgeText = "Acconto";
  }

  const costoFornitore = Number(booking.total_supplier_cost || 0);
  const pagatoFornitore = Number(booking.supplier_amount_paid || 0);

  const isSupplierPaid =
    isInternalSupplier ||
    booking.supplier_payment_status === "paid" ||
    (pagatoFornitore > 0 && pagatoFornitore >= costoFornitore);

  const isSupplierPartial =
    !isInternalSupplier &&
    pagatoFornitore > 0 &&
    pagatoFornitore < costoFornitore &&
    booking.supplier_payment_status !== "paid";

  let supplierBadgeClass = "bg-red-100 text-red-700";
  let supplierBadgeText = "Da saldare";
  if (isInternalSupplier) {
    supplierBadgeClass = "bg-emerald-100 text-emerald-700";
    supplierBadgeText = "Auto-saldato";
  } else if (isSupplierPaid) {
    supplierBadgeClass = "bg-green-100 text-green-700";
    supplierBadgeText = "Pagato";
  } else if (isSupplierPartial) {
    supplierBadgeClass = "bg-blue-100 text-blue-700";
    supplierBadgeText = "Parziale";
  }

  const payingPax = Number(booking.adults || 0) + Number(booking.children || 0);
  const nonPayingAdults = Number(booking.non_paying_adults || 0);
  const totalSeats = Number(
    booking.total_people || payingPax + Number(booking.infants || 0) + nonPayingAdults
  );

  const wDate = formatDate(booking.booking_date);
  const wTime = booking.booking_time
    ? booking.booking_time.slice(0, 5)
    : "Orario da def.";
  const wChannel = bookingChannelName || "N/A";
  const wRef = booking.booking_reference || "-";
  const wName = booking.customer_name || "N/A";
  const waText = `${payingPax} da te ${wDate} ore ${wTime} ${wChannel} ${wRef} ${wName}`;

  const rawSupplier = booking.suppliers;
  let rawPhone = "";
  if (Array.isArray(rawSupplier)) {
    rawPhone = rawSupplier[0]?.phone || "";
  } else if (rawSupplier) {
    rawPhone = rawSupplier.phone || "";
  }

  const cleanSupplierPhone = rawSupplier ? rawPhone.replace(/\D/g, "") : "";
  const waUrl = cleanSupplierPhone
    ? `https://api.whatsapp.com/send?phone=${cleanSupplierPhone}&text=${encodeURIComponent(
        waText
      )}`
    : `https://api.whatsapp.com/send?text=${encodeURIComponent(waText)}`;

  const customerPhoneRaw = String(booking.customer_phone || "").trim();
  const customerPhoneDigits = customerPhoneRaw.replace(/\D/g, "");
  const customerPhoneHref = customerPhoneDigits
    ? `tel:${customerPhoneDigits}`
    : "";

  let dateColorClass = "text-zinc-900";
  let isToday = false;
  let isTomorrow = false;
  if (isCancelled) {
    dateColorClass = "text-zinc-500 line-through";
  } else if (booking.booking_date === todayStr) {
    dateColorClass = "text-green-600";
    isToday = true;
  } else if (booking.booking_date === tomorrowStr) {
    dateColorClass = "text-orange-500";
    isTomorrow = true;
  }

  const hasAlert =
    booking.notes &&
    (booking.notes.includes("🔴") ||
      booking.notes.includes("🟡") ||
      booking.notes.includes("🟢"));

  return (
    <div
      className={`overflow-hidden rounded-2xl border shadow-sm transition ${
        isHighlighted
          ? "border-amber-300 bg-amber-50 ring-2 ring-amber-200"
          : isCancelled
          ? "border-zinc-200 bg-zinc-50/70"
          : "border-zinc-200 bg-white"
      }`}
    >
      <div className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className={`text-[24px] font-black leading-none ${dateColorClass}`}>
                {wDate}
              </div>

              {isToday && (
                <span className="rounded-full bg-green-100 px-2.5 py-1 text-[12px] font-black uppercase text-green-700">
                  Oggi
                </span>
              )}

              {isTomorrow && (
                <span className="rounded-full bg-orange-100 px-2.5 py-1 text-[12px] font-black uppercase text-orange-700">
                  Domani
                </span>
              )}

              {booking.booking_time && (
                <span
                  className={`rounded-lg px-2.5 py-1 text-[16px] font-black ${
                    isCancelled
                      ? "bg-zinc-200 text-zinc-400"
                      : "bg-blue-50 text-blue-700"
                  }`}
                >
                  {booking.booking_time.slice(0, 5)}
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-lg border border-zinc-200 bg-zinc-100 px-2.5 py-1 text-[15px] font-bold text-zinc-800">
                {wChannel}
              </span>

              <span
                className={`rounded-lg border px-2.5 py-1 text-[15px] font-bold ${getBusinessUnitBadgeClass(
                  businessUnitCode
                )}`}
              >
                {getBusinessUnitLabel(businessUnitCode)}
              </span>

              <span className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-[15px] font-bold text-zinc-700">
                {payingPax} paganti
              </span>

              {nonPayingAdults > 0 && (
                <span className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-[15px] font-bold text-amber-700">
                  + {nonPayingAdults} guide
                </span>
              )}

              <span className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-[15px] font-bold text-zinc-700">
                {totalSeats} posti
              </span>

              {isModifiedPermanent && !isCancelled && (
                <span className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-bold uppercase text-amber-700">
                  Modificata
                </span>
              )}
            </div>

            <div className="text-[13px] text-zinc-500">
              Inserita: {formatDate(booking.booking_created_at)}
            </div>
          </div>

          <div className="shrink-0 text-right">
            <div className="text-[24px] font-black leading-none text-zinc-900">
              {formatEuro(Number(booking.total_customer || 0))}
            </div>

            {!isCancelled && (
              <button
                type="button"
                onClick={() => setShowPayments((prev) => !prev)}
                className="mt-1 text-[12px] font-bold text-zinc-600 underline underline-offset-2"
              >
                {showPayments ? "Nascondi pagamenti" : "Vedi pagamenti"}
              </button>
            )}
          </div>
        </div>

        <div className="space-y-1">
          <div
            className={`text-[22px] font-bold leading-tight ${
              isCancelled ? "text-zinc-500 line-through" : "text-zinc-900"
            }`}
          >
            {booking.customer_name || "-"}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {customerPhoneRaw ? (
              <a
                href={customerPhoneHref}
                className="rounded-lg bg-zinc-100 px-2.5 py-1 text-[15px] font-bold text-zinc-800"
              >
                {customerPhoneRaw}
              </a>
            ) : null}

            <span className="rounded-lg bg-zinc-50 px-2.5 py-1 text-[15px] font-bold text-zinc-700">
              Rif. {wRef}
            </span>
          </div>
        </div>

        <div className="rounded-xl bg-zinc-50 px-3 py-3 text-[18px] text-zinc-800">
          {booking.experience_name || "-"}
        </div>

        <div className="rounded-xl border border-zinc-100 bg-zinc-50 px-3 py-3">
          <div className="text-[12px] font-bold uppercase text-zinc-400">
            Posti e conteggio
          </div>
          <div className="mt-2 text-[15px] font-medium text-zinc-700">
            {payingPax} paganti
            {nonPayingAdults > 0 ? ` + ${nonPayingAdults} guide/autisti` : ""}
            {" = "}
            {totalSeats} posti totali
          </div>
        </div>

        {showPayments && (
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-zinc-100 bg-zinc-50 p-4">
              <div className="text-[12px] font-bold uppercase text-zinc-400">
                Pag. Agenzia
              </div>
              <div
                className={`mt-3 inline-flex rounded-xl px-3 py-1.5 text-[14px] font-bold uppercase ${
                  isCancelled ? "bg-zinc-200 text-zinc-400" : customerBadgeClass
                }`}
              >
                {isCancelled ? "-" : customerBadgeText}
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-100 bg-zinc-50 p-4">
              <div className="text-[12px] font-bold uppercase text-zinc-400">
                Pag. Fornitore
              </div>
              <div
                className={`mt-3 inline-flex rounded-xl px-3 py-1.5 text-[14px] font-bold uppercase ${
                  isCancelled ? "bg-zinc-200 text-zinc-400" : supplierBadgeClass
                }`}
              >
                {isCancelled ? "-" : supplierBadgeText}
              </div>
            </div>
          </div>
        )}

        <div>
          <div className="mb-2 text-[13px] font-bold uppercase text-zinc-400">
            Note / Alert
          </div>

          {hasAlert ? (
            <form action={clearAlert}>
              <input type="hidden" name="id" value={booking.id} />
              <button
                type="submit"
                title="Segna alert come letto"
                className={`w-full rounded-xl px-3 py-3 text-left text-[14px] font-bold leading-tight transition ${
                  booking.notes.includes("🔴")
                    ? "bg-red-50 text-red-700 hover:bg-red-100"
                    : booking.notes.includes("🟡")
                    ? "bg-amber-50 text-amber-700 hover:bg-amber-100"
                    : "bg-green-50 text-green-700 hover:bg-green-100"
                }`}
              >
                <div>{booking.notes}</div>
                <div className="mt-1 text-[12px] font-medium underline opacity-80">
                  Segna come letto
                </div>
              </button>
            </form>
          ) : (
            <div className="rounded-xl border border-zinc-100 bg-zinc-50 px-3 py-3 text-[15px] text-zinc-600">
              {booking.notes || "-"}
            </div>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2 border-t border-zinc-100 pt-3">
          <Link
            href={`/prenotazioni/${booking.id}/modifica?returnTo=/prenotazioni`}
            className="flex min-h-10 items-center justify-center rounded-xl border border-zinc-300 bg-white px-2 py-2 text-[14px] font-bold text-zinc-700 shadow-sm hover:bg-zinc-100"
          >
            Modifica
          </Link>

          {!isCancelled && (
            <a
              href={waUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`flex min-h-10 items-center justify-center rounded-xl border px-2 py-2 text-[14px] font-bold shadow-sm transition ${
                cleanSupplierPhone
                  ? "border-green-200 bg-green-50 text-green-700 hover:bg-green-100"
                  : "border-zinc-200 bg-zinc-50 text-zinc-400 hover:bg-zinc-100"
              }`}
            >
              WhatsApp
            </a>
          )}

          {!isCancelled && (
            <form action={cancelBooking} className="w-full">
              <input type="hidden" name="id" value={booking.id} />
              <button
                type="submit"
                className="flex min-h-10 w-full items-center justify-center rounded-xl border border-red-200 bg-red-50 px-2 py-2 text-[14px] font-bold text-red-700 shadow-sm hover:bg-red-100"
              >
                Cancella
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}