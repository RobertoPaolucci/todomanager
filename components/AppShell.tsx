import { ReactNode } from "react";
import Sidebar from "@/components/Sidebar";

type AppShellProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
};

export default function AppShell({
  title,
  subtitle,
  children,
}: AppShellProps) {
  return (
    // overflow-x-hidden impedisce a Safari di zoomare all'indietro se qualcosa sfora.
    // p-4 su mobile dà più respiro ai campi, p-6 torna su tablet/pc.
    <main className="min-h-screen bg-zinc-50 p-4 sm:p-6 overflow-x-hidden w-full">
      <div className="mx-auto grid max-w-7xl gap-4 sm:gap-6 lg:grid-cols-[260px_1fr]">
        <Sidebar />

        <div className="space-y-4 sm:space-y-6 w-full max-w-full">
          <div>
            {/* Titolo leggermente più compatto su mobile */}
            <h1 className="text-2xl sm:text-3xl font-bold text-zinc-900">{title}</h1>

            {subtitle ? (
              <p className="mt-1 text-sm sm:text-base text-zinc-600">{subtitle}</p>
            ) : null}
          </div>

          {/* Contenitore blindato per evitare che i figli rompano la griglia */}
          <div className="w-full max-w-full">
            {children}
          </div>
        </div>
      </div>
    </main>
  );
}