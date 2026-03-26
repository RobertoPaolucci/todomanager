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
    <main className="min-h-screen bg-zinc-50 px-3 pt-3 pb-[calc(24px+env(safe-area-inset-bottom))] sm:p-6">
      <div className="mx-auto grid max-w-7xl items-start gap-3 sm:gap-6 lg:grid-cols-[260px_1fr]">
        <Sidebar />

        <div className="min-w-0 space-y-4 sm:space-y-6">
          <div className="rounded-2xl border border-zinc-200 bg-white px-4 py-4 shadow-sm sm:border-0 sm:bg-transparent sm:px-0 sm:py-0 sm:shadow-none">
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl">
              {title}
            </h1>

            {subtitle ? (
              <p className="mt-1 text-sm text-zinc-600 sm:text-base">
                {subtitle}
              </p>
            ) : null}
          </div>

          {children}
        </div>
      </div>
    </main>
  );
}