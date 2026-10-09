export const PAYMENT_METHOD_OPTIONS = [
  "Bonifico Bancario", "Carta di Credito", "Contanti", "POS", "PayPal",
  "Stripe", "Satispay", "Assegno", "Compensazione", "Altro",
];

export type PaymentBooking = {
  id: number;
  supplier_id: number | null;
  business_unit_id: number | null;
  channel_id: number | null;
  customer_name: string | null;
  booking_reference: string | null;
  booking_date: string | null;
  total_supplier_cost: number | null;
  supplier_amount_paid: number | null;
  supplier_payment_status: string | null;
  is_cancelled: boolean | null;
};

export function getCurrentPaidAmount(booking: Pick<PaymentBooking,
  "total_supplier_cost" | "supplier_amount_paid" | "supplier_payment_status" | "is_cancelled"
>, isInternalBooking: boolean) {
  const costo = Number(booking.total_supplier_cost || 0);
  if (booking.is_cancelled) return 0;
  if (isInternalBooking || booking.supplier_payment_status === "paid") return costo;
  return Math.max(0, Math.min(Number(booking.supplier_amount_paid || 0), costo));
}

export function getSelectableAmount(booking: PaymentBooking, internal: boolean, today: string) {
  if (booking.is_cancelled || internal || !booking.booking_date || booking.booking_date > today ||
    !booking.business_unit_id || booking.supplier_payment_status === "paid") return 0;
  const residual = Number(booking.total_supplier_cost || 0) - getCurrentPaidAmount(booking, internal);
  return Number.isFinite(residual) ? Math.max(0, Math.round(residual * 100)) : 0;
}

export type PaymentSelectionScope = {
  supplierId: number;
  month: string;
  customer: string;
  channel: string;
};

export type SelectedMovement = { id: number; cents: number; label: string };
export type BulkPaymentResult = {
  paid: number[];
  failures: { id: number; reason: string }[];
  error?: string;
};
