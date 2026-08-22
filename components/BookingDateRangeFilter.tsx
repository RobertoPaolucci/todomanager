"use client";

import { useState } from "react";

type BookingDateRangeFilterProps = {
  fromDate: string;
  toDate: string;
  q: string;
  sort: string;
  dir: string;
  showPast: boolean;
  businessUnitFilter: string;
  venueFilter: string;
};

export default function BookingDateRangeFilter({
  fromDate,
  toDate,
  q,
  sort,
  dir,
  showPast,
  businessUnitFilter,
  venueFilter,
}: BookingDateRangeFilterProps) {
  const [from, setFrom] = useState(fromDate);
  const [to, setTo] = useState(toDate);

  return (
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
          value={from}
          max={to || undefined}
          onChange={(event) => setFrom(event.target.value)}
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
          value={to}
          min={from || undefined}
          onChange={(event) => setTo(event.target.value)}
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
  );
}
