"use client";

import { useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { syncAuthCookie } from "@/lib/sync-auth-cookie";

// Supabase refreshes access tokens in the browser. Reflect every refresh in
// the cookie read by Next.js Proxy, without exposing the refresh token.
export default function SessionCookieSync() {
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (
          event === "INITIAL_SESSION" ||
          event === "SIGNED_IN" ||
          event === "TOKEN_REFRESHED" ||
          event === "SIGNED_OUT"
        ) {
          syncAuthCookie(session);
        }
      }
    );

    void supabase.auth.getSession().then(({ data, error }) => {
      if (!error) syncAuthCookie(data.session);
    }).catch(() => {
      // Do not accept an unverified session on network failures.
    });

    return () => subscription.unsubscribe();
  }, []);

  return null;
}
