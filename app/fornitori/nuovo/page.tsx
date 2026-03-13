import Link from "next/link";
import AppShell from "@/components/AppShell";
import SectionCard from "@/components/SectionCard";
import { createSupplier } from "../actions";

export default function NuovoFornitorePage() {
  return (
    <AppShell
      title="Nuovo fornitore"
      subtitle="Crea un nuovo fornitore o partner"
    >
      <div className="mb-4 flex items-center justify-end">
        <Link
          href="/fornitori"
          className="rounded-xl border border-zinc-300 px-4 py-3 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100"
        >
          ← Torna ai fornitori
        </Link>
      </div>

      <SectionCard title="Dati fornitore">
        <form action={createSupplier} className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label
                htmlFor="name"
                className="mb-2 block text-sm font-medium text-zinc-700"
              >
                Nome fornitore
              </label>
              <input
                id="name"
                name="name"
                type="text"
                required
                className="w-full rounded-xl border border-zinc-300 px-4 py-3 text-sm outline-none transition focus:border-zinc-500"
                placeholder="Es. Fattoria Madonna della Querce"
              />
            </div>

            <div>
              <label
                htmlFor="contact_person"
                className="mb-2 block text-sm font-medium text-zinc-700"
              >
                Contatto
              </label>
              <input
                id="contact_person"
                name="contact_person"
                type="text"
                className="w-full rounded-xl border border-zinc-300 px-4 py-3 text-sm outline-none transition focus:border-zinc-500"
                placeholder="Es. Roberto Paolucci"
              />
            </div>

            <div>
              <label
                htmlFor="email"
                className="mb-2 block text-sm font-medium text-zinc-700"
              >
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                className="w-full rounded-xl border border-zinc-300 px-4 py-3 text-sm outline-none transition focus:border-zinc-500"
                placeholder="info@esempio.com"
              />
            </div>

            <div>
              <label
                htmlFor="phone"
                className="mb-2 block text-sm font-medium text-zinc-700"
              >
                Telefono
              </label>
              <input
                id="phone"
                name="phone"
                type="text"
                className="w-full rounded-xl border border-zinc-300 px-4 py-3 text-sm outline-none transition focus:border-zinc-500"
                placeholder="+39 ..."
              />
            </div>

            <div className="md:col-span-2">
              <label
                htmlFor="website"
                className="mb-2 block text-sm font-medium text-zinc-700"
              >
                Sito web
              </label>
              <input
                id="website"
                name="website"
                type="text"
                className="w-full rounded-xl border border-zinc-300 px-4 py-3 text-sm outline-none transition focus:border-zinc-500"
                placeholder="https://..."
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="notes"
              className="mb-2 block text-sm font-medium text-zinc-700"
            >
              Note
            </label>
            <textarea
              id="notes"
              name="notes"
              rows={4}
              className="w-full rounded-xl border border-zinc-300 px-4 py-3 text-sm outline-none transition focus:border-zinc-500"
              placeholder="Note interne"
            />
          </div>

          <div className="flex items-center gap-3">
            <input
              id="active"
              name="active"
              type="checkbox"
              defaultChecked
              className="h-4 w-4 rounded border-zinc-300"
            />
            <label htmlFor="active" className="text-sm text-zinc-700">
              Fornitore attivo
            </label>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              className="rounded-xl bg-zinc-900 px-5 py-3 text-sm font-medium text-white transition hover:bg-zinc-700"
            >
              Salva fornitore
            </button>
          </div>
        </form>
      </SectionCard>
    </AppShell>
  );
}