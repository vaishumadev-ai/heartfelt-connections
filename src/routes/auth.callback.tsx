import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { safeNextPath, DEFAULT_NEXT } from "@/lib/auth-redirect";

const searchSchema = z.object({
  next: z.string().optional(),
  code: z.string().optional(),
  error: z.string().optional(),
  error_description: z.string().optional(),
  error_code: z.string().optional(),
});

export const Route = createFileRoute("/auth/callback")({
  ssr: false,
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Signing you in — Mozok" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: CallbackPage,
});

type State =
  | { kind: "working" }
  | { kind: "expired" }
  | { kind: "invalid" }
  | { kind: "provider_error" };

function classifyProviderError(code: string | undefined, description: string | undefined): State {
  const s = `${code ?? ""} ${description ?? ""}`.toLowerCase();
  if (s.includes("expired") || s.includes("otp_expired")) return { kind: "expired" };
  if (s.includes("access_denied") || s.includes("invalid")) return { kind: "invalid" };
  return { kind: "provider_error" };
}

function CallbackPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ kind: "working" });
  const nextPath = safeNextPath(search.next ?? null, DEFAULT_NEXT);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      // Provider-signaled error in query params.
      if (search.error || search.error_code) {
        if (!cancelled) setState(classifyProviderError(search.error_code, search.error_description ?? search.error));
        cleanUrl();
        return;
      }

      // PKCE code exchange path.
      if (search.code) {
        const { error } = await supabase.auth.exchangeCodeForSession(search.code);
        cleanUrl();
        if (cancelled) return;
        if (error) {
          setState(classifyProviderError(undefined, error.message));
          return;
        }
        navigate({ to: nextPath as "/dashboard", replace: true });
        return;
      }

      // Implicit / recovery flow: tokens may be in the URL hash. supabase-js
      // detectSessionInUrl handles it on client init; poll briefly for the
      // resulting session.
      const hash = typeof window !== "undefined" ? window.location.hash : "";
      if (hash && (hash.includes("access_token") || hash.includes("error"))) {
        if (hash.includes("error")) {
          const params = new URLSearchParams(hash.replace(/^#/, ""));
          if (!cancelled) {
            setState(
              classifyProviderError(
                params.get("error_code") ?? undefined,
                params.get("error_description") ?? params.get("error") ?? undefined,
              ),
            );
          }
          cleanUrl();
          return;
        }
        for (let i = 0; i < 20 && !cancelled; i++) {
          const { data } = await supabase.auth.getSession();
          if (data.session) {
            cleanUrl();
            navigate({ to: nextPath as "/dashboard", replace: true });
            return;
          }
          await new Promise((r) => setTimeout(r, 150));
        }
        if (!cancelled) setState({ kind: "invalid" });
        cleanUrl();
        return;
      }

      // Nothing to process — fall back based on current session.
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session) {
        navigate({ to: nextPath as "/dashboard", replace: true });
      } else {
        setState({ kind: "invalid" });
      }
    }

    run().catch(() => {
      if (!cancelled) setState({ kind: "provider_error" });
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="min-h-screen bg-background flex items-center justify-center p-6"
      style={{ fontFamily: "Poppins, sans-serif" }}
    >
      <div className="w-full max-w-md rounded-3xl bg-card p-8 text-center">
        {state.kind === "working" ? (
          <>
            <h1 className="text-2xl font-bold">Signing you in…</h1>
            <p className="mt-2 text-sm text-muted-foreground">One moment.</p>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold">
              {state.kind === "expired"
                ? "This link has expired"
                : state.kind === "invalid"
                  ? "This link is no longer valid"
                  : "We couldn't complete sign-in"}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Please request a new email and try again.
            </p>
            <div className="mt-6 space-y-3">
              <Link
                to="/auth"
                search={{ mode: "signin" }}
                className="inline-flex w-full items-center justify-center rounded-full bg-foreground px-4 py-3 text-sm font-semibold text-primary-foreground hover:opacity-95"
              >
                Return to sign in
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function cleanUrl() {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    const sensitive = [
      "code",
      "access_token",
      "refresh_token",
      "expires_in",
      "expires_at",
      "token_type",
      "provider_token",
      "provider_refresh_token",
      "error",
      "error_code",
      "error_description",
    ];
    for (const k of sensitive) url.searchParams.delete(k);
    url.hash = "";
    window.history.replaceState({}, "", url.toString());
  } catch {
    // ignore
  }
}