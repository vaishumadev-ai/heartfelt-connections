import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
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

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard" });
    });
  }, [navigate]);

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/dashboard`,
            data: { display_name: name || email.split("@")[0] },
          },
        });
        if (error) throw error;
        toast.success("Account created! Check your email to confirm.");
        navigate({ to: "/dashboard" });
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Welcome back!");
        navigate({ to: "/dashboard" });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setLoading(true);
    const result = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin });
    if (result.error) {
      toast.error(result.error.message ?? "Google sign-in failed");
      setLoading(false);
      return;
    }
    if (result.redirected) return;
    navigate({ to: "/dashboard" });
  }

  return (
    <div className="min-h-screen bg-[#f5f5f5] flex items-center justify-center p-6" style={{ fontFamily: "'Poppins', sans-serif" }}>
      <div className="w-full max-w-md rounded-3xl bg-white p-8">
        <Link to="/" className="flex items-center gap-2 text-xl font-bold">
          <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-black">
            <div className="h-2.5 w-2.5 rounded-full bg-black" />
          </div>
          <span>Moz<span className="text-[#ff5a6a]">ok</span></span>
        </Link>

        <h1 className="mt-6 text-2xl font-bold">
          {mode === "signin" ? "Welcome back" : "Create your account"}
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          {mode === "signin" ? "Sign in to continue learning." : "Start learning something new today."}
        </p>

        <button
          type="button"
          onClick={handleGoogle}
          disabled={loading}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-3 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
        >
          <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.4 29.3 35.5 24 35.5c-6.4 0-11.5-5.1-11.5-11.5S17.6 12.5 24 12.5c2.9 0 5.6 1.1 7.6 2.9l5.7-5.7C33.9 6.5 29.2 4.5 24 4.5 13.2 4.5 4.5 13.2 4.5 24S13.2 43.5 24 43.5 43.5 34.8 43.5 24c0-1.2-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.7 18.9 12.5 24 12.5c2.9 0 5.6 1.1 7.6 2.9l5.7-5.7C33.9 6.5 29.2 4.5 24 4.5 16.3 4.5 9.7 8.7 6.3 14.7z"/><path fill="#4CAF50" d="M24 43.5c5.1 0 9.8-2 13.3-5.2l-6.2-5.2c-2 1.4-4.5 2.3-7.2 2.3-5.3 0-9.7-3.1-11.3-7.5l-6.5 5C9.6 39.3 16.2 43.5 24 43.5z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.9 2.5-2.5 4.5-4.7 5.9l6.2 5.2c-.4.4 6.7-4.9 6.7-15.1 0-1.2-.1-2.4-.4-3.5z"/></svg>
          Continue with Google
        </button>

        <div className="mt-6 flex items-center gap-3 text-xs text-gray-400">
          <div className="h-px flex-1 bg-gray-200" />or<div className="h-px flex-1 bg-gray-200" />
        </div>

        <form onSubmit={handleEmail} className="mt-6 space-y-3">
          {mode === "signup" && (
            <input
              type="text"
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-full border border-gray-200 px-4 py-3 text-sm outline-none focus:border-[#ff5a6a]"
            />
          )}
          <input
            type="email"
            required
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-full border border-gray-200 px-4 py-3 text-sm outline-none focus:border-[#ff5a6a]"
          />
          <input
            type="password"
            required
            minLength={6}
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-full border border-gray-200 px-4 py-3 text-sm outline-none focus:border-[#ff5a6a]"
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-full bg-[#ff5a6a] px-4 py-3 text-sm font-semibold text-white/30 hover:opacity-95 disabled:opacity-50"
          >
            {loading ? "Please wait..." : mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-gray-500">
          {mode === "signin" ? "Don't have an account?" : "Already have an account?"}{" "}
          <button
            type="button"
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
            className="font-semibold text-[#ff5a6a]"
          >
            {mode === "signin" ? "Sign up" : "Sign in"}
          </button>
        </p>
      </div>
    </div>
  );
}