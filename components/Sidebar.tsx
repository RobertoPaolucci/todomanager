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
    // Chiudiamo la sessione sicura su Supabase
    await supabase.auth.signOut();
    
    // Disintegriamo il cookie "timbro" impostando una durata a zero
    document.cookie = "tm-auth-token=; path=/; max-age=0; SameSite=Lax";
    
    // Sbattiamo l'utente fuori ricaricando la pagina (che attiverà il middleware)
    window.location.replace("/login");
  };

  return (
    <aside className="flex w-full flex-col rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm lg:sticky lg:top-6 lg:h-[calc(100vh-48px)] lg:max-w-xs">
      
      {/* Testata: Su mobile il tasto esci è qui di fianco al titolo */}
      <div className="mb-4 flex items-center justify-between lg:mb-6 lg:block">
        <div>
          <p className="text-xs text-zinc-500 lg:text-sm">ToDo Manager</p>
          <h1 className="text-xl font-bold text-zinc-900 lg:text-2xl">Gestionale</h1>
        </div>
        
        {/* Pulsante Esci (SOLO MOBILE) */}
        <button
          onClick={handleLogout}
          className="flex items-center justify-center rounded-xl bg-red-50 p-2.5 text-red-600 transition hover:bg-red-100 lg:hidden"
          title="Esci dal gestionale"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-5 w-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
          </svg>
        </button>
      </div>

      {/* Navigazione: Orizzontale su mobile, Verticale su Desktop */}
      <nav className="flex gap-2 overflow-x-auto pb-2 lg:flex-1 lg:flex-col lg:overflow-y-auto lg:pb-0" style={{ scrollbarWidth: 'none' }}>
        {links.map((link) => {
          const isActive = link.href === "/" 
            ? pathname === "/" 
            : pathname.startsWith(link.href);

          return (
            <Link
              key={link.href}
              href={link.href}
              className={`whitespace-nowrap rounded-xl px-4 py-3 text-sm font-medium transition lg:whitespace-normal lg:text-base ${
                isActive
                  ? "bg-zinc-900 text-white shadow-sm"
                  : "bg-zinc-50 text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900 lg:bg-transparent"
              }`}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>

      {/* Pulsante Esci (SOLO DESKTOP) fissato in basso */}
      <div className="hidden lg:mt-4 lg:block lg:border-t lg:border-zinc-100 lg:pt-4">
        <button
          onClick={handleLogout}
          className="flex w-full items-center justify-between rounded-xl px-4 py-3 font-bold text-red-600 transition hover:bg-red-50"
        >
          <span>Esci</span>
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-5 w-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
          </svg>
        </button>
      </div>
    </aside>
  );
}