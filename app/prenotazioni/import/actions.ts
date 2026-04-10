"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase-server";

function formatExcelDate(excelDate: any) {
  if (!excelDate) return { date: null, time: null };

  let dateObj: Date;

  if (typeof excelDate === "number") {
    dateObj = new Date(Math.round((excelDate - 25569) * 86400 * 1000));
  } else {
    const cleanStr = String(excelDate).replace(" ", "T");
    dateObj = new Date(cleanStr);
  }

  if (isNaN(dateObj.getTime())) return { date: null, time: null };

  const yyyy = dateObj.getFullYear();
  const mm = String(dateObj.getMonth() + 1).padStart(2, "0");
  const dd = String(dateObj.getDate()).padStart(2, "0");
  const hh = String(dateObj.getHours()).padStart(2, "0");
  const min = String(dateObj.getMinutes()).padStart(2, "0");

  return { date: `${yyyy}-${mm}-${dd}`, time: `${hh}:${min}` };
}

function parseParticipants(str: string) {
  if (!str) return { adults: 0, children: 0, infants: 0 };

  const getNum = (regex: RegExp) => parseInt(str.match(regex)?.[1] || "0", 10);

  const a = getNum(/Adult(?:s)?: (\d+)/i);
  const s = getNum(/Senior(?:s)?: (\d+)/i);
  const y = getNum(/Youth(?:s)?: (\d+)/i);
  const c = getNum(/(?:Child|Children|Bambini|Bambino): (\d+)/i);
  const i = getNum(/(?:Infant|Infants|Infanti): (\d+)/i);

  return {
    adults: a + s + y,
    children: c,
    infants: i,
  };
}

export async function getCloudData() {
  const [mappingsRes, logsRes, expRes] = await Promise.all([
    supabaseServer.from("import_mappings").select("*"),
    supabaseServer
      .from("import_logs")
      .select("*")
      .order("created_at", { ascending: false }),
    supabaseServer.from("experiences").select("id, name").order("name"),
  ]);

  const mappings: Record<string, number> = {};

  if (mappingsRes.data) {
    mappingsRes.data.forEach((row) => {
      mappings[row.bokun_title] = row.experience_id;
    });
  }

  return {
    mappings,
    logs: logsRes.data || [],
    experiences: expRes.data || [],
  };
}

export async function saveMappingToCloud(title: string, experienceId: number | null) {
  if (experienceId) {
    await supabaseServer
      .from("import_mappings")
      .upsert({ bokun_title: title, experience_id: experienceId });
  } else {
    await supabaseServer
      .from("import_mappings")
      .delete()
      .eq("bokun_title", title);
  }
}

export async function clearLogsFromCloud() {
  await supabaseServer.from("import_logs").delete().neq("id", 0);
}

