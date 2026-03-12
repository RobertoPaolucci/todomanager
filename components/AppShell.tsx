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
    <main className="min-h-screen bg-zinc-50 p-6">
      <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[260px_1fr]">
        <Sidebar />

        <div className="space-y-6">
          <div>
            <h1 className="text-3xl font-bold text-zinc-900">{title}</h1>

            {subtitle ? (
              <p className="mt-1 text-zinc-600">{subtitle}</p>
            ) : null}

          </div>

          {children}

        </div>
      </div>
    </main>
  );
}