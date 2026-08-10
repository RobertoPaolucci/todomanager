import {
  PDFDocument,
  StandardFonts,
  rgb,
  PDFFont,
  PDFPage,
} from "pdf-lib";

import { supabaseServer } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type InvoiceGroup = {
  channelId: number;
  channelName: string;
  companyName: string;
  bookings: any[];
  total: number;
  totalAdults: number;
  totalChildren: number;
  totalPeople: number;
  invoice: any;
};

function optionalNumber(value: unknown): number | null {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : null;
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

  const supplierId = Number(
    booking.supplier_id ||
      supplier?.id ||
      0
  );

  const supplierName = String(
    supplier?.name || ""
  )
    .trim()
    .toLowerCase();

  if (supplierId === 0) {
    return true;
  }

  if (supplierName === "fmdq") {
    return true;
  }

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

function getBookingHistoryKey(
  booking: any
) {
  const reference = String(
    booking.booking_reference || ""
  ).trim();

  if (reference) {
    return reference.toUpperCase();
  }

  return `NO-REF-${booking.id}`;
}

function getLatestBookings(
  bookings: any[]
) {
  const groups =
    new Map<string, any[]>();

  for (const booking of bookings) {
    const key =
      getBookingHistoryKey(
        booking
      );

    const current =
      groups.get(key) || [];

    current.push(booking);

    groups.set(
      key,
      current
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

function getTotalPeople(
  booking: any
) {
  return (
    getAdults(booking) +
    getChildren(booking) +
    getInfants(booking)
  );
}

function getMonthBounds(
  month: string
) {
  const [
    year,
    monthNumber,
  ] = month
    .split("-")
    .map(Number);

  const firstDay =
    `${year}-${String(
      monthNumber
    ).padStart(2, "0")}-01`;

  const lastDayDate =
    new Date(
      year,
      monthNumber,
      0
    );

  const lastDay =
    `${year}-${String(
      monthNumber
    ).padStart(
      2,
      "0"
    )}-${String(
      lastDayDate.getDate()
    ).padStart(2, "0")}`;

  return {
    firstDay,
    lastDay,
  };
}

function formatDate(
  value: string | null
) {
  if (!value) {
    return "-";
  }

  const [
    year,
    month,
    day,
  ] = value
    .slice(0, 10)
    .split("-");

  return `${day}/${month}/${year}`;
}

function formatMonthLabel(
  month: string
) {
  const [
    year,
    monthNumber,
  ] = month
    .split("-")
    .map(Number);

  const months = [
    "Gennaio",
    "Febbraio",
    "Marzo",
    "Aprile",
    "Maggio",
    "Giugno",
    "Luglio",
    "Agosto",
    "Settembre",
    "Ottobre",
    "Novembre",
    "Dicembre",
  ];

  return `${
    months[
      monthNumber - 1
    ]
  } ${year}`;
}

function formatMoney(
  value: number
) {
  return new Intl.NumberFormat(
    "it-IT",
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }
  ).format(value);
}

function wrapText(
  text: string,
  font: PDFFont,
  fontSize: number,
  maxWidth: number
) {
  const words =
    String(text || "")
      .replace(/\s+/g, " ")
      .trim()
      .split(" ");

  const lines: string[] = [];

  let current = "";

  for (const word of words) {
    const test =
      current
        ? `${current} ${word}`
        : word;

    const width =
      font.widthOfTextAtSize(
        test,
        fontSize
      );

    if (
      width <= maxWidth ||
      !current
    ) {
      current = test;
    } else {
      lines.push(current);
      current = word;
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines.length
    ? lines
    : [""];
}

export async function GET(
  request: Request
) {
  const url =
    new URL(request.url);

  const requestedMonth =
    String(
      url.searchParams.get(
        "month"
      ) || ""
    );

  const now = new Date();

  const currentMonth =
    `${now.getFullYear()}-${String(
      now.getMonth() + 1
    ).padStart(2, "0")}`;

  const month =
    /^\d{4}-\d{2}$/.test(
      requestedMonth
    )
      ? requestedMonth
      : currentMonth;

  const {
    firstDay,
    lastDay,
  } = getMonthBounds(
    month
  );

  const invoiceMonth =
    `${month}-01`;

  const [
    bookingsRes,
    invoicesRes,
    pricesRes,
    experiencesRes,
  ] = await Promise.all([
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
    return new Response(
      `Errore prenotazioni: ${bookingsRes.error.message}`,
      {
        status: 500,
      }
    );
  }

  if (invoicesRes.error) {
    return new Response(
      `Errore fatture: ${invoicesRes.error.message}`,
      {
        status: 500,
      }
    );
  }

  if (pricesRes.error) {
    return new Response(
      `Errore prezzi: ${pricesRes.error.message}`,
      {
        status: 500,
      }
    );
  }

  if (
    experiencesRes.error
  ) {
    return new Response(
      `Errore esperienze: ${experiencesRes.error.message}`,
      {
        status: 500,
      }
    );
  }

  const bookings =
    bookingsRes.data || [];

  const invoices =
    invoicesRes.data || [];

  const prices =
    pricesRes.data || [];

  const experiences =
    experiencesRes.data ||
    [];

  const invoiceMap =
    new Map<string, any>();

  for (
    const invoice of invoices
  ) {
    invoiceMap.set(
      String(
        invoice.channel_id
      ),
      invoice
    );
  }

  const experienceMap =
    new Map<string, any>();

  for (
    const experience of experiences
  ) {
    experienceMap.set(
      String(
        experience.id
      ),
      experience
    );
  }

  const priceMap =
    new Map<string, any>();

  for (
    const price of prices
  ) {
    priceMap.set(
      `${price.experience_id}:${price.channel_id}`,
      price
    );
  }

  const latestBookings =
    getLatestBookings(
      bookings
    );

  const invoiceBookings =
    latestBookings
      .filter(
        (booking: any) => {
          if (
            booking.is_cancelled ===
            true
          ) {
            return false;
          }

          const channel =
            getChannelData(
              booking
            );

          if (
            channel
              ?.fattura_mensile_fmdq !==
            true
          ) {
            return false;
          }

          return isFmdqSupplier(
            booking
          );
        }
      )
      .map(
        (booking: any) => {
          const channel =
            getChannelData(
              booking
            );

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

          const price =
            priceMap.get(
              `${experienceId}:${channelId}`
            );

          const experience =
            experienceMap.get(
              String(
                experienceId
              )
            );

          const specificAdultCost =
            optionalNumber(
              price
                ?.supplier_adult_unit_cost
            );

          const baseAdultCost =
            Number(
              experience
                ?.supplier_unit_cost ||
                0
            );

          const adultUnitCost =
            specificAdultCost ??
            baseAdultCost;

          const specificChildCost =
            optionalNumber(
              price
                ?.supplier_child_unit_cost
            );

          const childUnitCost =
            specificChildCost ??
            adultUnitCost;

          const adults =
            getAdults(
              booking
            );

          const children =
            getChildren(
              booking
            );

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
                channel
                  ?.company_name ||
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
        }
      );

  invoiceBookings.sort(
    (a: any, b: any) => {
      const channel =
        String(
          a._channel_name
        ).localeCompare(
          String(
            b._channel_name
          ),
          "it"
        );

      if (channel !== 0) {
        return channel;
      }

      return String(
        a.booking_date || ""
      ).localeCompare(
        String(
          b.booking_date || ""
        )
      );
    }
  );

  const groupsMap =
    new Map<
      string,
      InvoiceGroup
    >();

  for (
    const booking of invoiceBookings
  ) {
    const channelId =
      Number(
        booking._channel_id ||
          0
      );

    const key =
      String(channelId);

    let group =
      groupsMap.get(key);

    if (!group) {
      group = {
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

        invoice: null,
      };

      groupsMap.set(
        key,
        group
      );
    }

    group.bookings.push(
      booking
    );

    group.total += Number(
      booking._invoice_amount ||
        0
    );

    group.totalAdults +=
      getAdults(
        booking
      );

    group.totalChildren +=
      getChildren(
        booking
      );

    group.totalPeople +=
      getTotalPeople(
        booking
      );
  }

  const groups =
    Array.from(
      groupsMap.values()
    );

  for (const group of groups) {
    group.invoice =
      invoiceMap.get(
        String(
          group.channelId
        )
      ) || null;
  }

  const totalMonth =
    groups.reduce(
      (
        sum,
        group
      ) =>
        sum +
        group.total,
      0
    );

  const completedInvoices =
    groups.filter(
      (group) =>
        group.invoice
          ?.is_invoiced ===
        true
    ).length;

  const totalInvoices =
    groups.length;

  const pendingInvoices =
    totalInvoices -
    completedInvoices;

  const invoicedAmount =
    groups
      .filter(
        (group) =>
          group.invoice
            ?.is_invoiced ===
          true
      )
      .reduce(
        (
          sum,
          group
        ) =>
          sum +
          group.total,
        0
      );

  const remainingAmount =
    totalMonth -
    invoicedAmount;

  /*
   * CREAZIONE PDF
   */

  const pdfDoc =
    await PDFDocument.create();

  const font =
    await pdfDoc.embedFont(
      StandardFonts.Helvetica
    );

  const bold =
    await pdfDoc.embedFont(
      StandardFonts.HelveticaBold
    );

  const pageWidth =
    595.28;

  const pageHeight =
    841.89;

  const margin =
    40;

  let page: PDFPage =
    pdfDoc.addPage([
      pageWidth,
      pageHeight,
    ]);

  let y =
    pageHeight - 45;

  function newPage() {
    page =
      pdfDoc.addPage([
        pageWidth,
        pageHeight,
      ]);

    y =
      pageHeight - 45;
  }

  function ensureSpace(
    required: number
  ) {
    if (
      y - required <
      40
    ) {
      newPage();
    }
  }

  function drawText(
    text: string,
    options?: {
      size?: number;
      bold?: boolean;
      x?: number;
      color?: ReturnType<
        typeof rgb
      >;
    }
  ) {
    const size =
      options?.size || 10;

    const selectedFont =
      options?.bold
        ? bold
        : font;

    page.drawText(
      String(text || ""),
      {
        x:
          options?.x ??
          margin,

        y,

        size,

        font:
          selectedFont,

        color:
          options?.color ??
          rgb(0.1, 0.1, 0.1),
      }
    );
  }

  function drawWrappedText(
    text: string,
    options?: {
      size?: number;
      bold?: boolean;
      x?: number;
      width?: number;
      lineHeight?: number;
    }
  ) {
    const size =
      options?.size || 9;

    const selectedFont =
      options?.bold
        ? bold
        : font;

    const x =
      options?.x ??
      margin;

    const width =
      options?.width ??
      pageWidth -
        margin * 2;

    const lineHeight =
      options?.lineHeight ??
      size + 3;

    const lines =
      wrapText(
        text,
        selectedFont,
        size,
        width
      );

    ensureSpace(
      lines.length *
        lineHeight +
        5
    );

    for (
      const line of lines
    ) {
      page.drawText(
        line,
        {
          x,
          y,
          size,
          font:
            selectedFont,
          color:
            rgb(
              0.12,
              0.12,
              0.12
            ),
        }
      );

      y -=
        lineHeight;
    }
  }

  /*
   * TESTATA
   */

  drawText(
    "Fatturazione FMDQ",
    {
      size: 20,
      bold: true,
    }
  );

  y -= 25;

  drawText(
    formatMonthLabel(
      month
    ),
    {
      size: 15,
      bold: true,
    }
  );

  y -= 18;

  drawText(
    `Periodo: ${formatDate(
      firstDay
    )} - ${formatDate(
      lastDay
    )}`,
    {
      size: 9,
    }
  );

  y -= 22;

  page.drawLine({
    start: {
      x: margin,
      y,
    },
    end: {
      x:
        pageWidth -
        margin,
      y,
    },
    thickness: 1,
    color:
      rgb(
        0.75,
        0.75,
        0.75
      ),
  });

  y -= 22;

  /*
   * RIEPILOGO
   */

  drawText(
    "Riepilogo del mese",
    {
      size: 12,
      bold: true,
    }
  );

  y -= 20;

  drawText(
    `Da fatturare: EUR ${formatMoney(
      totalMonth
    )}`,
    {
      bold: true,
    }
  );

  y -= 15;

  drawText(
    `Gia fatturato: EUR ${formatMoney(
      invoicedAmount
    )}`
  );

  y -= 15;

  drawText(
    `Rimane: EUR ${formatMoney(
      remainingAmount
    )}`
  );

  y -= 15;

  drawText(
    `Fatture totali: ${totalInvoices}   |   Fatture fatte: ${completedInvoices}   |   Fatture da fare: ${pendingInvoices}`
  );

  y -= 28;

  /*
   * CANALI
   */

  for (
    const group of groups
  ) {
    ensureSpace(120);

    page.drawRectangle({
      x:
        margin - 5,

      y:
        y - 10,

      width:
        pageWidth -
        margin * 2 +
        10,

      height: 28,

      color:
        group.invoice
          ?.is_invoiced ===
        true
          ? rgb(
              0.9,
              0.98,
              0.92
            )
          : rgb(
              0.94,
              0.94,
              0.94
            ),
    });

    const heading =
      group.companyName
        ? `${group.channelName} - ${group.companyName}`
        : group.channelName;

    drawWrappedText(
      heading,
      {
        size: 11,
        bold: true,
        width: 390,
        lineHeight: 13,
      }
    );

    const invoiceStatus =
      group.invoice
        ?.is_invoiced ===
      true
        ? "FATTURATO"
        : "DA FATTURARE";

    const invoiceNumber =
      String(
        group.invoice
          ?.invoice_number ||
          "-"
      );

    const invoiceDate =
      group.invoice
        ?.invoice_date
        ? formatDate(
            group.invoice
              .invoice_date
          )
        : "-";

    drawWrappedText(
      `${group.bookings.length} esperienze - ${group.totalAdults} adulti - ${group.totalChildren} bambini - ${group.totalPeople} persone`,
      {
        size: 8,
      }
    );

    drawWrappedText(
      `${invoiceStatus} - Data fattura: ${invoiceDate} - Numero: ${invoiceNumber}`,
      {
        size: 8,
        bold:
          group.invoice
            ?.is_invoiced ===
          true,
      }
    );

    drawText(
      `Totale canale: EUR ${formatMoney(
        group.total
      )}`,
      {
        size: 10,
        bold: true,
      }
    );

    y -= 18;

    page.drawLine({
      start: {
        x: margin,
        y,
      },
      end: {
        x:
          pageWidth -
          margin,
        y,
      },
      thickness: 0.6,
      color:
        rgb(
          0.8,
          0.8,
          0.8
        ),
    });

    y -= 15;

    for (
      const booking of group.bookings
    ) {
      const adults =
        getAdults(
          booking
        );

      const children =
        getChildren(
          booking
        );

      const date =
        formatDate(
          booking.booking_date
        );

      const time =
        booking.booking_time
          ? String(
              booking.booking_time
            ).slice(
              0,
              5
            )
          : "";

      const customer =
        String(
          booking.customer_name ||
            "-"
        );

      const experience =
        String(
          booking.experience_name ||
            "-"
        );

      const adultText =
        `${adults} x EUR ${formatMoney(
          Number(
            booking._adult_unit_cost ||
              0
          )
        )} = EUR ${formatMoney(
          Number(
            booking._adult_amount ||
              0
          )
        )}`;

      const childText =
        `${children} x EUR ${formatMoney(
          Number(
            booking._child_unit_cost ||
              0
          )
        )} = EUR ${formatMoney(
          Number(
            booking._child_amount ||
              0
          )
        )}`;

      const totalText =
        `EUR ${formatMoney(
          Number(
            booking._invoice_amount ||
              0
          )
        )}`;

      const rowText =
        `${date}${
          time
            ? ` ${time}`
            : ""
        } | ${customer} | ${experience} | Adulti: ${adultText} | Bambini: ${childText} | Totale: ${totalText}`;

      drawWrappedText(
        rowText,
        {
          size: 8,
          width:
            pageWidth -
            margin * 2,
          lineHeight: 11,
        }
      );

      y -= 5;
    }

    y -= 12;
  }

  /*
   * TOTALE FINALE
   */

  ensureSpace(60);

  page.drawLine({
    start: {
      x: margin,
      y,
    },
    end: {
      x:
        pageWidth -
        margin,
      y,
    },
    thickness: 1.5,
    color:
      rgb(
        0.1,
        0.1,
        0.1
      ),
  });

  y -= 25;

  drawText(
    `TOTALE ${formatMonthLabel(
      month
    ).toUpperCase()}: EUR ${formatMoney(
      totalMonth
    )}`,
    {
      size: 14,
      bold: true,
    }
  );

  const pdfBytes =
    await pdfDoc.save();

  return new Response(
    Buffer.from(
      pdfBytes
    ),
    {
      status: 200,

      headers: {
        "Content-Type":
          "application/pdf",

        "Content-Disposition":
          `attachment; filename="Fatturazione-FMDQ-${month}.pdf"`,

        "Cache-Control":
          "no-store",
      },
    }
  );
}