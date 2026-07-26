/* @vitest-environment jsdom */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import React from "react";

const navigateSpy = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: any) => ({ options: config }),
  Link: ({ children, to, ...rest }: any) => (
    <a href={typeof to === "string" ? to : "#"} {...rest}>
      {children}
    </a>
  ),
  useNavigate: () => navigateSpy,
}));

let authListener: ((event: string) => void) | null = null;
const unsubscribe = vi.fn();
const onAuthStateChange = vi.fn((cb: (event: string) => void) => {
  authListener = cb;
  return { data: { subscription: { unsubscribe } } };
});
const getSession = vi.fn().mockResolvedValue({ data: { session: null } });
const updateUser = vi.fn();
const signOut = vi.fn().mockResolvedValue({ error: null });

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      onAuthStateChange: (...a: any[]) => onAuthStateChange(...a),
      getSession: (...a: any[]) => getSession(...a),
      updateUser: (...a: any[]) => updateUser(...a),
      signOut: (...a: any[]) => signOut(...a),
    },
  },
}));

import { Route as ResetRoute } from "@/routes/auth.reset";
const ResetPage = (ResetRoute.options as any).component as React.ComponentType;

beforeEach(() => {
  navigateSpy.mockReset();
  authListener = null;
  unsubscribe.mockReset();
  onAuthStateChange.mockClear();
  getSession.mockReset().mockResolvedValue({ data: { session: null } });
  updateUser.mockReset();
  signOut.mockReset().mockResolvedValue({ error: null });
  window.history.replaceState({}, "", "/auth/reset");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("auth.reset.tsx behavioral", () => {
  it("PASSWORD_RECOVERY event enables the password form", async () => {
    render(<ResetPage />);
    act(() => {
      authListener?.("PASSWORD_RECOVERY");
    });
    expect(await screen.findByRole("heading", { name: /set a new password/i })).toBeInTheDocument();
  });

  it("recovery timeout with no session shows invalid state", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<ResetPage />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.getByRole("heading", { name: /invalid|expired/i })).toBeInTheDocument();
  });

  it("existing session is treated as recovery (documented fallback)", async () => {
    // This is the intentional fallback: once supabase-js exchanges the hash,
    // a session exists even without a PASSWORD_RECOVERY event. Documented.
    getSession.mockResolvedValue({ data: { session: { access_token: "t" } } });
    render(<ResetPage />);
    expect(await screen.findByRole("heading", { name: /set a new password/i })).toBeInTheDocument();
  });

  it("mismatched passwords are rejected client-side", async () => {
    render(<ResetPage />);
    act(() => authListener?.("PASSWORD_RECOVERY"));
    await screen.findByRole("heading", { name: /set a new password/i });
    fireEvent.change(screen.getByPlaceholderText(/^new password$/i), {
      target: { value: "password123" },
    });
    fireEvent.change(screen.getByPlaceholderText(/confirm new password/i), {
      target: { value: "different1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /update password/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/don.t match/i);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("successful updateUser signs out and returns to sign-in", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    updateUser.mockResolvedValue({ error: null });
    render(<ResetPage />);
    act(() => authListener?.("PASSWORD_RECOVERY"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByRole("heading", { name: /set a new password/i })).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/^new password$/i), {
      target: { value: "password123" },
    });
    fireEvent.change(screen.getByPlaceholderText(/confirm new password/i), {
      target: { value: "password123" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /update password/i }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(signOut).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(navigateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ to: "/auth", search: { mode: "signin" }, replace: true }),
    );
  });

  it("update failure renders stable copy and remains retryable", async () => {
    updateUser.mockResolvedValue({ error: { message: "internal: token XYZ" } });
    render(<ResetPage />);
    act(() => authListener?.("PASSWORD_RECOVERY"));
    await screen.findByRole("heading", { name: /set a new password/i });
    fireEvent.change(screen.getByPlaceholderText(/^new password$/i), {
      target: { value: "password123" },
    });
    fireEvent.change(screen.getByPlaceholderText(/confirm new password/i), {
      target: { value: "password123" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /update password/i }));
    });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent ?? "").not.toMatch(/token xyz|internal/i);
    // Button is still available for retry.
    expect(screen.getByRole("button", { name: /update password/i })).not.toBeDisabled();
    expect(signOut).not.toHaveBeenCalled();
  });

  it("listener and timer cleanup occur on unmount", async () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    const { unmount } = render(<ResetPage />);
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(clearSpy).toHaveBeenCalled();
    // Advancing timers post-unmount must not trigger navigation or state work.
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(navigateSpy).not.toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});
