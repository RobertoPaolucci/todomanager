"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const { data, error: supabaseError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (supabaseError) {
        // Mostriamo l'errore esatto che ci restituisce Supabase
        setError(`Errore: ${supabaseError.message}`);
        setLoading(false);
        return;
      }

      if (data.session) {
        // Il login è andato a buon fine, creiamo il cookie
        document.cookie = `tm-auth-token=${data.session.access_token}; path=/; max-age=604800; SameSite=Lax`;
        
        // Forziamo il reindirizzamento
        window.location.replace("/");
      } else {
        // Supabase non ha dato errore, ma non ha fornito la sessione (es. email non confermata)
        setError("Attenzione: Sessione vuota. Hai disabilitato la conferma email su Supabase?");
        setLoading(false);
      }
    } catch (err: any) {
      setError(`Errore imprevisto: ${err.message}`);
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-100 p-4">
      <div className="w-full max-w-md rounded-3xl bg-white p-8 shadow-xl">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-black text-zinc-900">ToDo Manager</h1>
          <p className="mt-2 text-sm text-zinc-500">
            Inserisci le tue credenziali per accedere al gestionale.
          </p>
        </div>

        <form onSubmit={handleLogin} className="space-y-5">
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-700">
              Email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none transition focus:border-zinc-500"
              placeholder="tu@email.com"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-700">
              Password
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none transition focus:border-zinc-500"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-zinc-900 px-4 py-3.5 font-bold text-white transition hover:bg-zinc-700 disabled:opacity-50"
          >
            {loading ? "Accesso in corso..." : "Accedi"}
          </button>
        </form>
      </div>
    </div>
  );
}