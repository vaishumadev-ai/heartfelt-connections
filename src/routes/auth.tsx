import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { toast } from "sonner";
import { safeNextPath, maskEmail, DEFAULT_NEXT } from "@/lib/auth-redirect";

const searchSchema = z.object({
  next: z.string().optional(),
  mode: z.enum(["signin", "signup", "reset"]).optional(),
});

export const Route = createFileRoute("/auth")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Sign in — Mozok" },
      { name: "description", content: "Sign in or create your Mozok account to start learning." },
      { property: "og:title", content: "Sign in — Mozok" },
      { property: "og:description", content: "Sign in or create your Mozok account to start learning." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthPage,
});

type UiState =
  | { kind: "form" }
  | { kind: "check_email"; email: string }
  | { kind: "reset_sent"; email: string };

// Stable, non-enumerating error copy.
const GENERIC_ERROR = "Something went wrong. Please try again.";
const INVALID_CREDS = "Those sign-in details didn't match. Please try again.";
const RATE_LIMITED = "Too many attempts. Please wait a moment and try again.";
const WEAK_PASSWORD = "Please choose a password with at least 8 characters.";

function classifyAuthError(msg: string | undefined): string {
  const m = (msg ?? "").toLowerCase();
  if (!m) return GENERIC_ERROR;
  if (m.includes("rate") || m.includes("too many")) return RATE_LIMITED;
  if (m.includes("invalid") && (m.includes("credential") || m.includes("login") || m.includes("password"))) {
    return INVALID_CREDS;
  }
  if (m.includes("password")) return WEAK_PASSWORD;
  return GENERIC_ERROR;
}

const RESEND_COOLDOWN_SECONDS = 45;

