"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Dashboard" },
  { href: "/prenotazioni", label: "Prenotazioni" },
  { href: "/esperienze", label: "Esperienze" },
  { href: "/canali", label: "Canali" },
  { href: "/clienti", label: "Clienti" },
  { href: "/fornitori", label: "Fornitori" },
  { href: "/pagamenti", label: "Pagamenti" },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-full max-w-xs rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="mb-6">
        <p className="text-sm text-zinc-500">ToDo Manager</p>
        <h1 className="text-2xl font-bold text-zinc-900">Gestionale</h1>
      </div>

      <nav className="flex flex-col gap-2">
        {links.map((link) => {
          const isActive = pathname === link.href;

          return (
            <Link
              key={link.href}
              href={link.href}
              className={`rounded-xl px-4 py-3 transition ${
                isActive
                  ? "bg-zinc-900 text-white"
                  : "text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900"
              }`}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}