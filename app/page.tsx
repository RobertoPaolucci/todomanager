export default function Home() {
  return (
    <main className="min-h-screen bg-gray-50 text-gray-900 p-4 pb-24">
      <div className="mx-auto max-w-md">
        <header className="mb-6">
          <p className="text-sm text-gray-500">ToDo Manager</p>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-sm text-gray-600 mt-1">
            Gestionale esperienze, clienti e fornitori
          </p>
        </header>

        <section className="grid grid-cols-2 gap-3 mb-6">
          <div className="rounded-2xl bg-white p-4 shadow-sm border border-gray-200">
            <p className="text-xs text-gray-500">Incassato mese</p>
            <p className="text-2xl font-bold mt-1">€ 4.250</p>
          </div>

          <div className="rounded-2xl bg-white p-4 shadow-sm border border-gray-200">
            <p className="text-xs text-gray-500">Da incassare</p>
            <p className="text-2xl font-bold mt-1">€ 1.180</p>
          </div>

          <div className="rounded-2xl bg-white p-4 shadow-sm border border-gray-200">
            <p className="text-xs text-gray-500">Da pagare</p>
            <p className="text-2xl font-bold mt-1">€ 2.040</p>
          </div>

          <div className="rounded-2xl bg-white p-4 shadow-sm border border-gray-200">
            <p className="text-xs text-gray-500">Margine mese</p>
            <p className="text-2xl font-bold mt-1">€ 1.030</p>
          </div>
        </section>

        <section className="rounded-2xl bg-white p-4 shadow-sm border border-gray-200 mb-4">
          <h2 className="text-lg font-semibold mb-3">Prenotazioni prossime</h2>

          <div className="space-y-3">
            <div className="rounded-xl bg-gray-50 p-3 border border-gray-100">
              <p className="font-medium">Farm Tour & Lunch</p>
              <p className="text-sm text-gray-600">John Smith • 4 pax • 14 Mar</p>
              <p className="text-sm text-amber-600 mt-1">Cliente: parziale</p>
            </div>

            <div className="rounded-xl bg-gray-50 p-3 border border-gray-100">
              <p className="font-medium">Wine Tasting</p>
              <p className="text-sm text-gray-600">Emily Brown • 2 pax • 15 Mar</p>
              <p className="text-sm text-green-600 mt-1">Cliente: pagato</p>
            </div>

            <div className="rounded-xl bg-gray-50 p-3 border border-gray-100">
              <p className="font-medium">E-bike Tour</p>
              <p className="text-sm text-gray-600">Lucas Martin • 2 pax • 16 Mar</p>
              <p className="text-sm text-red-600 mt-1">Fornitore: da pagare</p>
            </div>
          </div>
        </section>

        <section className="rounded-2xl bg-white p-4 shadow-sm border border-gray-200 mb-4">
          <h2 className="text-lg font-semibold mb-3">Attenzione</h2>
          <ul className="space-y-2 text-sm text-gray-700">
            <li>• 3 clienti non saldati</li>
            <li>• 2 fornitori da pagare</li>
            <li>• 1 prenotazione incompleta</li>
          </ul>
        </section>

        <button className="w-full rounded-2xl bg-black text-white py-4 text-base font-semibold shadow-sm">
          + Nuova prenotazione
        </button>
      </div>

      <nav className="fixed bottom-0 left-0 right-0 border-t border-gray-200 bg-white">
        <div className="mx-auto max-w-md grid grid-cols-5 text-center text-xs">
          <div className="py-3 font-semibold text-black">Home</div>
          <div className="py-3 text-gray-500">Prenotazioni</div>
          <div className="py-3 text-gray-500">Esperienze</div>
          <div className="py-3 text-gray-500">Fornitori</div>
          <div className="py-3 text-gray-500">Pagamenti</div>
        </div>
      </nav>
    </main>
  );
}