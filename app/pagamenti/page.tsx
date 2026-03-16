export const dynamic = "force-dynamic";

import Link from "next/link";
import Sidebar from "@/components/Sidebar";
import SectionCard from "@/components/SectionCard";
import { supabase } from "@/lib/supabase";

function formatEuro(value: number) {
  return new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR",
  }).format(value);
}

export default async function PagamentiPage() {
  const todayObj = new Date();
  const todayStr = todayObj.toISOString().split("T")[0];

  const [suppliersRes, bookingsRes, paymentsRes] = await Promise.all([
    supabase.from("suppliers").select("id, name").order("name"),
    supabase.from("bookings").select("supplier_id, total_supplier_cost, booking_date, is_cancelled"),
    supabase.from("supplier_payments").select("supplier_id, amount"),
  ]);

  const suppliers = suppliersRes.data || [];
  const bookings = bookingsRes.data || [];
  const payments = paymentsRes.data || [];

  const supplierBalances = suppliers.map((supplier) => {
    const supplierBookings = bookings.filter((b) => b.supplier_id === supplier.id && !b.is_cancelled);
    const supplierPayments = payments.filter((p) => p.supplier_id === supplier.id);
    
    const totalCosto = supplierBookings.reduce((sum, b) => sum + Number(b.total_supplier_cost || 0), 0);
    const totalPagato = supplierPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    
    const costoMaturatoOggi = supplierBookings
      .filter(b => b.booking_date && b.booking_date <= todayStr)
      .reduce((sum, b) => sum + Number(b.total_supplier_cost || 0), 0);

    const daPagareOggi = Math.max(0, costoMaturatoOggi - totalPagato);

    return {
      ...supplier,
      totalCosto,
      totalPagato,
      daPagareOggi,
      prenotazioniCount: supplierBookings.length,
    };
  });

  const activeSuppliers = supplierBalances.filter(s => s.prenotazioniCount > 0);

  return (
    <main className="min-h-screen bg-zinc-50 p-6">
      <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[260px_1fr]">
        <Sidebar />

        <div className="space-y-6">
          <div>
            <h1 className="text-3xl font-bold text-zinc-900">Pagamenti</h1>
            <p className="mt-1 text-zinc-600">
              Stato dei pagamenti ed estratti conto fornitori
            </p>
          </div>

          <SectionCard title="Situazione contabile Fornitori">
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-zinc-200 text-zinc-500 uppercase text-[11px] font-bold">
                  <tr>
                    <th className="py-3 pr-4">Fornitore</th>
                    <th className="py-3 pr-4 text-center">Prenotazioni</th>
                    <th className="py-3 pr-4 text-right">Totale Generato</th>
                    <th className="py-3 pr-4 text-right text-green-700">Già Pagato</th>
                    <th className="py-3 pr-4 text-right text-red-700">Da Saldare (Oggi)</th>
                  </tr>
                </thead>
                <tbody>
                  {activeSuppliers.map((supplier) => (
                    <tr 
                      key={supplier.id} 
                      className="border-b border-zinc-100 transition hover:bg-zinc-50 cursor-pointer group"
                    >
                      <td className="py-4 pr-4 font-medium text-zinc-900 group-hover:text-blue-600">
                        <Link href={`/pagamenti/${supplier.id}`} className="block w-full">
                          {supplier.name}
                        </Link>
                      </td>
                      <td className="py-4 pr-4 text-center">
                        <Link href={`/pagamenti/${supplier.id}`} className="block w-full text-zinc-500">
                          {supplier.prenotazioniCount}
                        </Link>
                      </td>
                      <td className="py-4 pr-4 text-right text-zinc-500">
                        <Link href={`/pagamenti/${supplier.id}`} className="block w-full">
                          {formatEuro(supplier.totalCosto)}
                        </Link>
                      </td>
                      <td className="py-4 pr-4 text-right font-medium text-green-700">
                        <Link href={`/pagamenti/${supplier.id}`} className="block w-full">
                          {formatEuro(supplier.totalPagato)}
                        </Link>
                      </td>
                      <td className="py-4 pr-4 text-right font-bold text-red-600">
                        <Link href={`/pagamenti/${supplier.id}`} className="block w-full">
                          {formatEuro(supplier.daPagareOggi)}
                        </Link>
                      </td>
                    </tr>
                  ))}
                  {activeSuppliers.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-zinc-500">
                        Nessun dato contabile disponibile.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </div>
      </div>
    </main>
  );
}