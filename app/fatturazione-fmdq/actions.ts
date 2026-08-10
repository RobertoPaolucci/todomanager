"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase-server";

function normalizeText(value: FormDataEntryValue | null) {
  const text = String(value || "").trim();
  return text === "" ? null : text;
}

export async function saveFmdqInvoice(formData: FormData) {
  const channelId = Number(formData.get("channel_id") || 0);
  const month = String(formData.get("month") || "").trim();

  const isInvoiced =
    formData.get("is_invoiced") === "on" ||
    formData.get("is_invoiced") === "true";

  const invoiceDate = normalizeText(
    formData.get("invoice_date")
  );

  const invoiceNumber = normalizeText(
    formData.get("invoice_number")
  );

  if (!channelId) {
    throw new Error("Canale non valido");
  }

  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new Error("Mese non valido");
  }

  const invoiceMonth = `${month}-01`;

  const { error } = await supabaseServer
    .from("fmdq_monthly_invoices")
    .upsert(
      {
        channel_id: channelId,
        invoice_month: invoiceMonth,
        is_invoiced: isInvoiced,
        invoice_date: invoiceDate,
        invoice_number: invoiceNumber,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "channel_id,invoice_month",
      }
    );

  if (error) {
    throw new Error(
      `Errore salvataggio fatturazione: ${error.message}`
    );
  }

  revalidatePath("/fatturazione-fmdq");

  redirect(`/fatturazione-fmdq?month=${month}`);
}