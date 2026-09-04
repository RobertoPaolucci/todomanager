export const dynamic = "force-dynamic";

import Link from "next/link";
import AppShell from "@/components/AppShell";
import InvoiceReportButton, {
  type InvoiceReportRow,
} from "@/components/InvoiceReportButton";
import SectionCard from "@/components/SectionCard";
import { supabaseServer } from "@/lib/supabase-server";
import { saveFmdqInvoice } from "./actions";

type PageProps = {
  searchParams: Promise<{
    month?: string;
  }>;
};

type ChannelGroup = {
  channelId: number;
  channelName: string;
  companyName: string;
  bookings: any[];
  total: number;
  totalAdults: number;
  totalChildren: number;
  totalPeople: number;
};

type InvoiceReportBooking = {
  experience_id?: number | string | null;
  experience_name?: string | null;
  adults?: number | string | null;
  children?: number | string | null;
  _adult_unit_cost?: number | null;
  _child_unit_cost?: number | null;
  _adult_amount?: number | null;
  _child_amount?: number | null;
};

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
  }).format(new Date(`${value}T12:00:00`));
}

function formatMonthLabel(month: string) {
  const [year, monthNumber] =
    month.split("-").map(Number);

  const date =
    new Date(
      year,
      monthNumber - 1,
      1
    );

  const text =
    new Intl.DateTimeFormat(
      "it-IT",
      {
        month: "long",
        year: "numeric",
      }
    ).format(date);

  return (
    text.charAt(0).toUpperCase() +
    text.slice(1)
  );
}

function getMonthBounds(month: string) {
  const [year, monthNumber] =
    month.split("-").map(Number);

  const firstDay =
    `${year}-${String(monthNumber).padStart(2, "0")}-01`;

  const lastDayDate =
    new Date(year, monthNumber, 0);

  const lastDay =
    `${year}-${String(monthNumber).padStart(2, "0")}-${String(
      lastDayDate.getDate()
    ).padStart(2, "0")}`;

  return {
    firstDay,
    lastDay,
  };
}

function changeMonth(
  month: string,
  offset: number
) {
  const [year, monthNumber] =
    month.split("-").map(Number);

  const date =
    new Date(
      year,
      monthNumber - 1 + offset,
      1
    );

  return `${date.getFullYear()}-${String(
    date.getMonth() + 1
  ).padStart(2, "0")}`;
}

function getChannelData(booking: any) {
  if (Array.isArray(booking.channels)) {
    return booking.channels[0] || null;
  }

  return booking.channels || null;
}

function getSupplierData(booking: any) {
  if (Array.isArray(booking.suppliers)) {
    return booking.suppliers[0] || null;
  }

  return booking.suppliers || null;
}

function isFmdqSupplier(booking: any) {
  const supplier =
    getSupplierData(booking);

  const supplierId =
    Number(
      booking.supplier_id ||
        supplier?.id ||
        0
    );

  const supplierName =
    String(
      supplier?.name || ""
    )
      .trim()
      .toLowerCase();

  if (supplierId === 0) return true;
  if (supplierName === "fmdq") return true;

  if (
    supplierName ===
    "fattoria madonna della querce"
  ) {
    return true;
  }

  if (
    supplierName.includes(
      "madonna della querce"
    )
  ) {
    return true;
  }

  return false;
}

function getBookingHistoryKey(booking: any) {
  const reference =
    String(
      booking.booking_reference ||
        ""
    ).trim();

  if (reference) {
    return reference.toUpperCase();
  }

  return `NO-REF-${booking.id}`;
}

function getLatestBookings(bookings: any[]) {
  const groups =
    new Map<string, any[]>();

  for (const booking of bookings) {
    const key =
      getBookingHistoryKey(booking);

    const list =
      groups.get(key) || [];

    list.push(booking);

    groups.set(
      key,
      list
    );
  }

  return Array.from(
    groups.values()
  ).map((versions) => {
    return [...versions].sort(
      (a, b) =>
        Number(b.id || 0) -
        Number(a.id || 0)
    )[0];
  });
}

function getAdults(booking: any) {
  return Number(
    booking.adults || 0
  );
}

function getChildren(booking: any) {
  return Number(
    booking.children || 0
  );
}

