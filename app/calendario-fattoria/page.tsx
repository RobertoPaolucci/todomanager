import Link from "next/link";
import AppShell from "@/components/AppShell";
import { supabaseServer } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

type Booking = {
  id: number;
  booking_reference: string | null;
  booking_date: string | null;
  booking_time: string | null;
  experience_id: number | null;
  experience_name: string | null;
  channel_id: number | null;
  is_cancelled: boolean | null;
  total_people: number | null;
  adults: number | null;
  children: number | null;
  infants: number | null;
  non_paying_adults: number | null;
  customer_name: string | null;
  customer_phone: string | null;
  booking_source: string | null;
  channels: { name: string | null } | { name: string | null }[] | null;
};

// Codici del catalogo Bokun: bookings.experience_id usa invece experiences.id.
const experiences: Record<string, { label: string; color: string }> = {
  "956471": { label: "Cena", color: "border-rose-200 bg-rose-50 text-rose-900" },
  "992013": { label: "Cooking", color: "border-orange-200 bg-orange-50 text-orange-900" },
  "1174621": { label: "Sapone + Pranzo", color: "border-pink-200 bg-pink-50 text-pink-900" },
  "1056312": { label: "E-Bike + Vini", color: "border-cyan-200 bg-cyan-50 text-cyan-900" },
  "1052970": { label: "E-Bike Tour", color: "border-sky-200 bg-sky-50 text-sky-900" },
  "1069172": { label: "E-Bike Noleggio", color: "border-blue-200 bg-blue-50 text-blue-900" },
  "1150881": { label: "Quad 1h + Pranzo", color: "border-violet-200 bg-violet-50 text-violet-900" },
  "1108658": { label: "Cavallo + Pranzo", color: "border-amber-200 bg-amber-50 text-amber-900" },
  "1109713": { label: "Cavallo + Pranzo 2", color: "border-yellow-200 bg-yellow-50 text-yellow-900" },
  "1149151": { label: "Quad Sentieri + Pranzo", color: "border-purple-200 bg-purple-50 text-purple-900" },
  "956474": { label: "Quad Val d'Orcia + Pranzo", color: "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-900" },
  "956472": { label: "Visita + Pranzo", color: "border-emerald-200 bg-emerald-50 text-emerald-900" },
  "1196268": { label: "Visita + Tagliere", color: "border-teal-200 bg-teal-50 text-teal-900" },
};

const tableExperienceCodes = new Set([
  "956471", "992013", "1174621", "1150881", "1108658",
  "1109713", "1149151", "956474", "956472", "1196268",
]);

function isTuscanEscape(booking: Booking) {
  return booking.experience_id === 22 || booking.channel_id === 7 ||
    booking.booking_source?.trim().toLowerCase() === "tuscan escape" ||
    /tuscan\s+escape/i.test(booking.experience_name ?? "");
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function monthHref(date: Date) {
  return `/calendario-fattoria?mese=${dateKey(date).slice(0, 7)}`;
}

function peopleCount(booking: Booking) {
  if (Number(booking.total_people) > 0) {
    return Number(booking.total_people);
  }
  return Number(booking.adults || 0) + Number(booking.children || 0) +
    Number(booking.infants || 0) +
    (isTuscanEscape(booking) ? 0 : Number(booking.non_paying_adults || 0));
}

function tooltipPeople(booking: Booking) {
  return [
    { count: booking.adults, singular: "adulto", plural: "adulti" },
    { count: booking.children, singular: "bambino", plural: "bambini" },
    { count: booking.infants, singular: "neonato", plural: "neonati" },
    { count: booking.non_paying_adults, singular: "guida", plural: "guide" },
  ].filter(({ count }) => Number(count) > 0)
    .map(({ count, singular, plural }) => `${count} ${Number(count) === 1 ? singular : plural}`)
    .join(" + ");
}

function tooltipChannel(booking: Booking) {
  const channel = Array.isArray(booking.channels) ? booking.channels[0] : booking.channels;
  return channel?.name?.trim() || booking.booking_source?.trim() || "";
}

async function loadCurrentBookings() {
  const latestByReference = new Map<string, Booking>();
  const pageSize = 1000;

  // Stessa regola di getHistoryKey/buildHistoryGroups in Prenotazioni:
  // riferimento trim + uppercase, ID maggiore corrente, senza riferimento separato.
  // Leggere tutte le versioni PRIMA dei filtri evita di recuperare righe obsolete.
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabaseServer
      .from("bookings")
      .select("id, booking_reference, booking_date, booking_time, experience_id, experience_name, channel_id, is_cancelled, total_people, adults, children, infants, non_paying_adults, customer_name, customer_phone, booking_source, channels(name)")
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) throw new Error("Impossibile caricare le prenotazioni.");
    const rows: Booking[] = data || [];
    for (const booking of rows) {
      const reference = String(booking.booking_reference ?? "").trim();
      const key = reference ? reference.toUpperCase() : `NO-REF-${booking.id}`;
      const current = latestByReference.get(key);
      if (!current || Number(booking.id || 0) > Number(current.id || 0)) {
        latestByReference.set(key, booking);
      }
    }
    if (rows.length < pageSize) break;
  }
  return Array.from(latestByReference.values());
}

