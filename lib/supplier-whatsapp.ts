type Supplier = { name?: string | null };

type Booking = {
  experience_name?: string | null;
  suppliers?: Supplier | Supplier[] | null;
};

export function getCognanelloExperienceLine(booking: Booking): string {
  const supplier = Array.isArray(booking.suppliers)
    ? booking.suppliers[0]
    : booking.suppliers;
  const experienceName = booking.experience_name?.trim();

  if (!/\bcognanello\b/i.test(supplier?.name || "") || !experienceName) {
    return "";
  }

  return `${experienceName}\n`;
}
