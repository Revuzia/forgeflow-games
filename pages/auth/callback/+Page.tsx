import { useEffect, useState } from "react";
import { supabase } from "../../../src/lib/supabase";

/**
 * OAuth callback page.
 *
 * Google OAuth (and any other provider configured via supabase.auth.signInWithOAuth)
 * redirects back to this URL with a code in the query string. Supabase's client
 * library auto-exchanges the code for a session on page load — we just wait for
 * the session to materialize, then bounce back to wherever the user came from
 * (or to the home page).
 *
 * 2026-05-05: created. Previously this route 404'd, breaking Google sign-in
 * even though signInWithGoogle() was implemented in lib/auth.ts.
 */
export default function AuthCallbackPage() {
  const [status, setStatus] = useState<"working" | "ok" | "error">("working");
  const [errorMsg, setErrorMsg] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    const finish = async () => {
      try {
        // Supabase auto-exchanges the OAuth code on page load. We just need
        // to wait for the session to be ready, then redirect home.
        const { data: { session }, error } = await supabase.auth.getSession();
        if (cancelled) return;
        if (error) {
          setStatus("error");
          setErrorMsg(error.message || "Sign-in failed");
          return;
        }
        if (session) {
          setStatus("ok");
          // Restore the page the user was on before sign-in (stashed in
          // localStorage by the sign-in trigger), or fall back to home.
          const returnTo = localStorage.getItem("forgeflow_auth_return_to") || "/";
          localStorage.removeItem("forgeflow_auth_return_to");
          window.location.replace(returnTo);
        } else {
          // No session yet — give the OAuth handshake one more tick
          setTimeout(async () => {
            if (cancelled) return;
            const { data } = await supabase.auth.getSession();
            if (data.session) {
              window.location.replace("/");
            } else {
              setStatus("error");
              setErrorMsg("No session after OAuth callback. Please try signing in again.");
            }
          }, 800);
        }
      } catch (e: any) {
        if (cancelled) return;
        setStatus("error");
        setErrorMsg(e?.message || String(e));
      }
    };
    finish();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="text-center">
        {status === "working" && (
          <>
            <div className="w-12 h-12 mx-auto mb-4 rounded-full border-2 border-brand-orange border-t-transparent animate-spin" />
            <h1 className="text-xl font-bold text-white mb-2">Signing you in…</h1>
            <p className="text-sm text-gray-400">One moment, finishing the OAuth handshake.</p>
          </>
        )}
        {status === "ok" && (
          <>
            <h1 className="text-xl font-bold text-white mb-2">Signed in!</h1>
            <p className="text-sm text-gray-400">Redirecting…</p>
          </>
        )}
        {status === "error" && (
          <>
            <h1 className="text-xl font-bold text-red-400 mb-2">Sign-in error</h1>
            <p className="text-sm text-gray-400 mb-4">{errorMsg}</p>
            <a href="/" className="text-brand-orange hover:underline text-sm">← Back to home</a>
          </>
        )}
      </div>
    </div>
  );
}
