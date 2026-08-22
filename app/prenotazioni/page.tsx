export const dynamic = "force-dynamic";

import Link from "next/link";
import AppShell from "@/components/AppShell";
import SectionCard from "@/components/SectionCard";
import MobileBookingCard from "@/components/MobileBookingCard";
import SummarySelectionToolbar from "@/components/SummarySelectionToolbar";
import BookingDateRangeFilter from "@/components/BookingDateRangeFilter";
import { supabaseServer } from "@/lib/supabase-server";
import { cancelBooking, restoreBooking, clearAlert } from "./actions";

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

type BookingWithHistory = any & {
  _is_history_latest?: boolean;
  _is_history_old?: boolean;
  _has_history?: boolean;
  _history_count?: number;
  _history_index?: number;
  _previous_booking?: any | null;
  _history_latest?: any;
  _history_versions?: any[];
};

function normalizeHistoryValue(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizeHistoryNumber(value: unknown) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? String(n) : "0";
}

function getHistoryKey(booking: any) {
  const reference = normalizeHistoryValue(booking.booking_reference);
  if (reference) return reference.toUpperCase();
  return `NO-REF-${booking.id}`;
}

function fieldChanged(booking: any, field: string) {
  const previous = booking._previous_booking;
  if (!previous) return false;

  return normalizeHistoryValue(booking[field]) !== normalizeHistoryValue(previous[field]);
}

function anyFieldChanged(booking: any, fields: string[]) {
  return fields.some((field) => fieldChanged(booking, field));
}

function peopleChanged(booking: any) {
  const previous = booking._previous_booking;
  if (!previous) return false;

  return (
    normalizeHistoryNumber(booking.adults) !== normalizeHistoryNumber(previous.adults) ||
    normalizeHistoryNumber(booking.children) !== normalizeHistoryNumber(previous.children) ||
    normalizeHistoryNumber(booking.infants) !== normalizeHistoryNumber(previous.infants) ||
    normalizeHistoryNumber(booking.non_paying_adults) !== normalizeHistoryNumber(previous.non_paying_adults) ||
    normalizeHistoryNumber(booking.total_people) !== normalizeHistoryNumber(previous.total_people)
  );
}

function moneyChanged(booking: any, field: string) {
  const previous = booking._previous_booking;
  if (!previous) return false;

  return Number(booking[field] || 0) !== Number(previous[field] || 0);
}

function changedClass(booking: any, changed: boolean) {
  if (!changed) return "";

  if (booking._is_history_old) {
    return "rounded bg-yellow-100 px-1 py-0.5 font-black text-zinc-500 ring-1 ring-yellow-200";
  }

  return "rounded bg-yellow-200 px-1 py-0.5 font-black text-zinc-950 ring-1 ring-yellow-300";
}

function rowBaseClass(booking: any, isHighlighted: boolean, isCancelled: boolean) {
  if (booking._is_history_old) {
    return "bg-zinc-100 text-zinc-400 line-through opacity-80";
  }

  if (isHighlighted) {
    return "bg-amber-50 ring-2 ring-inset ring-amber-200";
  }

  if (isCancelled) {
    return "bg-zinc-50/50";
  }

  if (booking._has_history) {
    return "bg-amber-50/30 hover:bg-amber-50/50";
  }

  return "hover:bg-zinc-50";
}

function stickyBaseClass(booking: any, isHighlighted: boolean, isCancelled: boolean) {
  if (booking._is_history_old) return "bg-zinc-100";
  if (isHighlighted) return "bg-amber-50";
  if (isCancelled) return "bg-zinc-50";
  if (booking._has_history) return "bg-amber-50/70 group-hover:bg-amber-50";
  return "bg-white group-hover:bg-zinc-50";
}