export async function importBokunBookings(
  rows: any[],
  mappings: Record<string, number>
) {
  const { data: channels } = await supabaseServer.from("channels").select("id, name");
  const { data: experiences } = await supabaseServer
    .from("experiences")
    .select("id, name, supplier_id, supplier_unit_cost");

  const results = { imported: 0, skipped: 0, errors: [] as string[] };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const row of rows) {
    try {
      const isGYG =
        row.hasOwnProperty("Booking Ref #") && row.hasOwnProperty("Product");

      let ref = "";
      let rawTitle = "";
      let excelStartDate: any = null;
      let excelCreationDate: any = null;
      let customerName = "";
      let email: string | null = null;
      let phone: string | null = null;
      let rawChannel = "Diretto";
      let isPaid = false;
      let isCancelled = false;
      let adults = 0;
      let children = 0;
      let infants = 0;
      let isDirectOrEbike = false;
      let fileTotalCustomer = 0;
      let fileTotalNet = 0;

      if (isGYG) {
        ref = String(row["Booking Ref #"] || "");
        rawTitle = String(row["Product"] || "");
        excelStartDate = row["Date"];
        excelCreationDate = row["Purchase Date (local time)"];
        customerName = `${row["Traveler's First Name"] || ""} ${
          row["Traveler's Last Name"] || ""
        }`.trim();
        email = row["Email"] || null;
        phone = row["Phone"] || null;
        rawChannel = "GetYourGuide";
        adults =
          Number(row["Adult"] || 0) +
          Number(row["Senior"] || 0) +
          Number(row["Youth"] || 0) +
          Number(row["EU Citizens (with ID)"] || 0);
        children =
          Number(row["Child"] || 0) + Number(row["Student (with ID)"] || 0);
        infants = Number(row["Infant"] || 0);
        isPaid = row["Reserve Now Pay Later Booking"] !== "Yes";
        fileTotalCustomer =
          parseFloat(String(row["Price"] || "0").replace(/[^\d.]/g, "")) || 0;
        fileTotalNet =
          parseFloat(String(row["Net Price"] || "0").replace(/[^\d.]/g, "")) || 0;
      } else {
        const cartCode = String(row["Cart confirmation code"] || "");
        const extRef = String(
          row["Ext. booking ref"] ||
            row["External Booking Ref."] ||
            row["External booking ref"] ||
            ""
        );

        if (cartCode.startsWith("TOD")) {
          ref = String(row["Product confirmation code"] || "");
          isDirectOrEbike = true;
        } else {
          ref = extRef;
        }

        rawTitle = String(row["Product title"] || "");
        excelStartDate = row["Start date"];
        excelCreationDate = row["Creation date"];
        customerName = String(row["Customer"] || "Cliente");
        email = row["Email"] || null;
        phone = row["Phone number"] || null;

        const originalChannel = String(row["Booking channel"] || "Diretto");
        if (originalChannel.toLowerCase().trim() === "e-bike") {
          rawChannel = "Todointheworld";
          isDirectOrEbike = true;
        } else {
          rawChannel = originalChannel;
        }

        const paxParts = parseParticipants(String(row["Participants"] || ""));
        adults = paxParts.adults;
        children = paxParts.children;
        infants = paxParts.infants;
        isPaid = row["Payment status"] === "PAID_IN_FULL";
        isCancelled = String(row["Status"]).toUpperCase() === "CANCELLED";
      }

      if (!ref || ref === "undefined") {
        ref = String(row["Product confirmation code"] || "");
      }

      if (!ref) {
        results.skipped++;
        continue;
      }

      const experienceId = mappings[rawTitle];
      if (!experienceId) {
        results.skipped++;
        continue;
      }

      const exp = experiences?.find((e) => e.id === experienceId);
      const pricingPax = adults + children;
      const { date, time } = formatExcelDate(excelStartDate);
      const { date: creationDate } = formatExcelDate(excelCreationDate);

      if (!date) throw new Error("Data mancante o non valida");

      const finalPaymentStatus =
        isPaid || new Date(date) < today ? "paid" : "pending";

      const cleanStr = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
      const cleanRawChannel = cleanStr(rawChannel);

      let channel = channels?.find((c) => {
        const cleanC = cleanStr(c.name);
        return (
          cleanC === cleanRawChannel ||
          cleanC.includes(cleanRawChannel) ||
          cleanRawChannel.includes(cleanC)
        );
      });

      if (!channel && isDirectOrEbike) {
        channel = channels?.find((c) => {
          const cleanC = cleanStr(c.name);
          return (
            cleanC.includes("todo") ||
            cleanC.includes("dirett") ||
            cleanC.includes("sito")
          );
        });

        if (channel) rawChannel = channel.name;
      }

      let fLord = 0;
      let fNet = 0;
      let fUnitL = 0;
      let fUnitN = 0;
      const unitCost = exp?.supplier_unit_cost || 0;

      if (isGYG && fileTotalCustomer > 0) {
        fLord = fileTotalCustomer;
        fNet = fileTotalNet;
        fUnitL = pricingPax > 0 ? fLord / pricingPax : 0;
        fUnitN = pricingPax > 0 ? fNet / pricingPax : 0;
      } else {
        const { data: pR } = await supabaseServer
          .from("experience_channel_prices")
          .select("*")
          .eq("experience_id", experienceId)
          .eq("channel_id", channel?.id || 0)
          .maybeSingle();

        fUnitL = pR?.public_unit_price || 0;
        fUnitN = pR?.your_unit_price || 0;
        fLord = fUnitL * pricingPax;
        fNet = fUnitN * pricingPax;
      }

      const { error } = await supabaseServer.from("bookings").insert({
        booking_reference: ref,
        customer_name: customerName,
        customer_email: email,
        customer_phone: phone,
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
        total_people: adults + children + infants,
        pax: adults + children + infants,
        your_unit_price: fUnitN,
        public_unit_price: fUnitL,
        supplier_unit_cost: unitCost,
        total_to_you: fNet,
        total_customer: fLord,
        total_supplier_cost: unitCost * pricingPax,
        margin_total: fNet - unitCost * pricingPax,
        customer_payment_status: finalPaymentStatus,
        is_cancelled: isCancelled,
      });

      if (error) {
        if (error.code === "23505") {
          results.skipped++;
        } else {
          throw new Error(error.message);
        }
      } else {
        results.imported++;
      }
    } catch (e: any) {
      const rowRef =
        row["Booking Ref #"] || row["Product confirmation code"] || "Sconosciuto";
      results.errors.push(`Rif: ${rowRef}: ${e.message}`);
    }
  }

  await supabaseServer.from("import_logs").insert({
    imported: results.imported,
    skipped: results.skipped,
    errors: results.errors.length,
  });

  revalidatePath("/prenotazioni");
  revalidatePath("/");
  return results;
}