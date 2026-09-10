// Presentation only: never write the filtered text back to bookings.notes.
export function getBookingDisplayNotes(notes: string | null | undefined) {
  if (!notes) return "";
  return notes.split(/\r?\n/)
    .filter(line => !/^\s*(?:🔴\s*)?Prenotazione cancellata\s*$/i.test(line))
    .join("\n");
}