function buildHistoryGroups(bookings: any[]) {
  const groups = new Map<string, any[]>();

  bookings.forEach((booking) => {
    const key = getHistoryKey(booking);
    const list = groups.get(key) || [];
    list.push(booking);
    groups.set(key, list);
  });

  return Array.from(groups.values()).map((group) => {
    const versions = [...group].sort((a, b) => Number(b.id || 0) - Number(a.id || 0));
    const latest = versions[0];

    const preparedVersions = versions.map((booking, index) => ({
      ...booking,
      _is_history_latest: index === 0,
      _is_history_old: index > 0,
      _has_history: versions.length > 1,
      _history_count: versions.length,
      _history_index: index,
      _previous_booking: versions[index + 1] || null,
      _history_latest: latest,
      _history_versions: versions,
    }));

    return {
      latest,
      versions: preparedVersions,
    };
  });
}

function bookingMatchesSearch(booking: any, term: string) {
  const bookingChannelName = getChannelName(booking);
  const businessUnitLabel = getBusinessUnitLabel(booking._business_unit_code);
  const businessUnitName = booking._business_unit_name || "";

  return (
    (booking.customer_name || "").toLowerCase().includes(term) ||
    (booking.booking_reference || "").toLowerCase().includes(term) ||
    (booking.experience_name || "").toLowerCase().includes(term) ||
    (bookingChannelName || "").toLowerCase().includes(term) ||
    (booking.customer_phone || "").toLowerCase().includes(term) ||
    (booking.customer_email || "").toLowerCase().includes(term) ||
    businessUnitLabel.toLowerCase().includes(term) ||
    businessUnitName.toLowerCase().includes(term)
  );
}

function historyGroupHasAlert(group: { latest: any; versions: any[] }) {
  return group.versions.some(
    (booking) =>
      booking.notes &&
      (booking.notes.includes("🔴") || booking.notes.includes("🟡") || booking.notes.includes("🟢"))
  );
}

