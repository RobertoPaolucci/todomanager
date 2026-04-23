export const dynamic = "force-dynamic";

import Link from "next/link";
import AppShell from "@/components/AppShell";
import SectionCard from "@/components/SectionCard";
import MobileBookingCard from "@/components/MobileBookingCard";
import SummarySelectionToolbar from "@/components/SummarySelectionToolbar";
import { supabaseServer } from "@/lib/supabase-server";
import { cancelBooking, clearAlert } from "./actions";

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

type PageProps = {
  searchParams: Promise<{
    q?: string;
    sort?: string;
    dir?: string;
    past?: string;
    highlight?: string;
    from?: string;
    to?: string;
    bu?: string;
    venue?: string;
    dates?: string;
  }>;
};

function getChannelName(booking: any) {
  if (Array.isArray(booking.channels)) {
    return booking.channels[0]?.name || booking.booking_source || "";
  }
  return booking.channels?.name || booking.booking_source || "";
}

function getSupplierData(booking: any) {
  if (Array.isArray(booking.suppliers)) {
    return booking.suppliers[0] || null;
  }
  return booking.suppliers || null;
}

function isFmdqVenueBooking(booking: any) {
  const supplier = getSupplierData(booking);
  const supplierId = Number(booking.supplier_id || supplier?.id || 0);
  const supplierName = String(supplier?.name || "").trim().toLowerCase();

  if (supplierId === 0) return true;
  if (supplierName === "fmdq") return true;
  if (supplierName === "fattoria madonna della querce") return true;
  if (supplierName.includes("madonna della querce")) return true;

  return false;
}

function getTotalSeatsCount(booking: any) {
  const totalPeople = Number(booking.total_people || 0);
  if (totalPeople > 0) return totalPeople;

  return (
    Number(booking.adults || 0) +
    Number(booking.children || 0) +
    Number(booking.infants || 0) +
    Number(booking.non_paying_adults || 0)
  );
}

