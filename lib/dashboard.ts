import { supabase } from "@/lib/supabase";

export async function getDashboardStats() {
  const { data: bookings, error } = await supabase
    .from("bookings")
    .select(`
      id,
      booking_source,
      total_customer,
      total_to_you,
      total_supplier_cost,
      margin_total
    `);

  if (error) {
    throw new Error(`Errore caricamento dashboard: ${error.message}`);
  }

  const totals = bookings.reduce(
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

  const bookingsByChannelMap = bookings.reduce<Record<string, number>>(
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
  };
}