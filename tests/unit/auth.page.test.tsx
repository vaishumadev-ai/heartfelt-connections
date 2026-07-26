/* @vitest-environment jsdom */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import React from "react";

// ---------- Router mock (module-level config) ----------
let searchState: any = { next: undefined, mode: undefined };
const navigateSpy = vi.fn();
const routerInvalidateSpy = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: any) => ({
    useSearch: () => searchState,
    options: config,
  }),
  Link: ({ children, to, ...rest }: any) => (
    <a href={typeof to === "string" ? to : "#"} {...rest}>
      {children}
    </a>
  ),
  useNavigate: () => navigateSpy,
  useRouter: () => ({ invalidate: routerInvalidateSpy }),
}));

// ---------- Supabase auth mock ----------
const signUp = vi.fn();
const signInWithPassword = vi.fn();
const resetPasswordForEmail = vi.fn();
const resend = vi.fn();
const getSession = vi.fn().mockResolvedValue({ data: { session: null } });

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      signUp: (...a: any[]) => signUp(...a),
      signInWithPassword: (...a: any[]) => signInWithPassword(...a),
      resetPasswordForEmail: (...a: any[]) => resetPasswordForEmail(...a),
      resend: (...a: any[]) => resend(...a),
      getSession: (...a: any[]) => getSession(...a),
    },
  },
}));

const signInWithOAuth = vi.fn().mockResolvedValue({ redirected: true });
vi.mock("@/integrations/lovable/index", () => ({
  lovable: { auth: { signInWithOAuth: (...a: any[]) => signInWithOAuth(...a) } },
}));

import { Route as AuthRoute } from "@/routes/auth";

const AuthPage = (AuthRoute.options as any).component as React.ComponentType;

function renderPage() {
  return render(<AuthPage />);
}

beforeEach(() => {
  searchState = { next: undefined, mode: undefined };
  navigateSpy.mockReset();
  routerInvalidateSpy.mockReset();
  signUp.mockReset();
  signInWithPassword.mockReset();
  resetPasswordForEmail.mockReset();
  resend.mockReset();
  getSession.mockReset().mockResolvedValue({ data: { session: null } });
  signInWithOAuth.mockReset().mockResolvedValue({ redirected: true });
  window.history.replaceState({}, "", "/auth");
});

afterEach(() => {
  vi.useRealTimers();
});

async function fillAndSubmit(mode: "signup" | "signin" | "reset", opts: { email: string; password?: string }) {
  // Only toggle when the form isn't already in the desired mode.
  if (mode === "signup" && !screen.queryByRole("button", { name: /create account/i })) {
    fireEvent.click(screen.getByRole("button", { name: /sign up/i }));
  } else if (mode === "reset" && !screen.queryByRole("button", { name: /send reset link/i })) {
    fireEvent.click(screen.getByRole("button", { name: /forgot password/i }));
  }
  const email = screen.getByPlaceholderText(/email/i) as HTMLInputElement;
  fireEvent.change(email, { target: { value: opts.email } });
  if (mode !== "reset") {
    const pw = screen.getByPlaceholderText(/^password$/i) as HTMLInputElement;
    fireEvent.change(pw, { target: { value: opts.password ?? "" } });
  }
  const label = mode === "signup" ? /create account/i : mode === "signin" ? /^sign in$/i : /send reset link/i;
  fireEvent.click(screen.getByRole("button", { name: label }));
}

