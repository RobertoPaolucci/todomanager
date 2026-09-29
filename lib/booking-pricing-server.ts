import { supabaseServer } from "@/lib/supabase-server";

/** Structural identity: FMDQ business unit + its configured internal supplier. */
export async function getFmdqInternalSupplierKeys() {
  const [units, rules] = await Promise.all([
    supabaseServer.from("business_units").select("id, code").eq("code", "fmdq"),
    supabaseServer.from("business_unit_internal_suppliers").select("business_unit_id, supplier_id"),
  ]);
  if (units.error || rules.error) throw new Error("Impossibile verificare il contesto FMDQ.");
  const ids = new Set((units.data || []).map(unit => Number(unit.id)));
  return new Set((rules.data || []).filter(rule => ids.has(Number(rule.business_unit_id)))
    .map(rule => `${rule.business_unit_id}:${rule.supplier_id}`));
}
