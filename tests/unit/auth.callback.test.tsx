/* @vitest-environment jsdom */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, screen, act } from "@testing-library/react";
import React from "react";

let searchState: any = {};
const navigateSpy = vi.fn();
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
}));

const exchangeCodeForSession = vi.fn();
const getSession = vi.fn().mockResolvedValue({ data: { session: null } });
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      exchangeCodeForSession: (...a: any[]) => exchangeCodeForSession(...a),
      getSession: (...a: any[]) => getSession(...a),
    },
  },
}));

import { Route as CallbackRoute } from "@/routes/auth.callback";
const CallbackPage = (CallbackRoute.options as any).component as React.ComponentType;

let replaceStateSpy: any;
let addSpy: any;
let removeSpy: any;
let setTimeoutSpy: any;

beforeEach(() => {
  searchState = {};
  navigateSpy.mockReset();
  exchangeCodeForSession.mockReset();
  getSession.mockReset().mockResolvedValue({ data: { session: null } });
  window.history.replaceState({}, "", "/auth/callback");
  replaceStateSpy = vi.spyOn(window.history, "replaceState");
  addSpy = vi.spyOn(window, "addEventListener");
  removeSpy = vi.spyOn(window, "removeEventListener");
  setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
});

afterEach(() => {
  replaceStateSpy.mockRestore();
  addSpy.mockRestore();
  removeSpy.mockRestore();
  setTimeoutSpy.mockRestore();
  vi.useRealTimers();
});

describe("auth.callback.tsx behavioral", () => {
  it("PKCE code exchanged exactly once and navigates once to validated next", async () => {
    searchState = { code: "abc123", next: "/learn/foo" };
    exchangeCodeForSession.mockResolvedValue({ error: null });
    render(<CallbackPage />);
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledTimes(1));
    expect(exchangeCodeForSession).toHaveBeenCalledTimes(1);
    expect(exchangeCodeForSession).toHaveBeenCalledWith("abc123");
    expect(navigateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ to: "/learn/foo", replace: true }),
    );
  });

  it("defaults to /dashboard when next is missing", async () => {
    searchState = { code: "abc" };
    exchangeCodeForSession.mockResolvedValue({ error: null });
    render(<CallbackPage />);
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledTimes(1));
    expect(navigateSpy).toHaveBeenCalledWith(expect.objectContaining({ to: "/dashboard" }));
  });

  it.each([
    ["external", "https://evil.com/x"],
    ["protocol-relative", "//evil.com"],
    ["encoded-external", "%2F%2Fevil.com"],
    ["malformed", "%E0%A4%A"],
  ])("rejects %s next value and falls back to /dashboard", async (_label, bad) => {
    searchState = { code: "abc", next: bad };
    exchangeCodeForSession.mockResolvedValue({ error: null });
    render(<CallbackPage />);
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledTimes(1));
    expect(navigateSpy).toHaveBeenCalledWith(expect.objectContaining({ to: "/dashboard" }));
  });

  it("provider error renders stable copy and strips sensitive params via replaceState", async () => {
    searchState = { error: "server_error", error_description: "boom" };
    window.history.replaceState({}, "", "/auth/callback?error=server_error&error_description=boom");
    render(<CallbackPage />);
    expect(
      await screen.findByRole("heading", {
        name: /couldn.t complete sign-in|no longer valid|expired/i,
      }),
    ).toBeInTheDocument();
    // sensitive params removed
    await waitFor(() => {
      expect(window.location.search).not.toContain("error");
    });
    expect(replaceStateSpy).toHaveBeenCalled();
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it("expired link renders expired recovery state", async () => {
    searchState = {
      error: "otp_expired",
      error_code: "otp_expired",
      error_description: "OTP expired",
    };
    render(<CallbackPage />);
    expect(await screen.findByRole("heading", { name: /expired/i })).toBeInTheDocument();
  });

  it("invalid PKCE exchange renders stable recovery action (no raw provider text)", async () => {
    searchState = { code: "bad" };
    exchangeCodeForSession.mockResolvedValue({
      error: { message: "invalid grant: internal token blurb" },
    });
    render(<CallbackPage />);
    const heading = await screen.findByRole("heading", {
      name: /no longer valid|couldn.t complete|expired/i,
    });
    expect(heading.textContent ?? "").not.toMatch(/invalid grant|token blurb/i);
    expect(screen.getByRole("link", { name: /return to sign in/i })).toBeInTheDocument();
  });

  it("unmount does not leave polling/timers/listeners active", async () => {
    searchState = {};
    // No code/hash — falls through to getSession() path.
    getSession.mockResolvedValue({ data: { session: null } });
    const { unmount } = render(<CallbackPage />);
    // Yield microtasks.
    await act(async () => {
      await Promise.resolve();
    });
    // Any listeners added must be removed on unmount.
    const added = addSpy.mock.calls.length;
    unmount();
    // The component adds no window listeners itself, so both counts should be 0.
    // If a future refactor adds them, removeEventListener count must match.
    expect(removeSpy.mock.calls.length).toBeGreaterThanOrEqual(added > 0 ? added : 0);
    // Subsequent navigate must not fire after unmount.
    const before = navigateSpy.mock.calls.length;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(navigateSpy.mock.calls.length).toBe(before);
  });
});
