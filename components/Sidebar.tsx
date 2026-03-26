"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase";

const links = [
  { href: "/", label: "Dashboard", mobileLabel: "Dashboard" },
  { href: "/prenotazioni", label: "Prenotazioni", mobileLabel: "Prenot." },
  { href: "/esperienze", label: "Esperienze", mobileLabel: "Esper." },
  { href: "/canali", label: "Canali", mobileLabel: "Canali" },
  { href: "/clienti", label: "Clienti", mobileLabel: "Clienti" },
  { href: "/fornitori", label: "Fornitori", mobileLabel: "Fornitori" },
  { href: "/pagamenti", label: "Pagamenti", mobileLabel: "Pagam." },
  { href: "/report", label: "📊 Report e Analisi", mobileLabel: "📊 Report" },
];

export default function Sidebar() {
  const pathname = usePathname();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    document.cookie = "tm-auth-token=; path=/; max-age=0; SameSite=Lax";
    window.location.replace("/login");
  };

  return (
    <aside className="sticky top-0 z-30 flex w-full flex-col rounded-2xl border border-zinc-200 bg-white/95 p-3 shadow-sm backdrop-blur lg:top-6 lg:h-[calc(100vh-48px)] lg:max-w-xs lg:rounded-2xl lg:bg-white lg:p-4 lg:backdrop-blur-0">
      <div className="mb-3 flex items-center justify-between lg:mb-6 lg:block">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-500 lg:text-sm lg:normal-case lg:tracking-normal">
            ToDo Manager
          </p>
          <h1 className="text-lg font-bold text-zinc-900 lg:text-2xl">
            Gestionale
          </h1>
        </div>

        <button
          onClick={handleLogout}
          className="flex h-11 w-11 items-center justify-center rounded-xl bg-red-50 text-red-600 transition hover:bg-red-100 lg:hidden"
          title="Esci dal gestionale"
          aria-label="Esci dal gestionale"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
            className="h-5 w-5"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75"
            />
          </svg>
        </button>
      </div>

      <nav
        className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:flex-1 lg:flex-col lg:overflow-y-auto lg:pb-0"
        style={{ scrollbarWidth: "none" }}
      >
        {links.map((link) => {
          const isActive =
            link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);

          return (
            <Link
              key={link.href}
              href={link.href}
              aria-label={link.label}
className={`shrink-0 whitespace-nowrap rounded-2xl px-5 py-3.5 text-[15px] font-semibold transition lg:whitespace-normal lg:rounded-xl lg:px-4 lg:py-3 lg:text-base ${
  isActive
    ? "bg-zinc-900 text-white shadow-sm"
    : "bg-zinc-50 text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900 lg:bg-transparent"
}`}
            >
              <span className="lg:hidden">{link.mobileLabel ?? link.label}</span>
              <span className="hidden lg:inline">{link.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="hidden lg:mt-4 lg:block lg:border-t lg:border-zinc-100 lg:pt-4">
        <button
          onClick={handleLogout}
          className="flex w-full items-center justify-between rounded-xl px-4 py-3 font-bold text-red-600 transition hover:bg-red-50"
        >
          <span>Esci</span>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
            className="h-5 w-5"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75"
            />
          </svg>
        </button>
      </div>
    </aside>
  );
}