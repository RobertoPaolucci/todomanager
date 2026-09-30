export const TUSCAN_ESCAPE_NAME = "Tuscan Escape";
export const TUSCAN_ESCAPE_EXPERIENCE = "Tuscan Escape - Blocco data";
export const TUSCAN_ESCAPE_SUPPLIER_ID = 3;
export const TUSCAN_ESCAPE_BUSINESS_UNIT_ID = 1;
export const TUSCAN_ESCAPE_STAGING_DEFAULTS = {
  experience_id: 22,
  channel_id: 7,
  booking_source: TUSCAN_ESCAPE_NAME,
  customer_name: TUSCAN_ESCAPE_NAME,
  adults: 1,
  children: 0,
  infants: 0,
} as const;

type TuscanEscapeSource = {
  original_title?: string | null;
  notes?: string | null;
  customer_name?: string | null;
  booking_source?: string | null;
};

export function isTuscanEscapeBlockRow(row: TuscanEscapeSource) {
  // Il titolo originale prevale sulle note; canale e cliente non identificano un blocco.
  const title = String(row.original_title ?? "").trim();
  const source = (title || String(row.notes ?? "")).replace(/\s+/g, " ").trim();
  return /^tuscan\s+escape(?:\s+t|\s*-\s*blocco\s+data)?$/i.test(source);
}

export function canRetryTuscanEscapeImport(
  row: TuscanEscapeSource & {
    import_status: string;
    imported_booking_id: number | null;
  }
) {
  return isTuscanEscapeBlockRow(row) &&
    row.import_status === "needs_review" && !row.imported_booking_id;
}