function getInfants(booking: any) {
  return Number(
    booking.infants || 0
  );
}

function getTotalPeople(booking: any) {
  return (
    getAdults(booking) +
    getChildren(booking) +
    getInfants(booking)
  );
}

function optionalNumber(
  value: unknown
): number | null {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const numberValue =
    Number(value);

  if (
    !Number.isFinite(numberValue)
  ) {
    return null;
  }

  return numberValue;
}

function getInvoiceReportRows(
  bookings: InvoiceReportBooking[]
): InvoiceReportRow[] {
  const rows = new Map<
    string,
    InvoiceReportRow & {
      unitPrices: Set<number>;
    }
  >();

  for (const booking of bookings) {
    const experienceId = String(
      booking.experience_id || booking.experience_name || "-"
    );
    const experience = String(
      booking.experience_name || "Esperienza non indicata"
    );

    const categories = [
      {
        key: "adults",
        label: "Adulti" as const,
        quantity: getAdults(booking),
        unitPrice: Number(booking._adult_unit_cost || 0),
        amount: Number(booking._adult_amount || 0),
      },
      {
        key: "children",
        label: "Bambini" as const,
        quantity: getChildren(booking),
        unitPrice: Number(booking._child_unit_cost || 0),
        amount: Number(booking._child_amount || 0),
      },
    ];

    for (const category of categories) {
      if (category.quantity <= 0) continue;

      const key = `${experienceId}:${category.key}`;
      const current = rows.get(key);

      if (current) {
        current.quantity += category.quantity;
        current.total += category.amount;
        current.unitPrices.add(category.unitPrice);
      } else {
        rows.set(key, {
          key,
          experience,
          category: category.label,
          quantity: category.quantity,
          unitPrice: category.unitPrice,
          total: category.amount,
          unitPrices: new Set([category.unitPrice]),
        });
      }
    }
  }

  return Array.from(rows.values())
    .sort((a, b) => {
      const experienceCompare = a.experience.localeCompare(
        b.experience,
        "it"
      );

      if (experienceCompare !== 0) return experienceCompare;
      return a.category === "Adulti" ? -1 : 1;
    })
    .map(({ unitPrices, ...row }) => ({
      ...row,
      unitPrice: unitPrices.size === 1 ? row.unitPrice : null,
    }));
}

