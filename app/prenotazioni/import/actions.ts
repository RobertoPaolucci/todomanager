"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";

// Funzione per gestire le date di Excel che possono arrivare come numeri o stringhe
function formatExcelDate(excelDate: any) {
  if (!excelDate) return { date: null, time: null };
  
  let dateObj: Date;

  if (typeof excelDate === 'number') {
    // Gestione serial number di Excel (es. 45432.5)
    dateObj = new Date(Math.round((excelDate - 25569) * 86400 * 1000));
  } else {
    // Gestione stringa (es. "2024-12-28 12:00:00")
    dateObj = new Date(excelDate);
  }

  if (isNaN(dateObj.getTime())) return { date: null, time: null };

  const yyyy = dateObj.getFullYear();
  const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
  const dd = String(dateObj.getDate()).padStart(2, '0');
  const hh = String(dateObj.getHours()).padStart(2, '0');
  const min = String(dateObj.getMinutes()).padStart(2, '0');

  return {
    date: `${yyyy}-${mm}-${dd}`,
    time: `${hh}:${min}`
  };
}

function parseParticipants(str: string) {
  if (!str) return { adults: 0, children: 0, infants: 0 };
  const adults = parseInt(str.match(/Adult: (\d+)/)?.[1] || "0");
  const children = parseInt(str.match(/(?:Child|Youth|Bambini): (\d+)/)?.[1] || "0");
  const infants = parseInt(str.match(/(?:Infant|Infanti): (\d+)/)?.[1] || "0");
  return { adults, children, infants };
}

export async function importBokunBookings(rows: any[], mappings: Record<string, number>) {
  const { data: channels } = await supabase.from("channels").select("id, name");
  const { data: experiences } = await supabase.from("experiences").select("id, name, supplier_id, supplier_unit_cost");

  const results = { imported: 0, skipped: 0, errors: [] as string[] };

  for (const row of rows) {
    const ref = row["Product confirmation code"] || row["Confirmation code"];
    
    try {
      if (!ref) {
        results.skipped++;
        continue;
      }

      const bokunTitle = row["Product title"];
      const experienceId = mappings[bokunTitle];

      // Se l'esperienza è ignorata o non mappata
      if (!experienceId) {
        results.skipped++;
        continue;
      }

      const exp = experiences?.find(e => e.id === experienceId);
      const { adults, children, infants } = parseParticipants(String(row["Participants"] || ""));
      const total_people = adults + children + infants;
      const pricing_pax = adults + children;

      // Gestione Date Robusta
      const { date, time } = formatExcelDate(row["Start date"]);
      const { date: creationDate } = formatExcelDate(row["Creation date"]);

      if (!date) throw new Error("Data di inizio non valida o mancante");

      // Mappatura Canale
      const rawChannel = String(row["Booking channel"] || "Diretto");
      const channel = channels?.find(c => 
        rawChannel.toLowerCase().includes(c.name.toLowerCase()) || 
        c.name.toLowerCase().includes(rawChannel.toLowerCase())
      );

      // Prezzi di listino
      const { data: priceRow } = await supabase
        .from("experience_channel_prices")
        .select("*")
        .eq("experience_id", experienceId)
        .eq("channel_id", channel?.id || 0)
        .maybeSingle();

      const unitPrice = priceRow?.your_unit_price || 0;
      const publicPrice = priceRow?.public_unit_price || 0;
      const unitCost = exp?.supplier_unit_cost || 0;

      const { error } = await supabase.from("bookings").insert({
        booking_reference: String(ref),
        customer_name: String(row["Customer"] || "Cliente Importato"),
        customer_email: row["Email"] || null,
        customer_phone: row["Phone number"] || null,
        booking_created_at: creationDate || date,
        booking_date: date,
        booking_time: time,
        experience_id: experienceId,
        experience_name: exp?.name,
        channel_id: channel?.id || null,
        booking_source: channel?.name || rawChannel,
        supplier_id: exp?.supplier_id,
        adults,
        children,
        infants,
        total_people,
        pax: total_people,
        your_unit_price: unitPrice,
        public_unit_price: publicPrice,
        supplier_unit_cost: unitCost,
        total_to_you: unitPrice * pricing_pax,
        total_customer: publicPrice * pricing_pax,
        total_supplier_cost: unitCost * pricing_pax,
        margin_total: (unitPrice * pricing_pax) - (unitCost * pricing_pax),
        customer_payment_status: row["Payment status"] === "PAID_IN_FULL" ? "paid" : "pending",
        is_cancelled: String(row["Status"]).toUpperCase() === "CANCELLED"
      });

      if (error) {
        if (error.code === "23505") results.skipped++; 
        else throw new Error(error.message);
      } else {
        results.imported++;
      }
    } catch (e: any) {
      results.errors.push(`Rif ${ref || 'Sconosciuto'}: ${e.message}`);
    }
  }

  revalidatePath("/prenotazioni");
  revalidatePath("/");
  return results;
}