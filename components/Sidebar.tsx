"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

const links = [
  { href: "/", label: "Dashboard" },
  { href: "/prenotazioni", label: "Prenotazioni" },
  { href: "/esperienze", label: "Esperienze" },
  { href: "/canali", label: "Canali" },
  { href: "/clienti", label: "Clienti" },
  { href: "/fornitori", label: "Fornitori" },
  { href: "/pagamenti", label: "Pagamenti" },
  { href: "/report", label: "📊 Report e Analisi" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  const handleLogout = async () => {
    // 1. Chiudiamo la sessione sicura su Supabase
    await supabase.auth.signOut();
    
    // 2. Disintegriamo il cookie "timbro" impostando una durata a zero
    document.cookie = "tm-auth-token=; path=/; max-age=0; SameSite=Lax";
    
    // 3. Sbattiamo l'utente fuori ricaricando la pagina (che attiverà il middleware)
    window.location.replace("/login");
  };

  return (
    <aside className="sticky top-6 flex h-[calc(100vh-48px)] w-full max-w-xs flex-col rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="mb-6">
        <p className="text-sm text-zinc-500">ToDo Manager</p>
        <h1 className="text-2xl font-bold text-zinc-900">Gestionale</h1>
      </div>

      {/* Navigazione che occupa lo spazio rimanente */}
      <nav className="flex flex-1 flex-col gap-2 overflow-y-auto">
        {links.map((link) => {
          // Mantiene il bottone scuro anche se navighi nelle sotto-pagine
          const isActive = link.href === "/" 
            ? pathname === "/" 
            : pathname.startsWith(link.href);

          return (
            <Link
              key={link.href}
              href={link.href}
              className={`rounded-xl px-4 py-3 font-medium transition ${
                isActive
                  ? "bg-zinc-900 text-white shadow-sm"
                  : "text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900"
              }`}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>

      {/* Pulsante Esci fissato in basso */}
      <div className="mt-4 border-t border-zinc-100 pt-4">
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
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
          </svg>
        </button>
      </div>
    </aside>
  );
}