export default async function CalendarioFattoriaPage({ searchParams }: {
  searchParams: Promise<{ mese?: string | string[] }>;
}) {
  const params = await searchParams;
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const requestedMonth = typeof params.mese === "string" ? params.mese : "";
  const month = /^(?:[1-9]\d{3})-(?:0[1-9]|1[0-2])$/.test(requestedMonth)
    ? requestedMonth : today.slice(0, 7);
  const first = new Date(`${month}-01T00:00:00Z`);
  const year = first.getUTCFullYear();
  const monthIndex = first.getUTCMonth();
  const previous = new Date(Date.UTC(year, monthIndex - 1, 1));
  const next = new Date(Date.UTC(year, monthIndex + 1, 1));
  const last = new Date(Date.UTC(year, monthIndex + 1, 0));
  const offset = (first.getUTCDay() + 6) % 7;
  const dayCount = Math.ceil((offset + last.getUTCDate()) / 7) * 7;
  const days = Array.from({ length: dayCount }, (_, index) =>
    new Date(Date.UTC(year, monthIndex, 1 - offset + index))
  );
  const title = new Intl.DateTimeFormat("it-IT", {
    month: "long", year: "numeric", timeZone: "UTC",
  }).format(first);

  const bookingsByDay = new Map<string, { booking: Booking; label: string; color: string }[]>();
  const tableExperienceIds = new Set<string>();
  let loadFailed = false;
  try {
    const [bookings, catalog] = await Promise.all([
      loadCurrentBookings(),
      supabaseServer.from("experiences").select("id, bokun_id")
        .in("bokun_id", Object.keys(experiences)),
    ]);
    if (catalog.error) throw new Error("Impossibile caricare le esperienze.");
    for (const experience of catalog.data || []) {
      if (tableExperienceCodes.has(String(experience.bokun_id))) {
        tableExperienceIds.add(String(experience.id));
      }
    }
    const experienceById = new Map(
      (catalog.data || []).map((experience) => [String(experience.id), experiences[String(experience.bokun_id)]])
    );
    const startDate = dateKey(days[0]);
    const endDate = dateKey(days[days.length - 1]);
    for (const booking of bookings) {
      const experience = isTuscanEscape(booking)
        ? { label: "Tuscan Escape", color: "border-indigo-300 bg-indigo-100 text-indigo-950" }
        : experienceById.get(String(booking.experience_id));
      if (booking.is_cancelled === true || !experience || !booking.booking_date ||
        booking.booking_date < startDate || booking.booking_date > endDate) continue;
      const list = bookingsByDay.get(booking.booking_date) || [];
      list.push({ booking, ...experience });
      bookingsByDay.set(booking.booking_date, list);
    }
  } catch {
    loadFailed = true;
  }

  const navigationClass = "inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-zinc-300 bg-white px-3 font-semibold text-zinc-700 transition hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900";

  return (
    <AppShell title="Calendario Fattoria" subtitle="Le prenotazioni della fattoria, mese per mese">
      <section aria-labelledby="calendar-month" className="rounded-2xl border border-zinc-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4 p-4 sm:p-5">
          <h2 id="calendar-month" className="text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl">{title}</h2>
          <nav aria-label="Navigazione del calendario" className="flex items-center gap-2">
            <Link href={monthHref(previous)} prefetch={false} aria-label="Mese precedente" className={navigationClass}>←</Link>
            <Link href={monthHref(next)} prefetch={false} aria-label="Mese successivo" className={navigationClass}>→</Link>
            <Link href={`/calendario-fattoria?mese=${today.slice(0, 7)}`} prefetch={false} className={navigationClass}>Oggi</Link>
          </nav>
        </div>
        {loadFailed ? (
          <p role="alert" className="m-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            Impossibile caricare il calendario. Ricarica la pagina per riprovare.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-7 border-t border-zinc-200 bg-zinc-50">
              {["lun", "mar", "mer", "gio", "ven", "sab", "dom"].map((day) => (
                <div key={day} className="py-3 text-center text-xs font-bold text-zinc-600 sm:text-sm">{day}</div>
              ))}
            </div>
            {/* Righe auto: nessuna altezza massima, scroll interno o evento nascosto. */}
            <div className="grid grid-cols-7">
              {days.map((day) => {
                const key = dateKey(day);
                const isToday = key === today;
                const inMonth = day.getUTCMonth() === monthIndex;
                const dayBookings = bookingsByDay.get(key) || [];
                const tableBookings = dayBookings.filter(({ booking }) =>
                  isTuscanEscape(booking) || tableExperienceIds.has(String(booking.experience_id))
                );
                const tablePeople = tableBookings.reduce(
                  (total, { booking }) => total + peopleCount(booking), 0
                );
                return (
                  <div key={key} className={`@container relative hover:z-40 focus-within:z-40 min-h-28 min-w-0 border-t border-r border-zinc-200 p-0.5 last:border-r-0 sm:min-h-36 sm:p-2 [&:nth-child(7n)]:border-r-0 ${isToday ? "bg-emerald-50/50 ring-2 ring-inset ring-emerald-500" : inMonth ? "bg-white" : "bg-zinc-100/70"}`}>
                    <div className="mb-2 flex min-w-0 items-center gap-0.5 sm:gap-1">
                    <time dateTime={key} aria-current={isToday ? "date" : undefined}
                      aria-label={`${new Intl.DateTimeFormat("it-IT", { dateStyle: "full", timeZone: "UTC" }).format(day)}${isToday ? ", oggi" : ""}`}
                      className={`inline-flex h-[clamp(12px,24cqw,28px)] w-[clamp(12px,24cqw,28px)] shrink-0 items-center justify-center rounded-full bg-white text-[clamp(8px,14cqw,14px)] font-bold ${isToday ? "border-2 border-emerald-600 text-emerald-700" : inMonth ? "border border-zinc-300 text-zinc-800" : "border border-zinc-200 text-zinc-400"}`}>
                      {day.getUTCDate()}
                    </time>
                    {tableBookings.length > 0 && (
                      <span
                        aria-label={`${tableBookings.length} tavoli, ${tablePeople} persone`}
                        className={`whitespace-nowrap text-[clamp(4px,10cqw,11px)] font-semibold leading-tight tracking-tight ${inMonth ? "text-zinc-700" : "text-zinc-400"}`}
                      >
                        {tableBookings.length} T · {tablePeople} pax
                      </span>
                    )}
                    </div>
                    <ul className="space-y-1.5">
                      {dayBookings.map(({ booking, label, color }) => (
                        <li key={booking.id} className="group/booking relative">
                          <Link href={`/prenotazioni/${booking.id}/modifica`} prefetch={false}
                            aria-describedby={`booking-tooltip-${booking.id}`}
                            className={`peer block rounded-md border px-0.5 py-2 text-[10px] font-semibold leading-snug whitespace-normal [overflow-wrap:anywhere] transition hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-zinc-900 sm:px-1.5 sm:text-xs ${color}`}>
                            {peopleCount(booking)} {label}
                          </Link>
                          <div
                            id={`booking-tooltip-${booking.id}`}
                            role="tooltip"
                            className={`pointer-events-none absolute top-full z-50 mt-1 hidden w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-zinc-200 bg-white p-3 text-left text-xs leading-relaxed text-zinc-700 shadow-lg [overflow-wrap:anywhere] [@media(hover:hover)_and_(pointer:fine)]:group-hover/booking:block [@media(hover:hover)_and_(pointer:fine)]:peer-focus-visible:block ${day.getUTCDay() === 0 || day.getUTCDay() >= 4 ? "right-0" : "left-0"}`}
                          >
                            {isTuscanEscape(booking) ? (
                              <>
                                <p className="font-bold text-zinc-900">Tuscan Escape</p>
                                <p>Ora: {booking.booking_time?.slice(0, 5) || "Da definire"}</p>
                                <p>{tooltipPeople(booking) || "1 adulto"} (provvisorio)</p>
                                <p>Canale: Tuscan Escape</p>
                                <p>Booking #{booking.id}</p>
                                {booking.booking_reference && <p>Riferimento: {booking.booking_reference}</p>}
                              </>
                            ) : (
                              <>
                            {tooltipPeople(booking) && <p>{tooltipPeople(booking)}</p>}
                            <p className="font-bold text-zinc-900">{label}</p>
                            {tooltipChannel(booking) && <p>{tooltipChannel(booking)}</p>}
                            {booking.customer_name?.trim() && <p>{booking.customer_name.trim()}</p>}
                            {booking.customer_phone?.trim() && <p>{booking.customer_phone.trim()}</p>}
                              </>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
            {bookingsByDay.size === 0 && (
              <p className="border-t border-zinc-200 p-4 text-center text-sm text-zinc-500">Nessuna prenotazione per le esperienze selezionate nel periodo visualizzato.</p>
            )}
          </>
        )}
      </section>
    </AppShell>
  );
}
