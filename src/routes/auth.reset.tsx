import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth/reset")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Reset password — Mozok" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ResetPage,
});

type State =
  | { kind: "checking" }
  | { kind: "ready" }
  | { kind: "expired" }
  | { kind: "invalid" }
  | { kind: "done" };

function ResetPage() {
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ kind: "checking" });
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // A valid recovery flow either arrives with a PASSWORD_RECOVERY event OR
    // the client has already exchanged the hash on init and holds a session.
    let cancelled = false;
    let resolved = false;

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (cancelled) return;
      if (event === "PASSWORD_RECOVERY") {
        resolved = true;
        setState({ kind: "ready" });
      }
    });

    // Inspect URL for provider-signaled errors.
    const hash = typeof window !== "undefined" ? window.location.hash : "";
    if (hash.includes("error")) {
      const params = new URLSearchParams(hash.replace(/^#/, ""));
      const desc = (params.get("error_description") ?? params.get("error") ?? "").toLowerCase();
      resolved = true;
      setState(desc.includes("expired") ? { kind: "expired" } : { kind: "invalid" });
      cleanRecoveryUrl();
    }

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled || resolved) return;
      if (data.session) {
        resolved = true;
        setState({ kind: "ready" });
      }
    });

    const timeout = setTimeout(() => {
      if (!cancelled && !resolved) setState({ kind: "invalid" });
    }, 2500);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      sub.subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Please choose a password with at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setError("We couldn't update your password. The reset link may have expired.");
        return;
      }
      // Sign out to force a fresh sign-in with the new password.
      await supabase.auth.signOut();
      cleanRecoveryUrl();
      setState({ kind: "done" });
      setTimeout(() => navigate({ to: "/auth", search: { mode: "signin" }, replace: true }), 1200);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="min-h-screen bg-background flex items-center justify-center p-6"
      style={{ fontFamily: "Poppins, sans-serif" }}
    >
      <div className="w-full max-w-md rounded-3xl bg-card p-8">
        <Link to="/" className="flex items-center gap-2 text-xl font-bold">
          <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-black">
            <div className="h-2.5 w-2.5 rounded-full bg-black" />
          </div>
          <span>
            Moz<span className="text-foreground">ok</span>
          </span>
        </Link>

        {state.kind === "checking" ? (
          <>
            <h1 className="mt-6 text-2xl font-bold">Verifying your link…</h1>
            <p className="mt-2 text-sm text-muted-foreground">One moment.</p>
          </>
        ) : state.kind === "expired" || state.kind === "invalid" ? (
          <>
            <h1 className="mt-6 text-2xl font-bold">
              {state.kind === "expired" ? "This reset link has expired" : "This reset link is invalid"}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Request a new reset email to continue.
            </p>
            <Link
              to="/auth"
              search={{ mode: "reset" }}
              className="mt-6 inline-flex w-full items-center justify-center rounded-full bg-foreground px-4 py-3 text-sm font-semibold text-primary-foreground hover:opacity-95"
            >
              Request a new link
            </Link>
          </>
        ) : state.kind === "done" ? (
          <>
            <h1 className="mt-6 text-2xl font-bold">Password updated</h1>
            <p className="mt-2 text-sm text-muted-foreground">Redirecting you to sign in…</p>
          </>
        ) : (
          <>
            <h1 className="mt-6 text-2xl font-bold">Set a new password</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Choose a password you haven't used before.
            </p>
            <form onSubmit={handleSubmit} className="mt-6 space-y-3" noValidate>
              <input
                type="password"
                required
                minLength={8}
                placeholder="New password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                className="w-full rounded-full border border-border px-4 py-3 text-sm outline-none focus:border-foreground"
              />
              <input
                type="password"
                required
                minLength={8}
                placeholder="Confirm new password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                className="w-full rounded-full border border-border px-4 py-3 text-sm outline-none focus:border-foreground"
              />
              {error ? (
                <p role="alert" className="rounded-2xl bg-secondary px-4 py-3 text-sm text-foreground">
                  {error}
                </p>
              ) : null}
              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-full bg-foreground px-4 py-3 text-sm font-semibold text-primary-foreground hover:opacity-95 disabled:opacity-50"
              >
                {submitting ? "Updating…" : "Update password"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

function cleanRecoveryUrl() {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    url.hash = "";
    window.history.replaceState({}, "", url.toString());
  } catch {
    // ignore
  }
}