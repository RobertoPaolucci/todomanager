import Link from "next/link";

const links = [
  { href: "/", label: "Dashboard" },
  { href: "/prenotazioni", label: "Prenotazioni" },
  { href: "/clienti", label: "Clienti" },
  { href: "/fornitori", label: "Fornitori" },
  { href: "/pagamenti", label: "Pagamenti" },
];

export default function Sidebar() {
  return (
    <aside className="w-full max-w-xs rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="mb-6">
        <p className="text-sm text-zinc-500">ToDo Manager</p>
        <h1 className="text-2xl font-bold text-zinc-900">Gestionale</h1>
      </div>

      <nav className="flex flex-col gap-2">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="rounded-xl px-4 py-3 text-zinc-700 transition hover:bg-zinc-100 hover:text-zinc-900"
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}