import AppShell from "@/components/AppShell";
import SectionCard from "@/components/SectionCard";
import { getSuppliers } from "@/lib/queries";
import NuovaEsperienzaForm from "@/components/NuovaEsperienzaForm";

export default async function NuovaEsperienzaPage() {
  const suppliers = await getSuppliers();

  return (
    <AppShell
      title="Nuova Esperienza"
      subtitle="Aggiungi una nuova esperienza al gestionale"
    >
      <SectionCard title="Dati esperienza">
        <NuovaEsperienzaForm suppliers={suppliers} />
      </SectionCard>
    </AppShell>
  );
}