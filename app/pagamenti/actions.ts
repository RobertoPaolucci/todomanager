"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase-server";

function formatEuro(value: number) {
  return new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR",
  }).format(value);
}

function getCurrentPaidAmount(booking: any, isInternalBooking: boolean) {
  const costo = Number(booking.total_supplier_cost || 0);

  if (booking.is_cancelled) return 0;
  if (isInternalBooking) return costo;
  if (booking.supplier_payment_status === "paid") return costo;

  const rawPaid = Number(booking.supplier_amount_paid || 0);
  return Math.max(0, Math.min(rawPaid, costo));
}

export async function addSupplierPayment(formData: FormData) {
  const supplier_id = Number(formData.get("supplier_id"));
  const amount = Number(formData.get("amount"));
  const payment_date = String(formData.get("payment_date") || "").trim();
  const payment_method = String(formData.get("payment_method") || "").trim();
  const notes = String(formData.get("notes") || "").trim();

  const requestedBusinessUnitIdRaw = String(
    formData.get("business_unit_id") || ""
  ).trim();
  const requestedBusinessUnitId = requestedBusinessUnitIdRaw
    ? Number(requestedBusinessUnitIdRaw)
    : null;

  if (!supplier_id || !amount || !payment_date || !payment_method) {
    throw new Error("Compila tutti i campi obbligatori del pagamento");
  }

  if (amount <= 0) {
    throw new Error("L'importo del pagamento deve essere maggiore di zero");
  }

  if (requestedBusinessUnitIdRaw && !requestedBusinessUnitId) {
    throw new Error("Business unit non valida");
  }

  const [bookingsRes, internalRulesRes, businessUnitsRes] = await Promise.all([
    supabaseServer
      .from("bookings")
      .select(
        "id, supplier_id, business_unit_id, booking_date, total_supplier_cost, supplier_amount_paid, supplier_payment_status, is_cancelled"
      )
      .eq("supplier_id", supplier_id)
      .order("booking_date", { ascending: true })
      .order("id", { ascending: true }),
    supabaseServer
      .from("business_unit_internal_suppliers")
      .select("business_unit_id, supplier_id"),
    supabaseServer.from("business_units").select("id, code, name"),
  ]);

  if (bookingsRes.error) {
    throw new Error(
      `Errore lettura prenotazioni fornitore: ${bookingsRes.error.message}`
    );
  }

  if (internalRulesRes.error) {
    throw new Error(
      `Errore lettura regole fornitori interni: ${internalRulesRes.error.message}`
    );
  }

  if (businessUnitsRes.error) {
    throw new Error(
      `Errore lettura business units: ${businessUnitsRes.error.message}`
    );
  }

  const bookings = bookingsRes.data || [];
  const internalRules = internalRulesRes.data || [];
  const businessUnits = businessUnitsRes.data || [];

  const internalRuleSet = new Set(
    internalRules.map((rule) => `${rule.business_unit_id}:${rule.supplier_id}`)
  );

  const businessUnitMap = new Map(
    businessUnits.map((bu) => [Number(bu.id), bu])
  );

  const decoratedBookings = bookings.map((booking) => {
    const isInternalBooking = internalRuleSet.has(
      `${booking.business_unit_id}:${booking.supplier_id}`
    );
    const costo = Number(booking.total_supplier_cost || 0);
    const currentPaid = getCurrentPaidAmount(booking, isInternalBooking);
    const residuo = Math.max(0, costo - currentPaid);

    return {
      ...booking,
      _is_internal_booking: isInternalBooking,
      _costo: costo,
      _current_paid: currentPaid,
      _residuo: residuo,
    };
  });

  const payableBookings = decoratedBookings.filter(
    (booking) =>
      !booking.is_cancelled &&
      !booking._is_internal_booking &&
      booking._residuo > 0
  );

  if (payableBookings.length === 0) {
    throw new Error(
      "Non ci sono saldi aperti da registrare per questo fornitore."
    );
  }

  const payableBusinessUnitIds = Array.from(
    new Set(
      payableBookings
        .map((booking) => Number(booking.business_unit_id))
        .filter((value) => Number.isFinite(value) && value > 0)
    )
  );

  let targetBusinessUnitId: number;

  if (requestedBusinessUnitId) {
    if (!payableBusinessUnitIds.includes(requestedBusinessUnitId)) {
      throw new Error(
        "La business unit selezionata non ha saldi aperti per questo fornitore."
      );
    }
    targetBusinessUnitId = requestedBusinessUnitId;
  } else if (payableBusinessUnitIds.length === 1) {
    targetBusinessUnitId = payableBusinessUnitIds[0];
  } else {
    const labels = payableBusinessUnitIds
      .map((id) => {
        const bu = businessUnitMap.get(id);
        return bu?.code || `ID ${id}`;
      })
      .join(", ");

    throw new Error(
      `Questo fornitore ha saldi aperti su più contabilità (${labels}). Devi prima separare il pagamento per business unit.`
    );
  }

  const targetBookings = payableBookings.filter(
    (booking) => Number(booking.business_unit_id) === targetBusinessUnitId
  );

  if (targetBookings.length === 0) {
    throw new Error(
      "Non ci sono prenotazioni aperte da saldare nella business unit selezionata."
    );
  }

  const totalOutstandingForTargetBu = targetBookings.reduce(
    (sum, booking) => sum + Number(booking._residuo || 0),
    0
  );

  if (totalOutstandingForTargetBu <= 0) {
    throw new Error(
      "Non ci sono importi residui da saldare nella business unit selezionata."
    );
  }

  if (amount > totalOutstandingForTargetBu + 0.009) {
    const bu = businessUnitMap.get(targetBusinessUnitId);
    const buLabel = bu?.code || `ID ${targetBusinessUnitId}`;

    throw new Error(
      `Importo troppo alto per ${buLabel}. Massimo registrabile: ${formatEuro(
        totalOutstandingForTargetBu
      )}.`
    );
  }

  const { error: insertPaymentError } = await supabaseServer
    .from("supplier_payments")
    .insert({
      supplier_id,
      business_unit_id: targetBusinessUnitId,
      amount,
      payment_date,
      payment_method,
      notes: notes || null,
    });

  if (insertPaymentError) {
    throw new Error(
      `Errore registrazione pagamento: ${insertPaymentError.message}`
    );
  }

  let remainingAmount = amount;

  for (const booking of targetBookings) {
    if (remainingAmount <= 0) break;

    const remainingForBooking = Number(booking._residuo || 0);
    if (remainingForBooking <= 0) continue;

    const amountForBooking = Math.min(remainingAmount, remainingForBooking);
    const newPaidAmount = Number(booking._current_paid || 0) + amountForBooking;
    const costo = Number(booking._costo || 0);

    let newStatus: string | null = null;
    if (newPaidAmount >= costo - 0.00001) {
      newStatus = "paid";
    } else if (newPaidAmount > 0) {
      newStatus = "partial";
    }

    const { error: updateError } = await supabaseServer
      .from("bookings")
      .update({
        supplier_amount_paid: newPaidAmount,
        supplier_payment_status: newStatus,
      })
      .eq("id", booking.id);

    if (updateError) {
      throw new Error(
        `Errore aggiornamento prenotazione ${booking.id}: ${updateError.message}`
      );
    }

    remainingAmount -= amountForBooking;
  }

  revalidatePath(`/pagamenti/${supplier_id}`);
  revalidatePath("/pagamenti");
  revalidatePath("/prenotazioni");

  redirect(`/pagamenti/${supplier_id}`);
}

