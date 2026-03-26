import { ReactNode } from "react";

type SectionCardProps = {
  title: string;
  children: ReactNode;
};

export default function SectionCard({ title, children }: SectionCardProps) {
  return (
    <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5">
      <h2 className="mb-4 text-lg font-semibold text-zinc-900 sm:text-xl">
        {title}
      </h2>
      {children}
    </section>
  );
}