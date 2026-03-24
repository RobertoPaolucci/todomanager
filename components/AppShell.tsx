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
    <main className="min-h-screen bg-zinc-50 p-3 sm:p-6">
      <div className="mx-auto grid max-w-7xl gap-4 sm:gap-6 lg:grid-cols-[260px_1fr]">
        <div className="hidden lg:block">
          <Sidebar />
        </div>

        <div className="min-w-0 space-y-4 sm:space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 sm:text-3xl">{title}</h1>

            {subtitle ? (
              <p className="mt-1 text-sm text-zinc-600 sm:text-base">{subtitle}</p>
            ) : null}
          </div>

          {children}
        </div>
      </div>
    </main>
  );
}