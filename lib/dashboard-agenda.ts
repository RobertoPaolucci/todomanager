type AgendaBooking = {
  id: number;
  booking_date: string | null;
  booking_time: string | null;
  experience_id?: number | null;
  experience_name?: string | null;
  is_cancelled?: boolean | null;
};

export function buildDashboardAgenda<T extends AgendaBooking>(bookings: T[], now: Date) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
  const [year, month, date] = today.split("-").map(Number);

  return ["OGGI", "DOMANI", "DOPODOMANI"].map((label, offset) => {
    // Calendar arithmetic avoids server timezone and daylight-saving offsets.
    const day = new Date(Date.UTC(year, month - 1, date + offset)).toISOString().slice(0, 10);
    const rows = bookings.filter(b => !b.is_cancelled && b.booking_date === day)
      .sort((a, b) => (a.booking_time || "99:99").localeCompare(b.booking_time || "99:99") || a.id - b.id);
    const groups = new Map<string, { key: string; name: string; bookings: T[] }>();
    for (const booking of rows) {
      const name = booking.experience_name || "Esperienza";
      const key = booking.experience_id != null ? `id:${booking.experience_id}` : `name:${name}`;
      const group = groups.get(key) || { key, name, bookings: [] };
      group.bookings.push(booking);
      groups.set(key, group);
    }
    return { date: day, label, experiences: [...groups.values()] };
  });
}
