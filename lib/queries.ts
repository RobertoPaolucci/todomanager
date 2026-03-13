import { supabase } from "@/lib/supabase";

export async function getChannels() {
  const { data, error } = await supabase
    .from("channels")
    .select("id, name, type")
    .order("name", { ascending: true });

  if (error) {
    throw new Error(`Errore caricamento canali: ${error.message}`);
  }

  return data;
}

export async function getExperiences() {
  const { data, error } = await supabase
    .from("experiences")
    .select(`
      id,
      name,
      supplier_id,
      supplier_unit_cost,
      base_price,
      notes,
      active,
      suppliers (
        id,
        name
      ),
      experience_channel_prices (
        id,
        channel_id,
        your_unit_price,
        public_unit_price,
        currency
      )
    `)
    .order("name", { ascending: true });

  if (error) {
    throw new Error(`Errore caricamento esperienze: ${error.message}`);
  }

  return data;
}

export async function getSuppliers() {
  const { data, error } = await supabase
    .from("suppliers")
    .select("id, name, active")
    .eq("active", true)
    .order("name", { ascending: true });

  if (error) {
    throw new Error(`Errore caricamento fornitori: ${error.message}`);
  }

  return data;
}

export async function getAllSuppliers() {
  const { data, error } = await supabase
    .from("suppliers")
    .select(`
      id,
      name,
      contact_person,
      email,
      phone,
      website,
      notes,
      active
    `)
    .order("name", { ascending: true });

  if (error) {
    throw new Error(`Errore caricamento fornitori: ${error.message}`);
  }

  return data;
}

export async function getSupplierById(id: number) {
  const { data, error } = await supabase
    .from("suppliers")
    .select(`
      id,
      name,
      contact_person,
      email,
      phone,
      website,
      notes,
      active
    `)
    .eq("id", id)
    .single();

  if (error) {
    throw new Error(`Errore caricamento fornitore: ${error.message}`);
  }

  return data;
}

export async function getExperienceById(id: number) {
  const { data, error } = await supabase
    .from("experiences")
    .select(`
      id,
      name,
      supplier_id,
      supplier_unit_cost,
      base_price,
      notes,
      active
    `)
    .eq("id", id)
    .single();

  if (error) {
    throw new Error(`Errore caricamento esperienza: ${error.message}`);
  }

  return data;
}