export default async function FatturazioneFmdqPage({
  searchParams,
}: PageProps) {
  const params =
    await searchParams;

  const now =
    new Date();

  const currentMonth =
    `${now.getFullYear()}-${String(
      now.getMonth() + 1
    ).padStart(2, "0")}`;

  const currentInvoiceYear =
    String(
      now.getFullYear()
    ).slice(-2);

  const defaultInvoiceNumber =
    `FPR /${currentInvoiceYear}`;

  const month =
    /^\d{4}-\d{2}$/.test(
      String(
        params.month || ""
      )
    )
      ? String(
          params.month
        )
      : currentMonth;

  const {
    firstDay,
    lastDay,
  } =
    getMonthBounds(month);

  const previousMonth =
    changeMonth(
      month,
      -1
    );

  const nextMonth =
    changeMonth(
      month,
      1
    );

  const invoiceMonth =
    `${month}-01`;

  const [
    bookingsRes,
    invoicesRes,
    pricesRes,
    experiencesRes,
  ] =
    await Promise.all([
      supabaseServer
        .from("bookings")
        .select(`
          *,
          suppliers(
            id,
            name
          ),
          channels(
            id,
            name,
            company_name,
            fattura_mensile_fmdq
          )
        `)
        .gte(
          "booking_date",
          firstDay
        )
        .lte(
          "booking_date",
          lastDay
        ),

      supabaseServer
        .from(
          "fmdq_monthly_invoices"
        )
        .select("*")
        .eq(
          "invoice_month",
          invoiceMonth
        ),

      supabaseServer
        .from(
          "experience_channel_prices"
        )
        .select(`
          experience_id,
          channel_id,
          supplier_adult_unit_cost,
          supplier_child_unit_cost
        `),

      supabaseServer
        .from("experiences")
        .select(
          "id, name, supplier_unit_cost"
        ),
    ]);

  if (bookingsRes.error) {
    throw new Error(
      `Errore caricamento prenotazioni: ${bookingsRes.error.message}`
    );
  }

  if (invoicesRes.error) {
    throw new Error(
      `Errore caricamento fatture: ${invoicesRes.error.message}`
    );
  }

  if (pricesRes.error) {
    throw new Error(
      `Errore caricamento prezzi canale: ${pricesRes.error.message}`
    );
  }

  if (experiencesRes.error) {
    throw new Error(
      `Errore caricamento esperienze: ${experiencesRes.error.message}`
    );
  }

  const bookings =
    bookingsRes.data || [];

  const invoices =
    invoicesRes.data || [];

  const prices =
    pricesRes.data || [];

  const experiences =
    experiencesRes.data || [];

  const invoiceMap =
    new Map<string, any>();

  for (const invoice of invoices) {
    invoiceMap.set(
      String(invoice.channel_id),
      invoice
    );
  }

  const experienceMap =
    new Map<string, any>();

  for (const experience of experiences) {
    experienceMap.set(
      String(experience.id),
      experience
    );
  }

  const priceMap =
    new Map<string, any>();

  for (const price of prices) {
    priceMap.set(
      `${price.experience_id}:${price.channel_id}`,
      price
    );
  }

  const latestBookings =
    getLatestBookings(bookings);

  const invoiceBookings =
    latestBookings
      .filter((booking: any) => {
        if (
          booking.is_cancelled === true
        ) {
          return false;
        }

        const channel =
          getChannelData(booking);

        if (
          channel?.fattura_mensile_fmdq !== true
        ) {
          return false;
        }

        if (
          !isFmdqSupplier(booking)
        ) {
          return false;
        }

        return true;
      })
      .map((booking: any) => {
        const channel =
          getChannelData(booking);

        const channelId =
          Number(
            channel?.id ||
              booking.channel_id ||
              0
          );

        const experienceId =
          Number(
            booking.experience_id ||
              0
          );

        const channelPrice =
          priceMap.get(
            `${experienceId}:${channelId}`
          );

        const experience =
          experienceMap.get(
            String(experienceId)
          );

        const specificAdultCost =
          optionalNumber(
            channelPrice?.supplier_adult_unit_cost
          );

        const baseAdultCost =
          Number(
            experience?.supplier_unit_cost ||
              0
          );

        const adultUnitCost =
          specificAdultCost ??
          baseAdultCost;

        const specificChildCost =
          optionalNumber(
            channelPrice?.supplier_child_unit_cost
          );

        const childUnitCost =
          specificChildCost ??
          adultUnitCost;

        const adults =
          getAdults(booking);

        const children =
          getChildren(booking);

        const adultAmount =
          adults *
          adultUnitCost;

        const childAmount =
          children *
          childUnitCost;

        return {
          ...booking,

          _channel_id:
            channelId,

          _channel_name:
            channel?.name ||
            booking.booking_source ||
            "Senza canale",

          _company_name:
            String(
              channel?.company_name ||
                ""
            ).trim(),

          _adult_unit_cost:
            adultUnitCost,

          _child_unit_cost:
            childUnitCost,

          _adult_amount:
            adultAmount,

          _child_amount:
            childAmount,

          _invoice_amount:
            adultAmount +
            childAmount,
        };
      });

  invoiceBookings.sort(
    (a: any, b: any) => {
      const channelCompare =
        String(
          a._channel_name
        ).localeCompare(
          String(
            b._channel_name
          ),
          "it"
        );

      if (
        channelCompare !== 0
      ) {
        return channelCompare;
      }

      const dateCompare =
        String(
          a.booking_date || ""
        ).localeCompare(
          String(
            b.booking_date || ""
          )
        );

      if (
        dateCompare !== 0
      ) {
        return dateCompare;
      }

      return (
        Number(a.id || 0) -
        Number(b.id || 0)
      );
    }
  );

  const groupedByChannel =
    new Map<
      string,
      ChannelGroup
    >();

  for (const booking of invoiceBookings) {
    const channelId =
      Number(
        booking._channel_id || 0
      );

    const channelKey =
      String(channelId);

    let current =
      groupedByChannel.get(
        channelKey
      );

    if (!current) {
      current = {
        channelId,

        channelName:
          String(
            booking._channel_name ||
              "Senza canale"
          ),

        companyName:
          String(
            booking._company_name ||
              ""
          ),

        bookings: [],

        total: 0,

        totalAdults: 0,

        totalChildren: 0,

        totalPeople: 0,
      };

      groupedByChannel.set(
        channelKey,
        current
      );
    }

    current.bookings.push(
      booking
    );

    current.total +=
      Number(
        booking._invoice_amount ||
          0
      );

    current.totalAdults +=
      getAdults(booking);

    current.totalChildren +=
      getChildren(booking);

    current.totalPeople +=
      getTotalPeople(booking);
  }

  const channelGroups =
    Array.from(
      groupedByChannel.values()
    ).map((data) => {
      const invoice =
        invoiceMap.get(
          String(data.channelId)
        );

      return {
        ...data,

        invoice:
          invoice || {
            is_invoiced:
              false,
            invoice_date:
              null,
            invoice_number:
              null,
          },
      };
    });

  const totalMonth =
    invoiceBookings.reduce(
      (
        sum: number,
        booking: any
      ) =>
        sum +
        Number(
          booking._invoice_amount ||
            0
        ),
      0
    );

  const invoicedGroups =
    channelGroups.filter(
      (group) =>
        group.invoice?.is_invoiced === true
    );

  const invoicedAmount =
    invoicedGroups.reduce(
      (
        sum: number,
        group
      ) =>
        sum +
        Number(
          group.total || 0
        ),
      0
    );

  const remainingAmount =
    totalMonth -
    invoicedAmount;

  const totalInvoices =
    channelGroups.length;

  const completedInvoices =
    invoicedGroups.length;

  const pendingInvoices =
    totalInvoices -
    completedInvoices;

  return (
    <AppShell
      title="Fatturazione FMDQ"
      subtitle="Riepilogo mensile delle esperienze da fatturare"
    >
      <div className="space-y-6">

        <SectionCard title="Periodo">

          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">

            <Link
              href={`/fatturazione-fmdq?month=${previousMonth}`}
              className="rounded-xl border border-zinc-300 bg-white px-4 py-2.5 text-center text-sm font-bold text-zinc-700 shadow-sm hover:bg-zinc-50"
            >
              ← Mese precedente
            </Link>

            <div className="text-center">

              <div className="text-2xl font-black text-zinc-900">
                {formatMonthLabel(month)}
              </div>

              <div className="mt-1 text-xs text-zinc-500">
                Dal{" "}
                {formatDate(firstDay)}
                {" "}al{" "}
                {formatDate(lastDay)}
              </div>

            </div>

            <Link
              href={`/fatturazione-fmdq?month=${nextMonth}`}
              className="rounded-xl border border-zinc-300 bg-white px-4 py-2.5 text-center text-sm font-bold text-zinc-700 shadow-sm hover:bg-zinc-50"
            >
              Mese successivo →
            </Link>

          </div>

          <div className="mt-5 flex flex-col gap-3 border-t border-zinc-100 pt-4 xl:flex-row xl:items-end xl:justify-between">

            <form
              method="GET"
              className="flex flex-col gap-2 sm:flex-row sm:items-end"
            >

              <div>

                <label
                  htmlFor="month"
                  className="mb-1 block text-xs font-bold uppercase text-zinc-500"
                >
                  Vai al mese
                </label>

                <input
                  id="month"
                  name="month"
                  type="month"
                  defaultValue={month}
                  className="rounded-xl border border-zinc-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-zinc-500"
                />

              </div>

              <button
                type="submit"
                className="rounded-xl bg-zinc-900 px-5 py-2.5 text-sm font-bold text-white hover:bg-zinc-700"
              >
                Apri
              </button>

            </form>

            <div className="flex flex-col gap-2 sm:flex-row">

              <a
                href={`/fatturazione-fmdq/pdf?month=${month}`}
                className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-5 py-2.5 text-sm font-bold text-red-700 shadow-sm transition hover:bg-red-100"
              >
                📄 PDF dettagliato
              </a>

              <a
                href={`/fatturazione-fmdq/pdf-riepilogo?month=${month}`}
                className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-5 py-2.5 text-sm font-bold text-blue-700 shadow-sm transition hover:bg-blue-100"
              >
                📋 PDF riepilogo
              </a>

            </div>

          </div>

        </SectionCard>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">

          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">

            <div className="text-xs font-bold uppercase text-zinc-500">
              Da fatturare
            </div>

            <div className="mt-2 text-3xl font-black text-zinc-900">
              {formatEuro(totalMonth)}
            </div>

          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">

            <div className="text-xs font-bold uppercase text-zinc-500">
              Già fatturato
            </div>

            <div className="mt-2 text-3xl font-black text-emerald-700">
              {formatEuro(invoicedAmount)}
            </div>

          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">

            <div className="text-xs font-bold uppercase text-zinc-500">
              Rimane
            </div>

            <div className="mt-2 text-3xl font-black text-red-700">
              {formatEuro(remainingAmount)}
            </div>

          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">

            <div className="text-xs font-bold uppercase text-zinc-500">
              Fatture totali
            </div>

            <div className="mt-2 text-3xl font-black text-zinc-900">
              {totalInvoices}
            </div>

          </div>

          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">

            <div className="text-xs font-bold uppercase text-emerald-700">
              Fatture fatte
            </div>

            <div className="mt-2 text-3xl font-black text-emerald-700">
              {completedInvoices}
            </div>

          </div>

          <div
            className={`rounded-2xl border p-5 shadow-sm ${
              pendingInvoices > 0
                ? "border-red-200 bg-red-50"
                : "border-emerald-200 bg-emerald-50"
            }`}
          >

            <div
              className={`text-xs font-bold uppercase ${
                pendingInvoices > 0
                  ? "text-red-700"
                  : "text-emerald-700"
              }`}
            >
              Fatture da fare
            </div>

            <div
              className={`mt-2 text-3xl font-black ${
                pendingInvoices > 0
                  ? "text-red-700"
                  : "text-emerald-700"
              }`}
            >
              {pendingInvoices}
            </div>

          </div>

        </div>

        <SectionCard title="Riepilogo per canale">

          {channelGroups.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 p-8 text-center text-sm text-zinc-500">
              Nessuna esperienza da fatturare per{" "}
              {formatMonthLabel(month)}.
            </div>
          ) : (
            <div className="space-y-6">

              {channelGroups.map((group) => {
                const isInvoiced =
                  group.invoice?.is_invoiced === true;

                const savedInvoiceNumber =
                  String(
                    group.invoice?.invoice_number ||
                      ""
                  ).trim();

                const invoiceNumberValue =
                  savedInvoiceNumber ||
                  defaultInvoiceNumber;

                const reportRows =
                  getInvoiceReportRows(group.bookings);

                return (
                  <div
                    key={group.channelId}
                    className={`overflow-hidden rounded-2xl border ${
                      isInvoiced
                        ? "border-emerald-300"
                        : "border-zinc-200"
                    }`}
                  >

                    <div
                      className={`px-5 py-4 ${
                        isInvoiced
                          ? "bg-emerald-50"
                          : "bg-zinc-100"
                      }`}
                    >

                      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">

                        <div className="min-w-[300px]">

                          <div className="flex flex-wrap items-center gap-2 text-lg">

                            <span className="font-black text-zinc-900">
                              {group.channelName}
                            </span>

                            {group.companyName && (
                              <>
                                <span className="text-zinc-400">
                                  -
                                </span>

                                <span className="font-black text-zinc-900">
                                  {group.companyName}
                                </span>
                              </>
                            )}

                            {isInvoiced && (
                              <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-black uppercase text-white">
                                Fatturato
                              </span>
                            )}

                          </div>

                          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">

                            <span>
                              <strong className="text-zinc-700">
                                {group.bookings.length}
                              </strong>{" "}
                              esperienze
                            </span>

                            <span>·</span>

                            <span>
                              <strong className="text-zinc-700">
                                {group.totalAdults}
                              </strong>{" "}
                              adulti
                            </span>

                            <span>·</span>

                            <span>
                              <strong className="text-zinc-700">
                                {group.totalChildren}
                              </strong>{" "}
                              bambini
                            </span>

                            <span>·</span>

                            <span>
                              <strong className="text-zinc-900">
                                {group.totalPeople}
                              </strong>{" "}
                              persone
                            </span>

                          </div>

                        </div>

                        <form
                          action={saveFmdqInvoice}
                          className="flex flex-col gap-3 lg:flex-row lg:items-end"
                        >

                          <input
                            type="hidden"
                            name="channel_id"
                            value={group.channelId}
                          />

                          <input
                            type="hidden"
                            name="month"
                            value={month}
                          />

                          <label className="flex min-h-[40px] cursor-pointer items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3">

                            <input
                              type="checkbox"
                              name="is_invoiced"
                              defaultChecked={isInvoiced}
                              className="h-5 w-5 rounded border-zinc-300"
                            />

                            <span className="text-xs font-bold text-zinc-700">
                              Fatturato
                            </span>

                          </label>

                          <div>

                            <label className="mb-1 block text-[10px] font-bold uppercase text-zinc-500">
                              Data fattura
                            </label>

                            <input
                              type="date"
                              name="invoice_date"
                              defaultValue={
                                group.invoice?.invoice_date ||
                                ""
                              }
                              className="h-[40px] rounded-lg border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-zinc-500"
                            />

                          </div>

                          <div>

                            <label className="mb-1 block text-[10px] font-bold uppercase text-zinc-500">
                              Numero fattura
                            </label>

                            <input
                              type="text"
                              name="invoice_number"
                              defaultValue={invoiceNumberValue}
                              placeholder={`FPR 37/${currentInvoiceYear}`}
                              className="h-[40px] w-[150px] rounded-lg border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-zinc-500"
                            />

                          </div>

                          <button
                            type="submit"
                            className="h-[40px] rounded-lg bg-zinc-900 px-4 text-xs font-bold text-white hover:bg-zinc-700"
                          >
                            Salva
                          </button>

                        </form>

                        <InvoiceReportButton
                          channelName={group.channelName}
                          companyName={group.companyName}
                          invoiceNumber={savedInvoiceNumber || null}
                          invoiceDate={group.invoice?.invoice_date || null}
                          period={`${formatDate(firstDay)} - ${formatDate(lastDay)}`}
                          rows={reportRows}
                          totalAdults={group.totalAdults}
                          totalChildren={group.totalChildren}
                          totalInvoice={group.total}
                        />

                        <div className="min-w-[120px] text-right text-xl font-black text-zinc-900">
                          {formatEuro(group.total)}
                        </div>

                      </div>

                    </div>

                    <div className="divide-y divide-zinc-100 md:hidden">

                      {group.bookings.map((booking: any) => {
                        const adults =
                          getAdults(booking);

                        const children =
                          getChildren(booking);

                        return (
                          <div
                            key={booking.id}
                            className="space-y-3 p-4"
                          >

                            <div className="flex items-start justify-between gap-3">

                              <div>

                                <div className="font-bold text-zinc-900">
                                  {formatDate(
                                    booking.booking_date
                                  )}
                                </div>

                                {booking.booking_time && (
                                  <div className="text-xs text-zinc-500">
                                    {booking.booking_time.slice(
                                      0,
                                      5
                                    )}
                                  </div>
                                )}

                              </div>

                              <div className="text-right text-lg font-black text-zinc-900">
                                {formatEuro(
                                  booking._invoice_amount
                                )}
                              </div>

                            </div>

                            <div>

                              <div className="font-semibold text-zinc-800">
                                {booking.experience_name}
                              </div>

                              <div className="mt-1 text-sm text-zinc-500">
                                {booking.customer_name || "-"}
                              </div>

                            </div>

                            <div className="rounded-xl bg-zinc-50 p-3 text-xs text-zinc-700">

                              <div>

                                <strong>
                                  {adults} adulti
                                </strong>{" "}
                                ×{" "}
                                {formatEuro(
                                  booking._adult_unit_cost
                                )}
                                {" = "}

                                <strong>
                                  {formatEuro(
                                    booking._adult_amount
                                  )}
                                </strong>

                              </div>

                              {children > 0 && (
                                <div className="mt-1">

                                  <strong>
                                    {children} bambini
                                  </strong>{" "}
                                  ×{" "}
                                  {formatEuro(
                                    booking._child_unit_cost
                                  )}
                                  {" = "}

                                  <strong>
                                    {formatEuro(
                                      booking._child_amount
                                    )}
                                  </strong>

                                </div>
                              )}

                            </div>

                          </div>
                        );
                      })}

                    </div>

                    <div className="hidden overflow-x-auto md:block">

                      <table className="w-full text-left text-sm">

                        <thead className="border-b border-zinc-200 bg-white text-[10px] font-bold uppercase text-zinc-500">

                          <tr>

                            <th className="px-4 py-3">
                              Data
                            </th>

                            <th className="px-4 py-3">
                              Cliente
                            </th>

                            <th className="px-4 py-3">
                              Esperienza
                            </th>

                            <th className="px-4 py-3">
                              Adulti
                            </th>

                            <th className="px-4 py-3">
                              Bambini
                            </th>

                            <th className="px-4 py-3">
                              Rif.
                            </th>

                            <th className="px-4 py-3 text-right">
                              Da fatturare
                            </th>

                          </tr>

                        </thead>

                        <tbody className="divide-y divide-zinc-100">

                          {group.bookings.map((booking: any) => {
                            const adults =
                              getAdults(booking);

                            const children =
                              getChildren(booking);

                            return (
                              <tr
                                key={booking.id}
                                className="hover:bg-zinc-50"
                              >

                                <td className="whitespace-nowrap px-4 py-4">

                                  <div className="font-bold text-zinc-900">
                                    {formatDate(
                                      booking.booking_date
                                    )}
                                  </div>

                                  {booking.booking_time && (
                                    <div className="mt-1 text-xs text-zinc-500">
                                      {booking.booking_time.slice(
                                        0,
                                        5
                                      )}
                                    </div>
                                  )}

                                </td>

                                <td className="px-4 py-4">

                                  <div className="font-medium text-zinc-900">
                                    {booking.customer_name || "-"}
                                  </div>

                                </td>

                                <td className="px-4 py-4">

                                  <div className="font-medium text-zinc-800">
                                    {booking.experience_name || "-"}
                                  </div>

                                </td>

                                <td className="whitespace-nowrap px-4 py-4">

                                  <div className="font-bold text-zinc-900">
                                    {adults} ×{" "}
                                    {formatEuro(
                                      booking._adult_unit_cost
                                    )}
                                  </div>

                                  <div className="mt-1 text-xs text-zinc-500">
                                    ={" "}
                                    {formatEuro(
                                      booking._adult_amount
                                    )}
                                  </div>

                                </td>

                                <td className="whitespace-nowrap px-4 py-4">

                                  <div className="font-bold text-zinc-900">
                                    {children} ×{" "}
                                    {formatEuro(
                                      booking._child_unit_cost
                                    )}
                                  </div>

                                  <div className="mt-1 text-xs text-zinc-500">
                                    ={" "}
                                    {formatEuro(
                                      booking._child_amount
                                    )}
                                  </div>

                                </td>

                                <td className="px-4 py-4 font-mono text-xs text-zinc-500">
                                  {booking.booking_reference || "-"}
                                </td>

                                <td className="whitespace-nowrap px-4 py-4 text-right text-base font-black text-zinc-900">
                                  {formatEuro(
                                    booking._invoice_amount
                                  )}
                                </td>

                              </tr>
                            );
                          })}

                        </tbody>

                        <tfoot>

                          <tr className="border-t-2 border-zinc-300 bg-zinc-50">

                            <td
                              colSpan={6}
                              className="px-4 py-4 text-right text-sm font-black uppercase text-zinc-600"
                            >
                              Totale{" "}
                              {group.channelName}
                            </td>

                            <td className="px-4 py-4 text-right text-lg font-black text-zinc-900">
                              {formatEuro(
                                group.total
                              )}
                            </td>

                          </tr>

                        </tfoot>

                      </table>

                    </div>

                  </div>
                );
              })}

              <div className="flex flex-col gap-2 rounded-2xl bg-zinc-900 px-6 py-5 text-white sm:flex-row sm:items-center sm:justify-between">

                <div>

                  <div className="text-xs font-bold uppercase text-zinc-300">
                    Totale mese
                  </div>

                  <div className="mt-1 font-bold">
                    {formatMonthLabel(month)}
                  </div>

                </div>

                <div className="text-3xl font-black">
                  {formatEuro(totalMonth)}
                </div>

              </div>

            </div>
          )}

        </SectionCard>

      </div>
    </AppShell>
  );
}
