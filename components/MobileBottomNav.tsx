"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  {
    href: "/",
    label: "Oggi",
    isActive: (pathname: string) => pathname === "/",
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        className="h-5 w-5"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3 10.25 12 3l9 7.25"
        />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M5.25 9.75V20a.75.75 0 0 0 .75.75h4.5v-5.25c0-.414.336-.75.75-.75h1.5c.414 0 .75.336.75.75v5.25H18a.75.75 0 0 0 .75-.75V9.75"
        />
      </svg>
    ),
  },
  {
    href: "/prenotazioni",
    label: "Prenot.",
    isActive: (pathname: string) =>
      pathname === "/prenotazioni" || pathname.startsWith("/prenotazioni/"),
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        className="h-5 w-5"
      >
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M16 3v4M8 3v4M3 10h18" />
      </svg>
    ),
  },
  {
    href: "/prenotazioni/nuova",
    label: "Nuova",
    isActive: (pathname: string) => pathname === "/prenotazioni/nuova",
    isPrimary: true,
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.25}
        className="h-6 w-6"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
      </svg>
    ),
  },
  {
    href: "/pagamenti",
    label: "Pagam.",
    isActive: (pathname: string) => pathname.startsWith("/pagamenti"),
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        className="h-5 w-5"
      >
        <rect x="3" y="6" width="18" height="12" rx="2" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18" />
      </svg>
    ),
  },
  {
    href: "/report",
    label: "Altro",
    isActive: (pathname: string) =>
      pathname.startsWith("/report") ||
      pathname.startsWith("/esperienze") ||
      pathname.startsWith("/canali") ||
      pathname.startsWith("/clienti") ||
      pathname.startsWith("/fornitori"),
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        className="h-5 w-5"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M4 12h16M4 17h16" />
      </svg>
    ),
  },
];

export default function MobileBottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-zinc-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/85 lg:hidden">
      <div className="mx-auto grid max-w-md grid-cols-5 items-end px-2 pt-2 pb-[calc(10px+env(safe-area-inset-bottom))]">
        {items.map((item) => {
          const active = item.isActive(pathname);

          if (item.isPrimary) {
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex flex-col items-center justify-end gap-1 text-zinc-900"
              >
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-zinc-900 text-white shadow-lg">
                  {item.icon}
                </span>
                <span className="text-[11px] font-bold">{item.label}</span>
              </Link>
            );
          }

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex min-h-[60px] flex-col items-center justify-center gap-1 rounded-xl px-1 text-center transition ${
                active ? "text-zinc-900" : "text-zinc-500"
              }`}
            >
              <span
                className={`transition ${
                  active ? "scale-105 text-zinc-900" : "text-zinc-500"
                }`}
              >
                {item.icon}
              </span>
              <span className={`text-[11px] font-medium ${active ? "font-bold" : ""}`}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}