export default async function PrenotazioniPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const q = String(params.q || "").trim();
  const sort = params.sort || "booking_date";
  const dir = params.dir || "asc";
  const showPast = params.past === "true";
  const highlightId = params.highlight || "";
  const fromDate = params.from || "";
  const toDate = params.to || "";
  const businessUnitFilter = String(params.bu || "").trim().toLowerCase();
  const venueFilter = String(params.venue || "").trim().toLowerCase();
  const datesParam = String(params.dates || "").trim();

  const exactDateList = Array.from(
    new Set(
      datesParam
        .split(",")
        .map((v) => v.trim())
        .filter((v) => /^\d{4}-\d{2}-\d{2}$/.test(v))
    )
  ).sort();

  const exactDateSet = new Set(exactDateList);

  const now = new Date();
  const todayStr = now.toISOString().split("T")[0];

  const tomorrowObj = new Date();
  tomorrowObj.setDate(tomorrowObj.getDate() + 1);
  const tomorrowStr = tomorrowObj.toISOString().split("T")[0];

  const firstDayMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .split("T")[0];

  const lastDayMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    .toISOString()
    .split("T")[0];

  const [bookingsRes, internalRulesRes, businessUnitsRes] = await Promise.all([
    supabaseServer
      .from("bookings")
      .select("*, suppliers(id, name, phone), channels(name)"),
    supabaseServer
      .from("business_unit_internal_suppliers")
      .select("business_unit_id, supplier_id"),
    supabaseServer.from("business_units").select("id, code, name"),
  ]);

  if (bookingsRes.error) {
    console.error(
      "Errore caricamento prenotazioni:",
      bookingsRes.error.message
    );
  }

  if (internalRulesRes.error) {
    console.error(
      "Errore caricamento regole fornitori interni:",
      internalRulesRes.error.message
    );
  }

  if (businessUnitsRes.error) {
    console.error(
      "Errore caricamento business units:",
      businessUnitsRes.error.message
    );
  }

  const bookings = bookingsRes.data || [];
  const internalRules = internalRulesRes.data || [];
  const businessUnits = businessUnitsRes.data || [];

  const internalRuleSet = new Set(
    internalRules.map((rule) => `${rule.business_unit_id}:${rule.supplier_id}`)
  );

  const businessUnitMap = new Map(
    businessUnits.map((bu) => [String(bu.id), bu])
  );

  let allBookings = bookings.map((booking) => {
    const businessUnit = businessUnitMap.get(String(booking.business_unit_id));
    const isInternalSupplier = internalRuleSet.has(
      `${booking.business_unit_id}:${booking.supplier_id}`
    );

    return {
      ...booking,
      _is_internal_supplier: isInternalSupplier,
      _business_unit_code: businessUnit?.code || "",
      _business_unit_name: businessUnit?.name || "",
    };
  });

  allBookings = allBookings.filter((b) => {
    if (String(b.id) === highlightId) return true;

    if (exactDateSet.size > 0) {
      if (!b.booking_date || !exactDateSet.has(b.booking_date)) {
        return false;
      }
    }

    if (b.booking_date) {
      if (fromDate && b.booking_date < fromDate) return false;
      if (toDate && b.booking_date > toDate) return false;

      const shouldHidePastByDefault =
        !fromDate &&
        !toDate &&
        exactDateSet.size === 0 &&
        !showPast &&
        !q;

      if (shouldHidePastByDefault && b.booking_date < todayStr) {
        return false;
      }
    } else {
      if (exactDateSet.size > 0) return false;
    }

    if (businessUnitFilter && b._business_unit_code !== businessUnitFilter) {
      return false;
    }

    if (venueFilter === "fmdq" && !isFmdqVenueBooking(b)) {
      return false;
    }

    const bookingChannelName = getChannelName(b);
    const businessUnitLabel = getBusinessUnitLabel(b._business_unit_code);
    const businessUnitName = b._business_unit_name || "";

    if (q) {
      const term = q.toLowerCase();
      const match =
        (b.customer_name || "").toLowerCase().includes(term) ||
        (b.booking_reference || "").toLowerCase().includes(term) ||
        (b.experience_name || "").toLowerCase().includes(term) ||
        (bookingChannelName || "").toLowerCase().includes(term) ||
        (b.customer_phone || "").toLowerCase().includes(term) ||
        businessUnitLabel.toLowerCase().includes(term) ||
        businessUnitName.toLowerCase().includes(term);

      if (!match) return false;
    }

    return true;
  });

  allBookings.sort((a, b) => {
    const hasAlertA =
      a.notes &&
      (a.notes.includes("🔴") || a.notes.includes("🟡") || a.notes.includes("🟢"));

    const hasAlertB =
      b.notes &&
      (b.notes.includes("🔴") || b.notes.includes("🟡") || b.notes.includes("🟢"));

    if (hasAlertA && !hasAlertB) return -1;
    if (!hasAlertA && hasAlertB) return 1;

    let valA: any;
    let valB: any;

    if (sort === "booking_source") {
      valA = getChannelName(a);
      valB = getChannelName(b);
    } else {
      valA = a[sort as keyof typeof a] || "";
      valB = b[sort as keyof typeof b] || "";
    }

    if (["total_customer", "total_supplier_cost", "total_people"].includes(sort)) {
      valA = Number(valA);
      valB = Number(valB);
    }

    if (valA < valB) return dir === "asc" ? -1 : 1;
    if (valA > valB) return dir === "asc" ? 1 : -1;
    return 0;
  });

  const totalVisiblePeople = allBookings.reduce(
    (sum, booking) => sum + getTotalSeatsCount(booking),
    0
  );

  const buildQuery = (
    updates: Record<string, string | null | undefined> = {}
  ) => {
    const sp = new URLSearchParams();

    if (q) sp.set("q", q);
    if (sort) sp.set("sort", sort);
    if (dir) sp.set("dir", dir);
    if (showPast) sp.set("past", "true");
    if (fromDate) sp.set("from", fromDate);
    if (toDate) sp.set("to", toDate);
    if (highlightId) sp.set("highlight", highlightId);
    if (businessUnitFilter) sp.set("bu", businessUnitFilter);
    if (venueFilter) sp.set("venue", venueFilter);
    if (exactDateList.length > 0) sp.set("dates", exactDateList.join(","));

    Object.entries(updates).forEach(([key, value]) => {
      if (value === null || value === undefined || value === "") {
        sp.delete(key);
      } else {
        sp.set(key, value);
      }
    });

    const query = sp.toString();
    return query ? `?${query}` : "?";
  };

  const buildSortUrl = (column: string) => {
    const newDir = sort === column && dir === "asc" ? "desc" : "asc";
    return buildQuery({
      sort: column,
      dir: newDir,
    });
  };

  const SortIcon = ({ column }: { column: string }) => {
    if (sort !== column) return null;
    return <span className="ml-1 text-zinc-900">{dir === "asc" ? "↑" : "↓"}</span>;
  };

  const isFmdqFilterActive = businessUnitFilter === "fmdq";
  const isFmdqVenueFilterActive = venueFilter === "fmdq";
  const isSpecificDatesFilterActive = exactDateList.length > 0;

  return (
    <AppShell
      title="Prenotazioni"
      subtitle="Gestisci prenotazioni, incassi, fornitori e notifiche operative"
    >
      <div className="space-y-4 sm:space-y-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm lg:hidden">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-sm text-zinc-500">Prenotazioni visibili</p>
                <p className="text-xl font-black text-zinc-900">
                  {allBookings.length}
                </p>
              </div>
              <div>
                <p className="text-sm text-zinc-500">Persone totali</p>
                <p className="text-xl font-black text-zinc-900">
                  {totalVisiblePeople}
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:flex lg:gap-3">
            <Link
              href="/prenotazioni/import"
              className="flex min-h-11 items-center justify-center gap-2 rounded-xl border-2 border-zinc-200 bg-white px-4 py-2.5 text-base font-bold text-zinc-700 shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50 sm:text-sm"
            >
              ⚙️ Strumenti Dati
            </Link>

            <Link
              href="/prenotazioni/nuova"
              className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-zinc-900 px-4 py-2.5 text-base font-bold text-white shadow-sm transition hover:bg-zinc-700 sm:text-sm"
            >
              + Nuova Prenotazione
            </Link>
          </div>
        </div>

        <SectionCard title="Ricerca e Filtri">
          <div className="space-y-4">
            <form method="GET" className="space-y-3">
              <input type="hidden" name="sort" value={sort} />
              <input type="hidden" name="dir" value={dir} />
              {showPast && <input type="hidden" name="past" value="true" />}
              {fromDate && <input type="hidden" name="from" value={fromDate} />}
              {toDate && <input type="hidden" name="to" value={toDate} />}
              {businessUnitFilter && <input type="hidden" name="bu" value={businessUnitFilter} />}
              {venueFilter && <input type="hidden" name="venue" value={venueFilter} />}
              {isSpecificDatesFilterActive && (
                <input type="hidden" name="dates" value={exactDateList.join(",")} />
              )}

              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex w-full overflow-hidden rounded-xl border border-zinc-300 bg-white transition focus-within:border-zinc-500 lg:max-w-xl">
                  <div className="flex items-center pl-3 text-zinc-400">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={2}
                      stroke="currentColor"
                      className="h-5 w-5"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
                      />
                    </svg>
                  </div>

                  <input
                    type="text"
                    name="q"
                    defaultValue={q}
                    placeholder="Cerca cliente, riferimento, esperienza, telefono..."
                    className="w-full border-none px-3 py-3 text-[17px] outline-none sm:text-sm"
                  />

                  <button
                    type="submit"
                    className="border-l border-zinc-200 bg-zinc-100 px-4 py-3 text-base font-medium text-zinc-700 hover:bg-zinc-200 sm:text-sm"
                  >
                    Cerca
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={buildQuery({
                      bu: isFmdqFilterActive ? null : "fmdq",
                    })}
                    className={`inline-flex min-h-11 items-center justify-center rounded-xl border px-4 py-2.5 text-base font-medium transition sm:text-sm ${
                      isFmdqFilterActive
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border-zinc-300 bg-white text-zinc-700"
                    }`}
                  >
                    {isFmdqFilterActive ? "Canale FMDQ ✓" : "Canale FMDQ"}
                  </Link>

                  <Link
                    href={buildQuery({
                      venue: isFmdqVenueFilterActive ? null : "fmdq",
                    })}
                    className={`inline-flex min-h-11 items-center justify-center rounded-xl border px-4 py-2.5 text-base font-medium transition sm:text-sm ${
                      isFmdqVenueFilterActive
                        ? "border-amber-200 bg-amber-50 text-amber-700"
                        : "border-zinc-300 bg-white text-zinc-700"
                    }`}
                  >
                    {isFmdqVenueFilterActive ? "In Fattoria ✓" : "In Fattoria"}
                  </Link>

                  <Link
                    href={buildQuery({
                      past: showPast ? null : "true",
                      from: null,
                      to: null,
                      dates: null,
                    })}
                    className={`inline-flex min-h-11 items-center justify-center rounded-xl border px-4 py-2.5 text-base font-medium transition sm:text-sm ${
                      showPast
                        ? "border-blue-200 bg-blue-50 text-blue-700"
                        : "border-zinc-300 bg-white text-zinc-700"
                    }`}
                  >
                    {showPast ? "👁 Nascondi Passate" : "🕒 Mostra Passate"}
                  </Link>

                  {isSpecificDatesFilterActive && (
                    <span className="inline-flex min-h-11 items-center justify-center rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-base font-medium text-amber-700 sm:text-sm">
                      Date specifiche: {exactDateList.length}
                    </span>
                  )}

                  {(fromDate ||
                    toDate ||
                    q ||
                    showPast ||
                    businessUnitFilter ||
                    venueFilter ||
                    isSpecificDatesFilterActive) && (
                    <Link
                      href="/prenotazioni"
                      className="inline-flex min-h-11 items-center rounded-xl px-2 text-base font-medium text-zinc-500 hover:text-zinc-800 hover:underline sm:text-sm"
                    >
                      Reset filtri
                    </Link>
                  )}
                </div>
              </div>
            </form>

            <div className="border-t border-zinc-100 pt-4">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                <form method="GET" className="grid gap-3 sm:grid-cols-3 xl:flex">
                  <input type="hidden" name="q" value={q} />
                  <input type="hidden" name="sort" value={sort} />
                  <input type="hidden" name="dir" value={dir} />
                  {showPast && <input type="hidden" name="past" value="true" />}
                  {businessUnitFilter && <input type="hidden" name="bu" value={businessUnitFilter} />}
                  {venueFilter && <input type="hidden" name="venue" value={venueFilter} />}

                  <div>
                    <label className="mb-1 block text-[11px] font-bold uppercase text-zinc-400">
                      Dal
                    </label>
                    <input
                      type="date"
                      name="from"
                      defaultValue={fromDate}
                      className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-[16px] outline-none focus:border-zinc-500 sm:text-sm"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-[11px] font-bold uppercase text-zinc-400">
                      Al
                    </label>
                    <input
                      type="date"
                      name="to"
                      defaultValue={toDate}
                      className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-[16px] outline-none focus:border-zinc-500 sm:text-sm"
                    />
                  </div>

                  <button
                    type="submit"
                    className="rounded-lg bg-zinc-900 px-4 py-2.5 text-base font-bold text-white transition hover:bg-zinc-700 sm:text-sm"
                  >
                    Applica Date
                  </button>
                </form>

                <div className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  <Link
                    href={buildQuery({
                      from: todayStr,
                      to: todayStr,
                      past: null,
                      dates: null,
                    })}
                    className="shrink-0 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-[12px] font-bold text-zinc-600 shadow-sm hover:bg-zinc-50"
                  >
                    Oggi
                  </Link>

                  <Link
                    href={buildQuery({
                      from: tomorrowStr,
                      to: tomorrowStr,
                      past: null,
                      dates: null,
                    })}
                    className="shrink-0 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-[12px] font-bold text-zinc-600 shadow-sm hover:bg-zinc-50"
                  >
                    Domani
                  </Link>

                  <Link
                    href={buildQuery({
                      from: firstDayMonth,
                      to: lastDayMonth,
                      past: null,
                      dates: null,
                    })}
                    className="shrink-0 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-[12px] font-bold text-zinc-600 shadow-sm hover:bg-zinc-50"
                  >
                    Questo Mese
                  </Link>

                  <Link
                    href={buildQuery({
                      from: "2026-01-01",
                      to: "2026-12-31",
                      past: null,
                      dates: null,
                    })}
                    className="shrink-0 rounded-lg border border-zinc-300 bg-zinc-100 px-3 py-2 text-[12px] font-bold text-zinc-800 shadow-sm hover:bg-zinc-200"
                  >
                    Tutto 2026
                  </Link>
                </div>
              </div>

              {isSpecificDatesFilterActive && (
                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  Filtro date specifiche attivo su{" "}
                  <strong>{exactDateList.length}</strong> date:{" "}
                  <strong>{exactDateList.map((d) => formatDate(d)).join(", ")}</strong>
                </div>
              )}
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title={`Elenco Prenotazioni (${allBookings.length} prenotazioni · ${totalVisiblePeople} persone)`}
        >
          <>
            <form
              id="summaryForm"
              action="/prenotazioni/riepilogo"
              method="GET"
              className="hidden"
            />

            <SummarySelectionToolbar formId="summaryForm" />

            <div className="mb-3 grid gap-3 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600 sm:grid-cols-3">
              <div>
                <div className="text-[11px] font-bold uppercase text-zinc-500">
                  Prenotazioni visibili
                </div>
                <div className="mt-1 text-xl font-black text-zinc-900">
                  {allBookings.length}
                </div>
              </div>

              <div>
                <div className="text-[11px] font-bold uppercase text-zinc-500">
                  Persone totali
                </div>
                <div className="mt-1 text-xl font-black text-zinc-900">
                  {totalVisiblePeople}
                </div>
              </div>

              <div className="sm:flex sm:items-end">
                <div className="text-sm text-zinc-600">
                  Seleziona le prenotazioni con la spunta e poi apri il riepilogo
                  per stampare il PDF o inviarlo via WhatsApp.
                </div>
              </div>
            </div>

            <div className="space-y-3 md:hidden">
              {allBookings.map((booking) => {
                const isCancelled = booking.is_cancelled === true;

                return (
                  <div key={booking.id} className="space-y-2">
                    <label
                      className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${
                        isCancelled
                          ? "border-zinc-200 bg-zinc-100 text-zinc-400"
                          : "border-zinc-200 bg-white text-zinc-700"
                      }`}
                    >
                      <input
                        type="checkbox"
                        name="ids"
                        value={booking.id}
                        form="summaryForm"
                        disabled={isCancelled}
                        className="h-5 w-5 rounded border-zinc-300"
                      />
                      <span className="text-sm font-medium">
                        {isCancelled
                          ? "Prenotazione annullata"
                          : "Seleziona per riepilogo"}
                      </span>
                    </label>

                    <MobileBookingCard
                      booking={booking}
                      highlightId={highlightId}
                      todayStr={todayStr}
                      tomorrowStr={tomorrowStr}
                    />
                  </div>
                );
              })}

              {allBookings.length === 0 && (
                <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 p-6 text-center text-base text-zinc-500 sm:text-sm">
                  Nessuna prenotazione trovata con i filtri attuali.
                </div>
              )}
            </div>

            <div className="hidden overflow-x-auto md:block">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-zinc-200 text-[10px] font-bold uppercase text-zinc-500">
                  <tr>
                    <th className="py-3 pr-4">Sel.</th>
                    <th className="cursor-pointer py-3 pr-4 transition hover:text-zinc-900">
                      <Link
                        href={buildSortUrl("booking_date")}
                        className="flex items-center"
                      >
                        Data / Ora <SortIcon column="booking_date" />
                      </Link>
                    </th>
                    <th className="cursor-pointer py-3 pr-4 transition hover:text-zinc-900">
                      <Link
                        href={buildSortUrl("customer_name")}
                        className="flex items-center"
                      >
                        Cliente / Rif. <SortIcon column="customer_name" />
                      </Link>
                    </th>
                    <th className="cursor-pointer py-3 pr-4 transition hover:text-zinc-900">
                      <Link
                        href={buildSortUrl("booking_source")}
                        className="flex items-center"
                      >
                        Canale / Esperienza <SortIcon column="booking_source" />
                      </Link>
                    </th>
                    <th className="py-3 pr-4">Stato / Note</th>
                    <th className="py-3 pr-4">Lordo</th>
                    <th className="py-3 pr-4">Pag. Agenzia</th>
                    <th className="py-3 pr-4">Pag. Fornitore</th>
                    <th className="py-3 pr-4 text-right">Azioni</th>
                  </tr>
                </thead>

                <tbody>
                  {allBookings.map((booking) => {
                    const isCancelled = booking.is_cancelled === true;
                    const isHighlighted = String(booking.id) === highlightId;
                    const isModifiedPermanent = booking.was_modified === true;
                    const bookingChannelName = getChannelName(booking);
                    const businessUnitCode = booking._business_unit_code;
                    const isInternalSupplier =
                      booking._is_internal_supplier === true;

                    const customerStatus = booking.customer_payment_status;
                    let customerBadgeClass = "bg-red-100 text-red-700";
                    let customerBadgeText = "Da Incassare";
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
                    let supplierBadgeText = "Da Saldare";

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

                    const payingPax =
                      Number(booking.adults || 0) + Number(booking.children || 0);
                    const nonPayingAdults = Number(
                      booking.non_paying_adults || 0
                    );
                    const totalSeats = getTotalSeatsCount(booking);

                    const wDate = formatDate(booking.booking_date);
                    const wTime = booking.booking_time
                      ? booking.booking_time.slice(0, 5)
                      : "Orario da def.";
                    const wChannel = bookingChannelName || "N/A";
                    const wRef = booking.booking_reference || "N/A";
                    const wName = booking.customer_name || "N/A";
                    const waText = `${payingPax} da te ${wDate} ore ${wTime} ${wChannel} ${wRef} ${wName}`;

                    const rawSupplier = booking.suppliers;
                    let rawPhone = "";
                    if (Array.isArray(rawSupplier)) {
                      rawPhone = rawSupplier[0]?.phone || "";
                    } else if (rawSupplier) {
                      rawPhone = rawSupplier.phone || "";
                    }
                    const cleanPhone = rawPhone.replace(/\D/g, "");
                    const waUrl = cleanPhone
                      ? `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(
                          waText
                        )}`
                      : `https://api.whatsapp.com/send?text=${encodeURIComponent(
                          waText
                        )}`;

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
                      <tr
                        key={booking.id}
                        className={`border-b border-zinc-100 transition duration-500 ${
                          isHighlighted
                            ? "bg-amber-50 ring-2 ring-inset ring-amber-200"
                            : isCancelled
                            ? "bg-zinc-50/50"
                            : "hover:bg-zinc-50"
                        }`}
                      >
                        <td className="py-4 pr-4 align-top">
                          <input
                            type="checkbox"
                            name="ids"
                            value={booking.id}
                            form="summaryForm"
                            disabled={isCancelled}
                            title={
                              isCancelled
                                ? "Prenotazione annullata"
                                : "Seleziona per riepilogo"
                            }
                            className="mt-1 h-4 w-4 rounded border-zinc-300"
                          />
                        </td>

                        <td className="whitespace-nowrap py-4 pr-4">
                          <div className="flex items-center gap-2">
                            <div className={`font-bold ${dateColorClass}`}>
                              {formatDate(booking.booking_date)}
                              {isToday && (
                                <span className="ml-1 text-[9px] font-black uppercase">
                                  Oggi
                                </span>
                              )}
                              {isTomorrow && (
                                <span className="ml-1 text-[9px] font-black uppercase">
                                  Dom
                                </span>
                              )}
                            </div>

                            {booking.booking_time && (
                              <div
                                className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${
                                  isCancelled
                                    ? "bg-zinc-200 text-zinc-400"
                                    : "bg-blue-50 text-blue-700"
                                }`}
                              >
                                {booking.booking_time.slice(0, 5)}
                              </div>
                            )}
                          </div>

                          {isModifiedPermanent && !isCancelled && (
                            <div className="mt-1">
                              <span className="inline-flex rounded-md border border-amber-300 bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800">
                                Modificata
                              </span>
                            </div>
                          )}

                          <div className="mt-1 text-[10px] font-medium text-zinc-400">
                            Ins: {formatDate(booking.booking_created_at)}
                          </div>
                        </td>

                        <td className="py-4 pr-4">
                          <div
                            className={`font-medium ${
                              isCancelled
                                ? "text-zinc-500 line-through"
                                : "text-zinc-900"
                            }`}
                          >
                            {booking.customer_name}
                          </div>
                          <div className="mt-0.5 text-[10px] font-mono text-zinc-500">
                            {booking.booking_reference || "-"}
                          </div>
                        </td>

                        <td className="py-4 pr-4">
                          <div className="mb-1 flex flex-wrap items-center gap-2">
                            <span className="inline-block rounded border border-zinc-200 bg-zinc-100 px-1.5 py-0.5 text-[10px] font-bold text-zinc-600">
                              {bookingChannelName || "-"}
                            </span>

                            <span
                              className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-bold ${getBusinessUnitBadgeClass(
                                businessUnitCode
                              )}`}
                            >
                              {getBusinessUnitLabel(businessUnitCode)}
                            </span>
                          </div>

                          <div className="max-w-[150px] truncate text-xs font-medium text-zinc-700">
                            {booking.experience_name}
                          </div>

                          <div className="mt-1 text-[10px] font-medium text-zinc-500">
                            {payingPax} paganti
                            {nonPayingAdults > 0 ? ` + ${nonPayingAdults} guide` : ""}
                            {" = "}
                            {totalSeats} posti
                          </div>
                        </td>

                        <td className="py-4 pr-4">
                          {hasAlert ? (
                            <form action={clearAlert}>
                              <input type="hidden" name="id" value={booking.id} />
                              <button
                                type="submit"
                                title="Clicca per confermare la presa visione"
                                className={`group -ml-1.5 max-w-[130px] cursor-pointer rounded p-1.5 text-left text-[11px] font-bold leading-tight transition-all ${
                                  booking.notes.includes("🔴")
                                    ? "text-red-600 hover:bg-red-50"
                                    : booking.notes.includes("🟡")
                                    ? "text-amber-600 hover:bg-amber-50"
                                    : "text-green-600 hover:bg-green-50"
                                }`}
                              >
                                {booking.notes}
                                <span className="mt-1 block text-[9px] font-medium text-zinc-400 underline group-hover:text-zinc-600">
                                  Segna come letto
                                </span>
                              </button>
                            </form>
                          ) : (
                            <div className="max-w-[130px] whitespace-normal text-[11px] text-zinc-400">
                              {booking.notes || "-"}
                            </div>
                          )}
                        </td>

                        <td className="py-4 pr-4">
                          <div className="font-bold text-zinc-900">
                            {formatEuro(Number(booking.total_customer || 0))}
                          </div>
                        </td>

                        <td className="py-4 pr-4">
                          <span
                            className={`rounded-lg px-2 py-1 text-[10px] font-bold uppercase ${
                              isCancelled
                                ? "bg-zinc-200 text-zinc-400"
                                : customerBadgeClass
                            }`}
                          >
                            {isCancelled ? "-" : customerBadgeText}
                          </span>
                        </td>

                        <td className="py-4 pr-4">
                          <span
                            className={`rounded-lg px-2 py-1 text-[10px] font-bold uppercase ${
                              isCancelled
                                ? "bg-zinc-200 text-zinc-400"
                                : supplierBadgeClass
                            }`}
                          >
                            {isCancelled ? "-" : supplierBadgeText}
                          </span>
                        </td>

                        <td className="py-4 pr-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Link
                              href={`/prenotazioni/${booking.id}/modifica?returnTo=/prenotazioni`}
                              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-[11px] font-medium text-zinc-700 shadow-sm hover:bg-zinc-100"
                            >
                              Modifica
                            </Link>

                            {!isCancelled && (
                              <a
                                href={waUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={`rounded-lg border px-3 py-2 text-[11px] font-bold shadow-sm transition ${
                                  cleanPhone
                                    ? "border-green-200 bg-green-50 text-green-700 hover:bg-green-100"
                                    : "border-zinc-200 bg-zinc-50 text-zinc-400 hover:bg-zinc-100"
                                }`}
                              >
                                WA
                              </a>
                            )}

                            {!isCancelled && (
                              <form action={cancelBooking} className="inline-block">
                                <input type="hidden" name="id" value={booking.id} />
                                <button
                                  type="submit"
                                  className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-bold text-red-700 shadow-sm hover:bg-red-100"
                                >
                                  Cancella
                                </button>
                              </form>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}

                  {allBookings.length === 0 && (
                    <tr>
                      <td
                        colSpan={9}
                        className="py-8 text-center text-sm text-zinc-500"
                      >
                        Nessuna prenotazione trovata con i filtri attuali.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-4">
              <SummarySelectionToolbar formId="summaryForm" />
            </div>
          </>
        </SectionCard>
      </div>
    </AppShell>
  );
}