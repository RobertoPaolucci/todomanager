/** Per-booking agreements. Automatic pricing remains owned by each existing flow. */
export function parseAgreedUnitPrice(value: unknown): number | null {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  if (typeof value !== "number" && typeof value !== "string") throw new Error("Prezzo concordato non valido.");
  const raw = String(value).trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) {
    throw new Error("Il prezzo concordato deve essere positivo o zero, con massimo due decimali.");
  }
  const price = Number(raw);
  if (!Number.isFinite(price) || price > 9999999999.99) {
    throw new Error("Prezzo concordato fuori intervallo.");
  }
  return price;
}

export function roundBookingMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function agreedTotal(adults: number, children: number, price: number) {
  return roundBookingMoney((adults + children) * price);
}

export function assertPersonAgreement(price: number | null, isGroupPricing: boolean) {
  if (price !== null && isGroupPricing) {
    throw new Error("Il prezzo concordato per pagante non è disponibile per esperienze a gruppi o quad.");
  }
}

export function isDirectFmdqAgreementContext(
  isFmdqInternalSupplier: boolean,
  monthlyInvoice: boolean | null | undefined,
) {
  return isFmdqInternalSupplier && monthlyInvoice === true;
}

// Validate against standard rates, never against a previously overridden snapshot.
export function assertFmdqAgreementRates(rates: {
  yourAdult: number; yourChild: number; supplierAdult: number; supplierChild: number;
  invoiceAdult: number; invoiceChild: number;
}) {
  if (rates.yourAdult !== rates.supplierAdult || rates.yourChild !== rates.supplierChild ||
      rates.yourAdult !== rates.invoiceAdult || rates.yourChild !== rates.invoiceChild) {
    throw new Error("Accordo FMDQ non applicabile: ricavo e costo di listino sono differenti. Verificare la tariffa prima di procedere.");
  }
}

export type BookingEconomics = {
  your_unit_price: number;
  supplier_unit_cost: number;
  total_to_you: number;
  total_supplier_cost: number;
  margin_total: number;
};

export function applyBookingAgreement<T extends BookingEconomics>(
  automatic: T,
  agreement: { price: number | null; adults: number; children: number; isGroupPricing: boolean; directFmdq: boolean },
): T {
  assertPersonAgreement(agreement.price, agreement.isGroupPricing);
  if (agreement.price === null) return automatic;
  const total = agreedTotal(agreement.adults, agreement.children, agreement.price);
  const cost = agreement.directFmdq ? total : automatic.total_supplier_cost;
  return {
    ...automatic,
    your_unit_price: agreement.price,
    supplier_unit_cost: agreement.directFmdq ? agreement.price : automatic.supplier_unit_cost,
    total_to_you: total,
    total_supplier_cost: cost,
    margin_total: roundBookingMoney(total - cost),
  };
}

export type TuscanEscapeGuideEvidence = {
  effective_total_guests: number;
  excluded_staff: number;
  attendance_quality: string;
};

/** Agreements retain precedence; Tuscan rates require independently resolved evidence. */
export function effectiveFmdqInvoiceRates(params: {
  price: number | null; directFmdq: boolean; isGroupPricing: boolean;
  adult: number; child: number;
  channelId?: number; payingClients?: number;
  guideEvidence?: TuscanEscapeGuideEvidence;
}) {
  assertPersonAgreement(params.price, params.isGroupPricing);
  if (params.price !== null && params.directFmdq) return { adult: params.price, child: params.price };
  if (params.channelId === 7 && params.directFmdq && !params.isGroupPricing) {
    const evidence = params.guideEvidence;
    const discounted = params.payingClients === 8
      && evidence?.effective_total_guests === 8
      && evidence.excluded_staff === 1 && evidence.attendance_quality === "parsed";
    const rate = discounted ? 36 : 38;
    return { adult: rate, child: rate };
  }
  return { adult: params.adult, child: params.child };
}

/** Only correct rows whose stored capacity proves that non-payers are separate. */
export function reportPayingAdults(booking: {
  adults: number | null; children: number | null; infants: number | null;
  non_paying_adults: number | null; total_people: number | null;
}) {
  const adults = Number(booking.adults || 0);
  const nonPaying = Number(booking.non_paying_adults || 0);
  if (!nonPaying || Number(booking.total_people) === adults + Number(booking.children || 0) + Number(booking.infants || 0) + nonPaying) {
    return adults;
  }
  // Preserve the historical convention for rows without evidence of separation.
  return Math.max(adults - nonPaying, 0);
}