function AuthPage() {
  const navigate = useNavigate();
  const router = useRouter();
  const search = Route.useSearch();
  const nextPath = safeNextPath(search.next ?? null, DEFAULT_NEXT);
  const initialMode: "signin" | "signup" | "reset" = search.mode ?? "signin";

  const [mode, setMode] = useState<"signin" | "signup" | "reset">(initialMode);
  const [ui, setUi] = useState<UiState>({ kind: "form" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  // If already signed in, bounce forward. Uses getSession (fast) — the auth
  // gate on the destination will re-validate.
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled && data.session) {
        navigate({ to: nextPath as "/dashboard", replace: true });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [navigate, nextPath]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  function callbackRedirect() {
    return `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`;
  }

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === "signup") {
        if (password.length < 8) {
          setError(WEAK_PASSWORD);
          return;
        }
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: callbackRedirect(),
            data: { display_name: name || email.split("@")[0] },
          },
        });
        if (error) {
          setError(classifyAuthError(error.message));
          return;
        }
        // If confirmation is required, session is null. Never navigate.
        if (data.session) {
          router.invalidate();
          navigate({ to: nextPath as "/dashboard", replace: true });
        } else {
          // Also covers the "already registered" duplicate-email path: Supabase
          // returns a user with no identities and no session — we still show
          // Check Your Email to avoid account enumeration.
          setUi({ kind: "check_email", email });
          setCooldown(RESEND_COOLDOWN_SECONDS);
        }
      } else if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          setError(classifyAuthError(error.message));
          return;
        }
        toast.success("Welcome back!");
        router.invalidate();
        navigate({ to: nextPath as "/dashboard", replace: true });
      } else {
        // reset request
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth/reset`,
        });
        // Do not reveal whether the address exists.
        if (error && /rate|too many/i.test(error.message)) {
          setError(RATE_LIMITED);
          return;
        }
        setUi({ kind: "reset_sent", email });
        setCooldown(RESEND_COOLDOWN_SECONDS);
      }
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    if (cooldown > 0 || ui.kind === "form") return;
    setLoading(true);
    setError(null);
    try {
      if (ui.kind === "check_email") {
        const { error } = await supabase.auth.resend({
          type: "signup",
          email: ui.email,
          options: { emailRedirectTo: callbackRedirect() },
        });
        if (error && /rate|too many/i.test(error.message)) {
          setError(RATE_LIMITED);
        } else {
          toast.success("Confirmation email sent.");
        }
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(ui.email, {
          redirectTo: `${window.location.origin}/auth/reset`,
        });
        if (error && /rate|too many/i.test(error.message)) {
          setError(RATE_LIMITED);
        } else {
          toast.success("Reset link sent.");
        }
      }
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setError(null);
    setLoading(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`,
    });
    if (result.error) {
      setError(GENERIC_ERROR);
      setLoading(false);
      return;
    }
    if (result.redirected) return;
    // Popup flow: session set by wrapper. Let the callback route not needed;
    // navigate directly.
    router.invalidate();
    navigate({ to: nextPath as "/dashboard", replace: true });
  }

  if (ui.kind === "check_email" || ui.kind === "reset_sent") {
    const isSignup = ui.kind === "check_email";
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
          <h1 className="mt-6 text-2xl font-bold">Check your email</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {isSignup
              ? "We sent a confirmation link to"
              : "If an account exists for"}{" "}
            <span className="font-medium text-foreground">{maskEmail(ui.email)}</span>
            {isSignup ? ". Click the link to activate your account." : ", we sent a reset link."}
          </p>
          {error ? (
            <p role="alert" className="mt-4 rounded-2xl bg-secondary px-4 py-3 text-sm text-foreground">
              {error}
            </p>
          ) : null}
          <div className="mt-6 space-y-3">
            <button
              type="button"
              onClick={handleResend}
              disabled={loading || cooldown > 0}
              className="w-full rounded-full border border-border bg-card px-4 py-3 text-sm font-semibold hover:bg-background disabled:opacity-50"
            >
              {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend email"}
            </button>
            <button
              type="button"
              onClick={() => {
                setUi({ kind: "form" });
                setError(null);
                setPassword("");
              }}
              className="w-full rounded-full bg-foreground px-4 py-3 text-sm font-semibold text-primary-foreground hover:opacity-95"
            >
              Use a different email
            </button>
            <button
              type="button"
              onClick={() => {
                setUi({ kind: "form" });
                setMode("signin");
                setError(null);
              }}
              className="w-full text-center text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              Return to sign in
            </button>
          </div>
        </div>
      </div>
    );
  }

  const title =
    mode === "signin" ? "Welcome back" : mode === "signup" ? "Create your account" : "Reset your password";
  const subtitle =
    mode === "signin"
      ? "Sign in to continue learning."
      : mode === "signup"
        ? "Start learning something new today."
        : "We'll email you a secure link to set a new password.";

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

        <h1 className="mt-6 text-2xl font-bold">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>

        {mode !== "reset" ? (
          <>
            <button
              type="button"
              onClick={handleGoogle}
              disabled={loading}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-full border border-border bg-card px-4 py-3 text-sm font-medium hover:bg-background disabled:opacity-50"
            >
              <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.4 29.3 35.5 24 35.5c-6.4 0-11.5-5.1-11.5-11.5S17.6 12.5 24 12.5c2.9 0 5.6 1.1 7.6 2.9l5.7-5.7C33.9 6.5 29.2 4.5 24 4.5 13.2 4.5 4.5 13.2 4.5 24S13.2 43.5 24 43.5 43.5 34.8 43.5 24c0-1.2-.1-2.4-.4-3.5z" />
                <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.7 18.9 12.5 24 12.5c2.9 0 5.6 1.1 7.6 2.9l5.7-5.7C33.9 6.5 29.2 4.5 24 4.5 16.3 4.5 9.7 8.7 6.3 14.7z" />
                <path fill="#4CAF50" d="M24 43.5c5.1 0 9.8-2 13.3-5.2l-6.2-5.2c-2 1.4-4.5 2.3-7.2 2.3-5.3 0-9.7-3.1-11.3-7.5l-6.5 5C9.6 39.3 16.2 43.5 24 43.5z" />
                <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.9 2.5-2.5 4.5-4.7 5.9l6.2 5.2c-.4.4 6.7-4.9 6.7-15.1 0-1.2-.1-2.4-.4-3.5z" />
              </svg>
              Continue with Google
            </button>

            <div className="mt-6 flex items-center gap-3 text-xs text-muted-foreground">
              <div className="h-px flex-1 bg-secondary" />
              or
              <div className="h-px flex-1 bg-secondary" />
            </div>
          </>
        ) : null}

        <form onSubmit={handleEmail} className="mt-6 space-y-3" noValidate>
          {mode === "signup" && (
            <input
              type="text"
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              className="w-full rounded-full border border-border px-4 py-3 text-sm outline-none focus:border-foreground"
            />
          )}
          <input
            type="email"
            required
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            className="w-full rounded-full border border-border px-4 py-3 text-sm outline-none focus:border-foreground"
          />
          {mode !== "reset" && (
            <input
              type="password"
              required
              minLength={mode === "signup" ? 8 : 1}
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              className="w-full rounded-full border border-border px-4 py-3 text-sm outline-none focus:border-foreground"
            />
          )}
          {mode === "signin" ? (
            <div className="pt-1 text-right">
              <button
                type="button"
                onClick={() => {
                  setMode("reset");
                  setError(null);
                }}
                className="text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                Forgot password?
              </button>
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="rounded-2xl bg-secondary px-4 py-3 text-sm text-foreground">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-full bg-foreground px-4 py-3 text-sm font-semibold text-primary-foreground hover:opacity-95 disabled:opacity-50"
          >
            {loading
              ? "Please wait..."
              : mode === "signin"
                ? "Sign in"
                : mode === "signup"
                  ? "Create account"
                  : "Send reset link"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          {mode === "reset" ? (
            <>
              Remembered it?{" "}
              <button
                type="button"
                onClick={() => {
                  setMode("signin");
                  setError(null);
                }}
                className="font-semibold text-foreground"
              >
                Sign in
              </button>
            </>
          ) : mode === "signin" ? (
            <>
              Don&apos;t have an account?{" "}
              <button
                type="button"
                onClick={() => {
                  setMode("signup");
                  setError(null);
                }}
                className="font-semibold text-foreground"
              >
                Sign up
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button
                type="button"
                onClick={() => {
                  setMode("signin");
                  setError(null);
                }}
                className="font-semibold text-foreground"
              >
                Sign in
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}