export async function bulkMarkSupplierPaymentsPaid(formData: FormData) {
  const supplierId = Number(formData.get("supplier_id"));
  const paymentDate = String(formData.get("payment_date") || "").trim();
  const paymentMethod = String(formData.get("payment_method") || "").trim();
  const notes = String(formData.get("notes") || "").trim();
  let requestedIds: number[] = [];

  try {
    const raw = JSON.parse(String(formData.get("booking_ids") || "[]"));
    requestedIds = Array.isArray(raw)
      ? Array.from(new Set(raw.map(Number).filter((id) => Number.isInteger(id) && id > 0)))
      : [];
  } catch {
    return { paid: [], failures: [{ id: 0, reason: "Selezione non valida." }] };
  }

  if (!supplierId || !paymentDate || !paymentMethod || requestedIds.length === 0) {
    return { paid: [], failures: [{ id: 0, reason: "Seleziona almeno un movimento e completa i dati." }] };
  }

  const [bookingsRes, internalRulesRes] = await Promise.all([
    supabaseServer
      .from("bookings")
      .select("id, supplier_id, business_unit_id, booking_date, total_supplier_cost, supplier_amount_paid, supplier_payment_status, is_cancelled")
      .eq("supplier_id", supplierId)
      .in("id", requestedIds),
    supabaseServer.from("business_unit_internal_suppliers").select("business_unit_id, supplier_id"),
  ]);

  if (bookingsRes.error) {
    return { paid: [], failures: [{ id: 0, reason: `Errore lettura movimenti: ${bookingsRes.error.message}` }] };
  }
  if (internalRulesRes.error) {
    return { paid: [], failures: [{ id: 0, reason: `Errore lettura regole contabili: ${internalRulesRes.error.message}` }] };
  }

  const today = new Date().toISOString().slice(0, 10);
  const internalRules = new Set(
    (internalRulesRes.data || []).map((rule) => `${rule.business_unit_id}:${rule.supplier_id}`)
  );
  const paid: number[] = [];
  const failures: { id: number; reason: string }[] = [];

  for (const booking of bookingsRes.data || []) {
    const id = Number(booking.id);
    const internal = internalRules.has(`${booking.business_unit_id}:${booking.supplier_id}`);
    const cost = Number(booking.total_supplier_cost || 0);
    const currentPaid = getCurrentPaidAmount(booking, internal);
    const residual = Math.max(0, cost - currentPaid);

    if (booking.is_cancelled) { failures.push({ id, reason: "Prenotazione annullata." }); continue; }
    if (internal || !booking.business_unit_id) { failures.push({ id, reason: "Movimento non saldabile." }); continue; }
    if (!booking.booking_date || booking.booking_date > today) { failures.push({ id, reason: "Prenotazione futura." }); continue; }
    if (booking.supplier_payment_status === "paid" || residual <= 0) { failures.push({ id, reason: "Pagamento già registrato." }); continue; }

    const { data: updated, error: updateError } = await supabaseServer
      .from("bookings")
      .update({ supplier_amount_paid: cost, supplier_payment_status: "paid" })
      .eq("id", id)
      .eq("supplier_id", supplierId)
      .eq("supplier_amount_paid", Number(booking.supplier_amount_paid || 0))
      .neq("supplier_payment_status", "paid")
      .select("id")
      .maybeSingle();

    if (updateError || !updated) {
      failures.push({ id, reason: updateError ? `Errore aggiornamento: ${updateError.message}` : "Movimento modificato durante il salvataggio." });
      continue;
    }

    const { error: insertError } = await supabaseServer.from("supplier_payments").insert({
      supplier_id: supplierId,
      business_unit_id: booking.business_unit_id,
      amount: residual,
      payment_date: paymentDate,
      payment_method: paymentMethod,
      notes: notes || `Pagamento massivo prenotazione #${id}`,
    });
    if (insertError) {
      await supabaseServer.from("bookings").update({
        supplier_amount_paid: booking.supplier_amount_paid || 0,
        supplier_payment_status: booking.supplier_payment_status || "pending",
      }).eq("id", id).eq("supplier_payment_status", "paid");
      failures.push({ id, reason: `Errore registrazione: ${insertError.message}` });
      continue;
    }
    paid.push(id);
  }

  const foundIds = new Set((bookingsRes.data || []).map((booking) => Number(booking.id)));
  requestedIds.filter((id) => !foundIds.has(id)).forEach((id) => failures.push({ id, reason: "Movimento non trovato o non appartenente al fornitore." }));

  revalidatePath(`/pagamenti/${supplierId}`);
  revalidatePath("/pagamenti");
  revalidatePath("/prenotazioni");
  return { paid, failures };
}
