import AppShell from "@/components/AppShell";
import ModificaEsperienzaForm from "@/components/ModificaEsperienzaForm";
import SectionCard from "@/components/SectionCard";
import { getExperienceById, getSuppliers } from "@/lib/queries";

type PageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function ModificaEsperienzaPage({ params }: PageProps) {
  const { id } = await params;
  const experienceId = Number(id);

  const [experience, suppliers] = await Promise.all([
    getExperienceById(experienceId),
    getSuppliers(),
  ]);

  return (
    <AppShell
      title="Modifica Esperienza"
      subtitle="Aggiorna i dati dell’esperienza"
    >
      <SectionCard title="Dati esperienza">
        <ModificaEsperienzaForm
          experience={experience}
          suppliers={suppliers}
        />
      </SectionCard>
    </AppShell>
  );
}