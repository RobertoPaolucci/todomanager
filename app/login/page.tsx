"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    // Peschiamo i dati fisicamente dal form HTML al momento del click.
    // Infallibile contro i completamenti automatici e i password manager.
    const formData = new FormData(e.currentTarget);
    const email = String(formData.get("email") || "").trim();
    const password = String(formData.get("password") || "");

    if (!email || !password) {
      setError("Per favore, compila sia l'email che la password.");
      setLoading(false);
      return;
    }

    try {
      const { data, error: supabaseError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (supabaseError) {
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
        setError("Attenzione: Sessione vuota. Controlla le impostazioni di Supabase.");
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
            <label htmlFor="email" className="mb-1 block text-sm font-medium text-zinc-700">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none transition focus:border-zinc-500"
              placeholder="tu@email.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium text-zinc-700">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
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