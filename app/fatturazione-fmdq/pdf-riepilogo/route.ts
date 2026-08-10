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

  return Number.isFinite(n) ? n : null;
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
  const supplier = getSupplierData(booking);

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
  const reference = String(
    booking.booking_reference || ""
  ).trim();

  if (reference) {
    return reference.toUpperCase();
  }

  return `NO-REF-${booking.id}`;
}

function getLatestBookings(bookings: any[]) {
  const groups = new Map<string, any[]>();

  for (const booking of bookings) {
    const key = getBookingHistoryKey(booking);

    const list = groups.get(key) || [];

    list.push(booking);

    groups.set(key, list);
  }

  return Array.from(groups.values()).map((versions) => {
    return [...versions].sort(
      (a, b) =>
        Number(b.id || 0) -
        Number(a.id || 0)
    )[0];
  });
}

function getAdults(booking: any) {
  return Number(booking.adults || 0);
}

function getChildren(booking: any) {
  return Number(booking.children || 0);
}

function getInfants(booking: any) {
  return Number(booking.infants || 0);
}

function getTotalPeople(booking: any) {
  return (
    getAdults(booking) +
    getChildren(booking) +
    getInfants(booking)
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

function formatDate(value: string | null) {
  if (!value) {
    return "-";
  }

  const clean = value.slice(0, 10);

  const [
    year,
    month,
    day,
  ] = clean.split("-");

  if (!year || !month || !day) {
    return value;
  }

  return `${day}/${month}/${year}`;
}

function formatMonthLabel(month: string) {
  const [year, monthNumber] =
    month.split("-").map(Number);

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

  return `${months[monthNumber - 1]} ${year}`;
}

function formatMoney(value: number) {
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
  const words = String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ");

  const lines: string[] = [];

  let current = "";

  for (const word of words) {
    const candidate =
      current
        ? `${current} ${word}`
        : word;

    const width =
      font.widthOfTextAtSize(
        candidate,
        fontSize
      );

    if (
      width <= maxWidth ||
      !current
    ) {
      current = candidate;
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
      url.searchParams.get("month") || ""
    );

  const now = new Date();

  const currentMonth =
    `${now.getFullYear()}-${String(
      now.getMonth() + 1
    ).padStart(2, "0")}`;

  const month =
    /^\d{4}-\d{2}$/.test(requestedMonth)
      ? requestedMonth
      : currentMonth;

  const {
    firstDay,
    lastDay,
  } = getMonthBounds(month);

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
      .from("fmdq_monthly_invoices")
      .select("*")
      .eq(
        "invoice_month",
        invoiceMonth
      ),

    supabaseServer
      .from("experience_channel_prices")
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
      { status: 500 }
    );
  }

  if (invoicesRes.error) {
    return new Response(
      `Errore fatture: ${invoicesRes.error.message}`,
      { status: 500 }
    );
  }

  if (pricesRes.error) {
    return new Response(
      `Errore prezzi: ${pricesRes.error.message}`,
      { status: 500 }
    );
  }

  if (experiencesRes.error) {
    return new Response(
      `Errore esperienze: ${experiencesRes.error.message}`,
      { status: 500 }
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

  /*
   * FATTURE
   */

  const invoiceMap =
    new Map<string, any>();

  for (const invoice of invoices) {
    invoiceMap.set(
      String(invoice.channel_id),
      invoice
    );
  }

  /*
   * ESPERIENZE
   */

  const experienceMap =
    new Map<string, any>();

  for (const experience of experiences) {
    experienceMap.set(
      String(experience.id),
      experience
    );
  }

  /*
   * PREZZI
   */

  const priceMap =
    new Map<string, any>();

  for (const price of prices) {
    priceMap.set(
      `${price.experience_id}:${price.channel_id}`,
      price
    );
  }

  /*
   * SOLO ULTIMA VERSIONE
   */

  const latestBookings =
    getLatestBookings(bookings);

  /*
   * PRENOTAZIONI DA FATTURARE
   */

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

        return isFmdqSupplier(booking);
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

        const price =
          priceMap.get(
            `${experienceId}:${channelId}`
          );

        const experience =
          experienceMap.get(
            String(experienceId)
          );

        const specificAdultCost =
          optionalNumber(
            price?.supplier_adult_unit_cost
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
            price?.supplier_child_unit_cost
          );

        const childUnitCost =
          specificChildCost ??
          adultUnitCost;

        const adults =
          getAdults(booking);

        const children =
          getChildren(booking);

        const invoiceAmount =
          adults * adultUnitCost +
          children * childUnitCost;

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

          _invoice_amount:
            invoiceAmount,
        };
      });

  /*
   * RAGGRUPPA PER CANALE
   */

  const groupsMap =
    new Map<
      string,
      InvoiceGroup
    >();

  for (const booking of invoiceBookings) {
    const channelId =
      Number(
        booking._channel_id || 0
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

    group.total +=
      Number(
        booking._invoice_amount || 0
      );

    group.totalAdults +=
      getAdults(booking);

    group.totalChildren +=
      getChildren(booking);

    group.totalPeople +=
      getTotalPeople(booking);
  }

  const groups =
    Array.from(
      groupsMap.values()
    ).sort((a, b) =>
      a.channelName.localeCompare(
        b.channelName,
        "it"
      )
    );

  for (const group of groups) {
    group.invoice =
      invoiceMap.get(
        String(group.channelId)
      ) || null;
  }

  /*
   * TOTALI
   */

  const totalMonth =
    groups.reduce(
      (sum, group) =>
        sum + group.total,
      0
    );

  const invoicedGroups =
    groups.filter(
      (group) =>
        group.invoice?.is_invoiced === true
    );

  const invoicedAmount =
    invoicedGroups.reduce(
      (sum, group) =>
        sum + group.total,
      0
    );

  const remainingAmount =
    totalMonth -
    invoicedAmount;

  const totalInvoices =
    groups.length;

  const completedInvoices =
    invoicedGroups.length;

  const pendingInvoices =
    totalInvoices -
    completedInvoices;

  /*
   * PDF
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
    841.89;

  const pageHeight =
    595.28;

  const margin =
    35;

  let page: PDFPage =
    pdfDoc.addPage([
      pageWidth,
      pageHeight,
    ]);

  let y =
    pageHeight - 40;

  function newPage() {
    page =
      pdfDoc.addPage([
        pageWidth,
        pageHeight,
      ]);

    y =
      pageHeight - 40;
  }

  function ensureSpace(
    height: number
  ) {
    if (
      y - height <
      35
    ) {
      newPage();
    }
  }

  function drawText(
    text: string,
    x: number,
    size = 9,
    isBold = false
  ) {
    page.drawText(
      String(text || ""),
      {
        x,
        y,
        size,
        font:
          isBold
            ? bold
            : font,
        color:
          rgb(
            0.1,
            0.1,
            0.1
          ),
      }
    );
  }

  function drawWrapped(
    text: string,
    x: number,
    width: number,
    size = 9,
    isBold = false
  ) {
    const selectedFont =
      isBold
        ? bold
        : font;

    const lines =
      wrapText(
        text,
        selectedFont,
        size,
        width
      );

    for (const line of lines) {
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
              0.1,
              0.1,
              0.1
            ),
        }
      );

      y -=
        size + 3;
    }
  }

  /*
   * TESTATA
   */

  drawText(
    "Fatturazione FMDQ - Riepilogo",
    margin,
    20,
    true
  );

  y -= 27;

  drawText(
    formatMonthLabel(month),
    margin,
    15,
    true
  );

  y -= 18;

  drawText(
    `Periodo: ${formatDate(firstDay)} - ${formatDate(lastDay)}`,
    margin,
    9
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
        0.7,
        0.7,
        0.7
      ),
  });

  y -= 22;

  /*
   * RIEPILOGO GENERALE
   */

  drawText(
    `Da fatturare: EUR ${formatMoney(totalMonth)}`,
    margin,
    11,
    true
  );

  drawText(
    `Gia fatturato: EUR ${formatMoney(invoicedAmount)}`,
    240,
    11,
    true
  );

  drawText(
    `Rimane: EUR ${formatMoney(remainingAmount)}`,
    470,
    11,
    true
  );

  y -= 22;

  drawText(
    `Fatture totali: ${totalInvoices}`,
    margin,
    10,
    true
  );

  drawText(
    `Fatture fatte: ${completedInvoices}`,
    240,
    10,
    true
  );

  drawText(
    `Fatture da fare: ${pendingInvoices}`,
    470,
    10,
    true
  );

  y -= 30;

  /*
   * INTESTAZIONE TABELLA
   */

  const xChannel =
    margin;

  const xExperiences =
    325;

  const xPeople =
    390;

  const xAmount =
    470;

  const xStatus =
    555;

  const xInvoiceDate =
    635;

  const xInvoiceNumber =
    710;

  page.drawRectangle({
    x:
      margin - 5,

    y:
      y - 7,

    width:
      pageWidth -
      margin * 2 +
      10,

    height:
      24,

    color:
      rgb(
        0.92,
        0.92,
        0.92
      ),
  });

  drawText(
    "CANALE / AZIENDA",
    xChannel,
    8,
    true
  );

  drawText(
    "ESP.",
    xExperiences,
    8,
    true
  );

  drawText(
    "PERSONE",
    xPeople,
    8,
    true
  );

  drawText(
    "TOTALE",
    xAmount,
    8,
    true
  );

  drawText(
    "STATO",
    xStatus,
    8,
    true
  );

  drawText(
    "DATA",
    xInvoiceDate,
    8,
    true
  );

  drawText(
    "N. FATTURA",
    xInvoiceNumber,
    8,
    true
  );

  y -= 25;

  /*
   * UNA RIGA PER CANALE
   */

  for (const group of groups) {
    ensureSpace(42);

    const heading =
      group.companyName
        ? `${group.channelName} - ${group.companyName}`
        : group.channelName;

    const headingLines =
      wrapText(
        heading,
        bold,
        8,
        275
      );

    const rowHeight =
      Math.max(
        30,
        headingLines.length *
          11 +
          10
      );

    if (
      group.invoice
        ?.is_invoiced ===
      true
    ) {
      page.drawRectangle({
        x:
          margin - 5,

        y:
          y -
          rowHeight +
          8,

        width:
          pageWidth -
          margin * 2 +
          10,

        height:
          rowHeight,

        color:
          rgb(
            0.92,
            0.98,
            0.93
          ),
      });
    }

    let headingY =
      y;

    for (
      const line of headingLines
    ) {
      page.drawText(
        line,
        {
          x:
            xChannel,

          y:
            headingY,

          size: 8,

          font:
            bold,

          color:
            rgb(
              0.1,
              0.1,
              0.1
            ),
        }
      );

      headingY -= 11;
    }

    page.drawText(
      String(
        group.bookings.length
      ),
      {
        x:
          xExperiences,

        y,

        size: 9,

        font,
      }
    );

    page.drawText(
      String(
        group.totalPeople
      ),
      {
        x:
          xPeople,

        y,

        size: 9,

        font,
      }
    );

    page.drawText(
      `EUR ${formatMoney(group.total)}`,
      {
        x:
          xAmount,

        y,

        size: 9,

        font:
          bold,
      }
    );

    const status =
      group.invoice
        ?.is_invoiced ===
      true
        ? "FATTA"
        : "DA FARE";

    page.drawText(
      status,
      {
        x:
          xStatus,

        y,

        size: 8,

        font:
          bold,
      }
    );

    const invoiceDate =
      group.invoice
        ?.invoice_date
        ? formatDate(
            group.invoice.invoice_date
          )
        : "-";

    page.drawText(
      invoiceDate,
      {
        x:
          xInvoiceDate,

        y,

        size: 8,

        font,
      }
    );

    const invoiceNumber =
      String(
        group.invoice
          ?.invoice_number ||
          "-"
      );

    page.drawText(
      invoiceNumber,
      {
        x:
          xInvoiceNumber,

        y,

        size: 8,

        font,
      }
    );

    y -=
      rowHeight;

    page.drawLine({
      start: {
        x:
          margin,
        y:
          y + 5,
      },

      end: {
        x:
          pageWidth -
          margin,
        y:
          y + 5,
      },

      thickness:
        0.4,

      color:
        rgb(
          0.82,
          0.82,
          0.82
        ),
    });
  }

  /*
   * TOTALE FINALE
   */

  ensureSpace(50);

  y -= 10;

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
    `TOTALE ${formatMonthLabel(month).toUpperCase()}`,
    margin,
    13,
    true
  );

  drawText(
    `EUR ${formatMoney(totalMonth)}`,
    650,
    13,
    true
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
          `attachment; filename="Fatturazione-FMDQ-Riepilogo-${month}.pdf"`,

        "Cache-Control":
          "no-store",
      },
    }
  );
}