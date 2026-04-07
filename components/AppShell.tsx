import { ReactNode } from "react";
import Sidebar from "@/components/Sidebar";
import MobileBottomNav from "@/components/MobileBottomNav";

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
    <>
      <main className="min-h-screen bg-zinc-50 px-3 pt-3 pb-[calc(92px+env(safe-area-inset-bottom))] sm:p-6 lg:pb-6">
        <div className="mx-auto grid max-w-7xl items-start gap-3 sm:gap-6 lg:grid-cols-[260px_1fr]">
          <div className="hidden lg:block">
            <Sidebar />
          </div>

          <div className="min-w-0 space-y-4 sm:space-y-6">
            <div className="rounded-3xl border border-zinc-200 bg-white px-4 py-4 shadow-sm sm:px-5 lg:rounded-2xl lg:border-0 lg:bg-transparent lg:px-0 lg:py-0 lg:shadow-none">
              <h1 className="text-[30px] font-bold leading-none tracking-tight text-zinc-900 sm:text-3xl">
                {title}
              </h1>

              {subtitle ? (
                <p className="mt-2 text-sm text-zinc-600 sm:text-base">
                  {subtitle}
                </p>
              ) : null}
            </div>

            {children}
          </div>
        </div>
      </main>

      <MobileBottomNav />
    </>
  );
}