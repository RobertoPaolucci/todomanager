import { supabaseServer } from "@/lib/supabase-server";
import type { QueryData } from "@supabase/supabase-js";

export async function getDashboardStats() {
  const query = supabaseServer
    .from("bookings")
    .select(`
      id,
      booking_date,
      booking_source,
      total_customer,
      total_to_you,
      total_supplier_cost,
      margin_total
    `)
    .order("id", { ascending: true });

  const pageSize = 1000;
  const safeBookings: QueryData<typeof query> = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await query.range(from, from + pageSize - 1);

    if (error) {
      throw new Error(`Errore caricamento dashboard: ${error.message}`);
    }

    const page = data || [];
    safeBookings.push(...page);
    if (page.length < pageSize) break;
  }

  const channelStartDate = safeBookings.reduce<string | null>(
    (earliest, booking) =>
      booking.booking_date && (!earliest || booking.booking_date < earliest)
        ? booking.booking_date
        : earliest,
    null
  );

  const totals = safeBookings.reduce(
    (acc, booking) => {
      acc.totalCustomer += Number(booking.total_customer || 0);
      acc.totalToYou += Number(booking.total_to_you || 0);
      acc.totalSupplier += Number(booking.total_supplier_cost || 0);
      acc.totalMargin += Number(booking.margin_total || 0);
      return acc;
    },
    {
      totalCustomer: 0,
      totalToYou: 0,
      totalSupplier: 0,
      totalMargin: 0,
    }
  );

  const bookingsByChannelMap = safeBookings.reduce<Record<string, number>>(
    (acc, booking) => {
      const channel = booking.booking_source || "Unknown";
      acc[channel] = (acc[channel] || 0) + 1;
      return acc;
    },
    {}
  );

  const bookingsByChannel = Object.entries(bookingsByChannelMap)
    .map(([channel, count]) => ({
      channel,
      count,
    }))
    .sort((a, b) => b.count - a.count);

  return {
    totals,
    bookingsByChannel,
    channelStartDate,
  };
}