async function loadAllBookings() {
  const pageSize = 1000;
  const rows: any[] = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabaseServer
      .from("bookings")
      .select("*, suppliers(id, name, phone), channels(name)")
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) {
      return { data: rows, error };
    }

    const page = data || [];
    rows.push(...page);

    if (page.length < pageSize) {
      break;
    }
  }

  return { data: rows, error: null };
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
    loadAllBookings(),
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

  const enrichedBookings = bookings.map((booking) => {
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

  let historyGroups = buildHistoryGroups(enrichedBookings);

  historyGroups = historyGroups.filter((group) => {
    const latest = group.latest;

    if (group.versions.some((booking) => String(booking.id) === highlightId)) {
      return true;
    }

    if (exactDateSet.size > 0) {
      if (!latest.booking_date || !exactDateSet.has(latest.booking_date)) {
        return false;
      }
    }

    if (latest.booking_date) {
      if (fromDate && latest.booking_date < fromDate) return false;
      if (toDate && latest.booking_date > toDate) return false;

      const shouldHidePastByDefault =
        !fromDate &&
        !toDate &&
        exactDateSet.size === 0 &&
        !showPast &&
        !q;

      if (shouldHidePastByDefault && latest.booking_date < todayStr) {
        return false;
      }
    } else {
      if (exactDateSet.size > 0) return false;
    }

    if (businessUnitFilter && latest._business_unit_code !== businessUnitFilter) {
      return false;
    }

    if (venueFilter === "fmdq" && !isFmdqVenueBooking(latest)) {
      return false;
    }

    if (q) {
      const term = q.toLowerCase();
      const match = group.versions.some((booking) =>
        bookingMatchesSearch(booking, term)
      );

      if (!match) return false;
    }

    return true;
  });

  historyGroups.sort((groupA, groupB) => {
    const hasAlertA = historyGroupHasAlert(groupA);
    const hasAlertB = historyGroupHasAlert(groupB);

    if (hasAlertA && !hasAlertB) return -1;
    if (!hasAlertA && hasAlertB) return 1;

    const a = groupA.latest;
    const b = groupB.latest;

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

    return Number(b.id || 0) - Number(a.id || 0);
  });

  const allBookings = historyGroups.flatMap((group) => group.versions);
  const currentVisibleBookings = allBookings.filter(
    (booking) => booking._is_history_latest
  );
  const historyVisibleRows = allBookings.filter(
    (booking) => booking._is_history_old
  );

  const totalVisiblePeople = currentVisibleBookings.reduce(
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
                  {currentVisibleBookings.length}
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
                <BookingDateRangeFilter
                  fromDate={fromDate}
                  toDate={toDate}
                  q={q}
                  sort={sort}
                  dir={dir}
                  showPast={showPast}
                  businessUnitFilter={businessUnitFilter}
                  venueFilter={venueFilter}
                />

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
          title={`Elenco Prenotazioni (${currentVisibleBookings.length} attuali · ${historyVisibleRows.length} storico · ${totalVisiblePeople} persone)`}
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
                  {currentVisibleBookings.length}
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
                const isOldHistory = booking._is_history_old === true;
                const isSelectable = !isCancelled && !isOldHistory;

                return (
                  <div
                    key={booking.id}
                    className={`space-y-2 ${
                      isOldHistory ? "rounded-2xl bg-zinc-100 p-2 text-zinc-400 line-through opacity-80" : ""
                    }`}
                  >
                    {booking._has_history && (
                      <div
                        className={`rounded-xl border px-3 py-2 text-xs font-black uppercase tracking-wide ${
                          isOldHistory
                            ? "border-zinc-200 bg-zinc-100 text-zinc-500"
                            : "border-amber-200 bg-amber-50 text-amber-700"
                        }`}
                      >
                        {isOldHistory
                          ? `Versione precedente ${booking._history_index + 1}/${booking._history_count}`
                          : `Ultima versione · storico ${booking._history_count}`}
                      </div>
                    )}

                    <label
                      className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${
                        !isSelectable
                          ? "border-zinc-200 bg-zinc-100 text-zinc-400"
                          : "border-zinc-200 bg-white text-zinc-700"
                      }`}
                    >
                      <input
                        type="checkbox"
                        name="ids"
                        value={booking.id}
                        form="summaryForm"
                        disabled={!isSelectable}
                        className="h-5 w-5 rounded border-zinc-300"
                      />
                      <span className="text-sm font-medium">
                        {isOldHistory
                          ? "Versione storica"
                          : isCancelled
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


            <div className="hidden overflow-x-auto rounded-2xl md:block">
              <table className="min-w-[1520px] text-left text-sm xl:min-w-full">
                <colgroup>
                  <col className="w-[55px]" />
                  <col className="w-[155px]" />
                  <col className="w-[180px]" />
                  <col className="w-[215px]" />
                  <col className="w-[165px]" />
                  <col className="w-[110px]" />
                  <col className="w-[125px]" />
                  <col className="w-[130px]" />
                  <col className="w-[285px]" />
                </colgroup>

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
                    <th className="sticky right-0 z-20 bg-white py-3 pl-4 pr-4 text-right shadow-[-10px_0_16px_-14px_rgba(0,0,0,0.45)]">
                      Azioni
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {allBookings.map((booking) => {
                    const isCancelled = booking.is_cancelled === true;
                    const isOldHistory = booking._is_history_old === true;
                    const isHighlighted = String(booking.id) === highlightId;
                    const isModifiedPermanent =
                      booking.was_modified === true ||
                      (booking._has_history === true && !isOldHistory);
                    const bookingChannelName = getChannelName(booking);
                    const businessUnitCode = booking._business_unit_code;
                    const isInternalSupplier =
                      booking._is_internal_supplier === true;

                    const rowClass = rowBaseClass(
                      booking,
                      isHighlighted,
                      isCancelled
                    );

                    const stickyCellClass = stickyBaseClass(
                      booking,
                      isHighlighted,
                      isCancelled
                    );

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
                    if (isOldHistory) {
                      dateColorClass = "text-zinc-500";
                    } else if (isCancelled) {
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

                    const dateChanged = fieldChanged(booking, "booking_date");
                    const timeChanged = fieldChanged(booking, "booking_time");
                    const customerChanged = anyFieldChanged(booking, [
                      "customer_name",
                      "customer_email",
                      "customer_phone",
                    ]);
                    const referenceChanged = fieldChanged(
                      booking,
                      "booking_reference"
                    );
                    const channelChanged = anyFieldChanged(booking, [
                      "booking_source",
                      "channel_id",
                    ]);
                    const experienceChanged = anyFieldChanged(booking, [
                      "experience_name",
                      "experience_id",
                      "supplier_id",
                    ]);
                    const totalCustomerChanged = moneyChanged(
                      booking,
                      "total_customer"
                    );
                    const customerPaymentChanged = anyFieldChanged(booking, [
                      "customer_payment_status",
                    ]);
                    const supplierPaymentChanged = anyFieldChanged(booking, [
                      "supplier_payment_status",
                      "supplier_amount_paid",
                      "total_supplier_cost",
                    ]);
                    const statusChanged = anyFieldChanged(booking, [
                      "is_cancelled",
                      "status",
                      "notes",
                    ]);
                    const createdChanged = fieldChanged(
                      booking,
                      "booking_created_at"
                    );

                    const canSelect = !isCancelled && !isOldHistory;

                    return (
                      <tr
                        key={booking.id}
                        className={`group border-b border-zinc-100 transition duration-500 ${rowClass}`}
                      >
                        <td className="py-4 pr-4 align-top">
                          <input
                            type="checkbox"
                            name="ids"
                            value={booking.id}
                            form="summaryForm"
                            disabled={!canSelect}
                            title={
                              isOldHistory
                                ? "Versione storica non selezionabile"
                                : isCancelled
                                ? "Prenotazione annullata"
                                : "Seleziona per riepilogo"
                            }
                            className="mt-1 h-4 w-4 rounded border-zinc-300"
                          />
                        </td>

                        <td className="whitespace-nowrap py-4 pr-4">
                          <div className="flex items-center gap-2">
                            <div
                              className={`font-bold ${dateColorClass} ${changedClass(
                                booking,
                                dateChanged
                              )}`}
                            >
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
                                  timeChanged
                                    ? changedClass(booking, true)
                                    : isOldHistory || isCancelled
                                    ? "bg-zinc-200 text-zinc-400"
                                    : "bg-blue-50 text-blue-700"
                                }`}
                              >
                                {booking.booking_time.slice(0, 5)}
                              </div>
                            )}
                          </div>

                          {booking._has_history && (
                            <div className="mt-1">
                              <span
                                className={`inline-flex rounded-md border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                                  isOldHistory
                                    ? "border-zinc-300 bg-zinc-100 text-zinc-500"
                                    : "border-amber-300 bg-amber-100 text-amber-800"
                                }`}
                              >
                                {isOldHistory
                                  ? `Storico ${booking._history_index + 1}/${booking._history_count}`
                                  : `Ultima versione · ${booking._history_count}`}
                              </span>
                            </div>
                          )}

                          {isModifiedPermanent && !isCancelled && !booking._has_history && (
                            <div className="mt-1">
                              <span className="inline-flex rounded-md border border-amber-300 bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800">
                                Modificata
                              </span>
                            </div>
                          )}

                          <div
                            className={`mt-1 text-[10px] font-medium text-zinc-400 ${changedClass(
                              booking,
                              createdChanged
                            )}`}
                          >
                            Ins: {formatDate(booking.booking_created_at)}
                          </div>
                        </td>

                        <td className="py-4 pr-4">
                          <div
                            className={`font-medium ${
                              isOldHistory || isCancelled
                                ? "text-zinc-500"
                                : "text-zinc-900"
                            } ${changedClass(booking, customerChanged)}`}
                          >
                            {booking.customer_name}
                          </div>
                          <div
                            className={`mt-0.5 text-[10px] font-mono text-zinc-500 ${changedClass(
                              booking,
                              referenceChanged
                            )}`}
                          >
                            {booking.booking_reference || "-"}
                          </div>
                        </td>

                        <td className="py-4 pr-4">
                          <div className="mb-1 flex flex-wrap items-center gap-2">
                            <span
                              className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-bold ${
                                channelChanged
                                  ? changedClass(booking, true)
                                  : "border-zinc-200 bg-zinc-100 text-zinc-600"
                              }`}
                            >
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

                          <div
                            className={`max-w-[150px] truncate text-xs font-medium text-zinc-700 ${changedClass(
                              booking,
                              experienceChanged
                            )}`}
                          >
                            {booking.experience_name}
                          </div>

                          <div
                            className={`mt-1 text-[10px] font-medium text-zinc-500 ${changedClass(
                              booking,
                              peopleChanged(booking)
                            )}`}
                          >
                            {payingPax} paganti
                            {nonPayingAdults > 0 ? ` + ${nonPayingAdults} guide` : ""}
                            {" = "}
                            {totalSeats} posti
                          </div>
                        </td>

                        <td className="py-4 pr-4">
                          {hasAlert && !isOldHistory ? (
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
                                } ${changedClass(booking, statusChanged)}`}
                              >
                                {booking.notes}
                                <span className="mt-1 block text-[9px] font-medium text-zinc-400 underline group-hover:text-zinc-600">
                                  Segna come letto
                                </span>
                              </button>
                            </form>
                          ) : (
                            <div
                              className={`max-w-[130px] whitespace-normal text-[11px] text-zinc-400 ${changedClass(
                                booking,
                                statusChanged
                              )}`}
                            >
                              {booking.notes || (isOldHistory ? "Versione storica" : "-")}
                            </div>
                          )}
                        </td>

                        <td className="py-4 pr-4">
                          <div
                            className={`font-bold ${
                              isOldHistory ? "text-zinc-500" : "text-zinc-900"
                            } ${changedClass(booking, totalCustomerChanged)}`}
                          >
                            {formatEuro(Number(booking.total_customer || 0))}
                          </div>
                        </td>

                        <td className="py-4 pr-4">
                          <span
                            className={`rounded-lg px-2 py-1 text-[10px] font-bold uppercase ${
                              isOldHistory || isCancelled
                                ? "bg-zinc-200 text-zinc-400"
                                : customerBadgeClass
                            } ${changedClass(booking, customerPaymentChanged)}`}
                          >
                            {isOldHistory ? "Storico" : isCancelled ? "-" : customerBadgeText}
                          </span>
                        </td>

                        <td className="py-4 pr-4">
                          <span
                            className={`rounded-lg px-2 py-1 text-[10px] font-bold uppercase ${
                              isOldHistory || isCancelled
                                ? "bg-zinc-200 text-zinc-400"
                                : supplierBadgeClass
                            } ${changedClass(booking, supplierPaymentChanged)}`}
                          >
                            {isOldHistory ? "Storico" : isCancelled ? "-" : supplierBadgeText}
                          </span>
                        </td>

                        <td
                          className={`sticky right-0 z-10 py-4 pl-4 pr-4 text-right shadow-[-10px_0_16px_-14px_rgba(0,0,0,0.45)] transition-colors ${stickyCellClass}`}
                        >
                          {isOldHistory ? (
                            <span className="inline-flex rounded-lg border border-zinc-300 bg-zinc-100 px-3 py-2 text-[11px] font-bold text-zinc-500">
                              Storico
                            </span>
                          ) : (
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

                              {isCancelled ? (
                                <form action={restoreBooking} className="inline-block">
                                  <input type="hidden" name="id" value={booking.id} />
                                  <button
                                    type="submit"
                                    className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-[11px] font-bold text-green-700 shadow-sm hover:bg-green-100"
                                  >
                                    Ripristina
                                  </button>
                                </form>
                              ) : (
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
                          )}
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
