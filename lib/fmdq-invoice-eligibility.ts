import { isTuscanEscapeBlockRow, TUSCAN_ESCAPE_STAGING_DEFAULTS } from "@/lib/google-calendar-tuscan-escape";

type InvoiceBooking = {
  channel_id?: number | string | null;
  experience_id?: number | string | null;
  original_title?: string | null;
  notes?: string | null;
};

/** Experience 22 alone is insufficient: historical real lunches also use it.
 * Require the existing explicit block classification, never customer/name guesses.
 */
export function isTuscanEscapeInvoiceBlock(booking: InvoiceBooking) {
  return Number(booking.channel_id) === TUSCAN_ESCAPE_STAGING_DEFAULTS.channel_id
    && Number(booking.experience_id) === TUSCAN_ESCAPE_STAGING_DEFAULTS.experience_id
    && isTuscanEscapeBlockRow(booking);
}
