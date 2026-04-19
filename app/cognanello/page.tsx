export const dynamic = "force-dynamic";

import Link from "next/link";
import AppShell from "@/components/AppShell";
import SectionCard from "@/components/SectionCard";
import AutoRefreshClient from "@/components/AutoRefreshClient";
import CognanelloBookingList from "@/components/CognanelloBookingList";
import { supabaseServer } from "@/lib/supabase-server";

const EXPERIENCE_IDS = [1, 8, 9];
const PAST_START_DATE = "2026-01-01";

type SearchParams = Promise<{
  q?: string | string[];
  from?: string | string[];
  to?: string | string[];
  channel?: string | string[];
  past?: string | string[];
}>;

type ChannelRow = {
  id: number;
  name: string | null;
};

type RelationChannel =
  | {
      id: number;
      name: string | null;
    }
  | Array<{
      id: number;
      name: string | null;
    }>
  | null;

type RelationExperience =
  | {
      id: number;
      name: string | null;
    }
  | Array<{
      id: number;
      name: string | null;
    }>
  | null;

type BookingRow = {
  id: number;
  booking_reference: string | null;
  booking_date: string | null;
  booking_time: string | null;
  booking_created_at: string | null;
  customer_name: string | null;
  adults: number | null;
  children: number | null;
  infants: number | null;
  channel_id: number | null;
  experience_id: number | null;
  channel: RelationChannel;
  experience: RelationExperience;
};

type BookingListItem = {
  id: number;
  booking_reference: string | null;
  booking_date: string | null;
  booking_time: string | null;
  booking_created_at: string | null;
  customer_name: string | null;
  adults: number | null;
  children: number | null;
  infants: number | null;
  channel_name: string;
  experience_name: string;
};

function getParam(value?: string | string[]) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function isExcludedChannelName(name: string | null) {
  const v = String(name || "").toLowerCase().trim();
  return (
    v.includes("fattoria madonna della querce") ||
    v.includes("fmdq") ||
    v.includes("in fattoria")
  );
}

function getChannelName(channel: RelationChannel) {
  if (!channel) return "—";
  if (Array.isArray(channel)) return channel[0]?.name || "—";
  return channel.name || "—";
}

function getExperienceName(experience: RelationExperience) {
  if (!experience) return "—";
  if (Array.isArray(experience)) return experience[0]?.name || "—";
  return experience.name || "—";
}

function countPeople(row: {
  adults: number | null;
  children: number | null;
  infants: number | null;
}) {
  return (
    Number(row.adults || 0) +
    Number(row.children || 0) +
    Number(row.infants || 0)
  );
}

function dateToInput(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(dateString: string, days: number) {
  const dt = new Date(`${dateString}T00:00:00`);
  dt.setDate(dt.getDate() + days);
  return dateToInput(dt);
}

function buildHref(
  current: {
    q: string;
    from: string;
    to: string;
    channel: string;
    past: string;
  },
  overrides: Partial<{
    q: string;
    from: string;
    to: string;
    channel: string;
    past: string;
  }>
) {
  const params = new URLSearchParams();
  const merged = { ...current, ...overrides };

  Object.entries(merged).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });

  const qs = params.toString();
  return qs ? `/cognanello?${qs}` : "/cognanello";
}

function maxDateString(a: string, b: string) {
  return a > b ? a : b;
}

