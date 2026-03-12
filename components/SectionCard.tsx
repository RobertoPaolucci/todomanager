import { ReactNode } from "react";

type SectionCardProps = {
  title: string;
  children: ReactNode;
};

export default function SectionCard({ title, children }: SectionCardProps) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <h2 className="mb-4 text-xl font-semibold text-zinc-900">{title}</h2>
      {children}
    </section>
  );
}