describe("auth.tsx behavioral", () => {
  it("signup returning session navigates once to validated next", async () => {
    searchState = { next: "/learn/foo", mode: "signup" };
    signUp.mockResolvedValue({ data: { session: { access_token: "t" }, user: { id: "u" } }, error: null });
    renderPage();
    await fillAndSubmit("signup", { email: "a@b.co", password: "password123" });
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledTimes(1));
    expect(navigateSpy).toHaveBeenCalledWith(expect.objectContaining({ to: "/learn/foo", replace: true }));
  });

  it("signup returning user + null session does not navigate, renders Check Your Email masked", async () => {
    searchState = { mode: "signup" };
    signUp.mockResolvedValue({ data: { session: null, user: { id: "u", identities: [{ id: "i" }] } }, error: null });
    renderPage();
    await fillAndSubmit("signup", { email: "georgestone@example.com", password: "password123" });
    expect(await screen.findByText(/check your email/i)).toBeInTheDocument();
    expect(navigateSpy).not.toHaveBeenCalled();
    // Masked email
    expect(screen.getByText(/ge•+@example\.com/)).toBeInTheDocument();
    expect(screen.queryByText(/georgestone@example\.com/)).not.toBeInTheDocument();
  });

  it("identity-less duplicate-email response shows the same safe confirmation state", async () => {
    searchState = { mode: "signup" };
    // Duplicate email path: Supabase returns user with empty identities.
    signUp.mockResolvedValue({ data: { session: null, user: { id: "u", identities: [] } }, error: null });
    renderPage();
    await fillAndSubmit("signup", { email: "dup@example.com", password: "password123" });
    expect(await screen.findByText(/check your email/i)).toBeInTheDocument();
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it("resend calls supabase.auth.resend exactly once and cooldown disables the button", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    searchState = { mode: "signup" };
    signUp.mockResolvedValue({ data: { session: null, user: { id: "u" } }, error: null });
    resend.mockResolvedValue({ error: null });
    renderPage();
    await act(async () => {
      await fillAndSubmit("signup", { email: "a@b.co", password: "password123" });
      await vi.advanceTimersByTimeAsync(0);
    });
    const resendBtn = screen.getByRole("button", { name: /resend in \d+s/i });
    // Cooldown active immediately after showing check-email screen.
    expect(resendBtn).toBeDisabled();
    // Advance past cooldown.
    for (let i = 0; i < 50; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
    }
    const enabled = screen.getByRole("button", { name: /resend email/i });
    expect(enabled).not.toBeDisabled();
    await act(async () => {
      fireEvent.click(enabled);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(resend).toHaveBeenCalledTimes(1);
    expect(resend).toHaveBeenCalledWith(expect.objectContaining({ type: "signup", email: "a@b.co" }));
  });

  it("Use a different email returns to the editable signup form", async () => {
    searchState = { mode: "signup" };
    signUp.mockResolvedValue({ data: { session: null, user: { id: "u" } }, error: null });
    renderPage();
    await fillAndSubmit("signup", { email: "a@b.co", password: "password123" });
    await screen.findByText(/check your email/i);
    fireEvent.click(screen.getByRole("button", { name: /use a different email/i }));
    await waitFor(() => expect(screen.getByPlaceholderText(/email/i)).toBeInTheDocument());
  });

  it("signup error renders stable copy, never raw provider text", async () => {
    searchState = { mode: "signup" };
    signUp.mockResolvedValue({
      data: { session: null, user: null },
      error: { message: "PGRST: some internal db chatter with tokens" },
    });
    renderPage();
    await fillAndSubmit("signup", { email: "a@b.co", password: "password123" });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent ?? "").not.toMatch(/pgrst|internal db chatter|token/i);
    expect(alert.textContent ?? "").toMatch(/try again|please/i);
  });

  it("existing authenticated session redirects without a loop", async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: "t" } } });
    searchState = { next: "/dashboard" };
    renderPage();
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledTimes(1));
    expect(navigateSpy).toHaveBeenCalledWith(expect.objectContaining({ to: "/dashboard", replace: true }));
  });

  it("reset request shows a non-enumerating sent state (no error even on unknown email)", async () => {
    // Simulate provider that would otherwise reveal existence — we still show the safe state.
    resetPasswordForEmail.mockResolvedValue({ error: null });
    renderPage();
    await fillAndSubmit("reset", { email: "unknown@example.com" });
    expect(await screen.findByText(/check your email/i)).toBeInTheDocument();
    // No "not found" / enumeration
    expect(screen.queryByText(/not found|no account|doesn.t exist/i)).not.toBeInTheDocument();
  });
});