export default async function CognanelloPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;

  const q = getParam(params.q).trim();
  const from = getParam(params.from).trim();
  const to = getParam(params.to).trim();
  const channel = getParam(params.channel).trim();
  const past = getParam(params.past).trim();

  const showPast = past === "1";

  const today = dateToInput(new Date());
  const tomorrow = addDays(today, 1);

  const now = new Date();
  const firstDayOfMonth = dateToInput(
    new Date(now.getFullYear(), now.getMonth(), 1)
  );
  const lastDayOfMonth = dateToInput(
    new Date(now.getFullYear(), now.getMonth() + 1, 0)
  );

  const currentFilters = {
    q,
    from,
    to,
    channel,
    past: showPast ? "1" : "",
  };

  const effectiveFrom = showPast
    ? from
      ? maxDateString(from, PAST_START_DATE)
      : PAST_START_DATE
    : from || today;

  const supabase = supabaseServer;

  const { data: channelsData, error: channelsError } = await supabase
    .from("channels")
    .select("id, name")
    .order("name", { ascending: true });

  if (channelsError) {
    throw new Error(channelsError.message);
  }

  const allChannels = (channelsData || []) as ChannelRow[];
  const excludedChannelIds = allChannels
    .filter((c) => isExcludedChannelName(c.name))
    .map((c) => c.id);

  const allowedChannels = allChannels.filter(
    (c) => !excludedChannelIds.includes(c.id)
  );

  let query = supabase
    .from("bookings")
    .select(
      `
      id,
      booking_reference,
      booking_date,
      booking_time,
      booking_created_at,
      customer_name,
      adults,
      children,
      infants,
      channel_id,
      experience_id,
      channel:channels (
        id,
        name
      ),
      experience:experiences (
        id,
        name
      )
    `
    )
    .in("experience_id", EXPERIENCE_IDS);

  if (excludedChannelIds.length > 0) {
    query = query.not("channel_id", "in", `(${excludedChannelIds.join(",")})`);
  }

  if (channel) {
    query = query.eq("channel_id", Number(channel));
  }

  query = query.gte("booking_date", effectiveFrom);

  if (to) {
    query = query.lte("booking_date", to);
  }

  if (q) {
    const safeQ = q.replaceAll(",", " ").replaceAll("%", " ");
    query = query.or(
      `customer_name.ilike.%${safeQ}%,booking_reference.ilike.%${safeQ}%`
    );
  }

  const { data, error } = await query
    .order("booking_date", { ascending: true })
    .order("booking_time", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  const rawBookings = (data || []) as BookingRow[];

  const bookings: BookingListItem[] = rawBookings.map((row) => ({
    id: row.id,
    booking_reference: row.booking_reference,
    booking_date: row.booking_date,
    booking_time: row.booking_time,
    booking_created_at: row.booking_created_at,
    customer_name: row.customer_name,
    adults: row.adults,
    children: row.children,
    infants: row.infants,
    channel_name: getChannelName(row.channel),
    experience_name: getExperienceName(row.experience),
  }));

  const totalBookings = bookings.length;
  const totalPeople = bookings.reduce((sum, row) => sum + countPeople(row), 0);

  return (
    <AppShell title="Cognanello Live">
      <AutoRefreshClient intervalMs={60000} />

      <div className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-zinc-900">
              Cognanello Live
            </h1>
            <p className="text-sm text-zinc-600">
              Vista smartphone semplificata, aggiornata automaticamente ogni 60
              secondi.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <span className="inline-flex items-center rounded-full bg-zinc-100 px-3 py-1 text-sm font-semibold text-zinc-700">
              Prenotazioni: {totalBookings}
            </span>
            <span className="inline-flex items-center rounded-full bg-zinc-100 px-3 py-1 text-sm font-semibold text-zinc-700">
              Persone: {totalPeople}
            </span>
          </div>
        </div>

        <SectionCard title="Filtri">
          <form className="grid grid-cols-1 gap-3 md:grid-cols-5" method="get">
            <div className="md:col-span-2">
              <label
                htmlFor="q"
                className="mb-1 block text-sm font-semibold text-zinc-700"
              >
                Cerca
              </label>
              <input
                id="q"
                name="q"
                defaultValue={q}
                placeholder="Cliente o riferimento"
                className="w-full rounded-2xl border border-zinc-300 bg-white px-4 py-3 text-base text-zinc-900 outline-none ring-0 transition focus:border-zinc-500"
              />
            </div>

            <div>
              <label
                htmlFor="channel"
                className="mb-1 block text-sm font-semibold text-zinc-700"
              >
                Canale
              </label>
              <select
                id="channel"
                name="channel"
                defaultValue={channel}
                className="w-full rounded-2xl border border-zinc-300 bg-white px-4 py-3 text-base text-zinc-900 outline-none ring-0 transition focus:border-zinc-500"
              >
                <option value="">Tutti i canali</option>
                {allowedChannels.map((item) => (
                  <option key={item.id} value={String(item.id)}>
                    {item.name || `Canale ${item.id}`}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="from"
                className="mb-1 block text-sm font-semibold text-zinc-700"
              >
                Da data
              </label>
              <input
                id="from"
                name="from"
                type="date"
                defaultValue={showPast && !from ? PAST_START_DATE : from}
                min={showPast ? PAST_START_DATE : undefined}
                className="w-full rounded-2xl border border-zinc-300 bg-white px-4 py-3 text-base text-zinc-900 outline-none ring-0 transition focus:border-zinc-500"
              />
            </div>

            <div>
              <label
                htmlFor="to"
                className="mb-1 block text-sm font-semibold text-zinc-700"
              >
                A data
              </label>
              <input
                id="to"
                name="to"
                type="date"
                defaultValue={to}
                className="w-full rounded-2xl border border-zinc-300 bg-white px-4 py-3 text-base text-zinc-900 outline-none ring-0 transition focus:border-zinc-500"
              />
            </div>

            <div className="md:col-span-5 flex flex-col gap-3 pt-1 sm:flex-row sm:items-center sm:justify-between">
              <label className="inline-flex items-center gap-2 text-sm font-medium text-zinc-700">
                <input
                  type="checkbox"
                  name="past"
                  value="1"
                  defaultChecked={showPast}
                  className="h-4 w-4 rounded border-zinc-300"
                />
                Mostra anche il passato dal 01/01/2026
              </label>

              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  className="inline-flex items-center justify-center rounded-2xl bg-zinc-900 px-4 py-3 text-sm font-bold text-white transition hover:bg-zinc-700"
                >
                  Aggiorna
                </button>

                <Link
                  href="/cognanello"
                  className="inline-flex items-center justify-center rounded-2xl border border-zinc-300 bg-white px-4 py-3 text-sm font-bold text-zinc-700 transition hover:bg-zinc-50"
                >
                  Reset
                </Link>
              </div>
            </div>
          </form>

          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href={buildHref(currentFilters, { from: today, to: today })}
              className="rounded-full border border-zinc-300 px-3 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
            >
              Oggi
            </Link>

            <Link
              href={buildHref(currentFilters, { from: tomorrow, to: tomorrow })}
              className="rounded-full border border-zinc-300 px-3 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
            >
              Domani
            </Link>

            <Link
              href={buildHref(currentFilters, {
                from: firstDayOfMonth,
                to: lastDayOfMonth,
              })}
              className="rounded-full border border-zinc-300 px-3 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
            >
              Questo mese
            </Link>

            <Link
              href={buildHref(currentFilters, {
                from: PAST_START_DATE,
                to: "2026-12-31",
                past: "1",
              })}
              className="rounded-full border border-zinc-300 px-3 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
            >
              Tutto 2026
            </Link>
          </div>
        </SectionCard>

        <CognanelloBookingList
          bookings={bookings}
          today={today}
          tomorrow={tomorrow}
        />
      </div>
    </AppShell>
  );
}