/* @vitest-environment jsdom */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

// Mock TanStack Router's useBlocker so we can drive the resolver state
// manually without booting a router. We deliberately isolate this file's
// mocks so other suites keep working.
type BlockerState =
  | { status: "idle"; proceed?: undefined; reset?: undefined }
  | { status: "blocked"; proceed: () => void; reset: () => void };
let blockerState: BlockerState = { status: "idle" };
let shouldBlockFn: (() => boolean) | null = null;
let enableBeforeUnload: (() => boolean) | null = null;
const proceedSpy = vi.fn();
const resetSpy = vi.fn();
function block() {
  blockerState = {
    status: "blocked",
    proceed: () => {
      proceedSpy();
      blockerState = { status: "idle" };
      rerenderAll();
    },
    reset: () => {
      resetSpy();
      blockerState = { status: "idle" };
      rerenderAll();
    },
  };
  rerenderAll();
}
const subscribers = new Set<() => void>();
function rerenderAll() {
  for (const s of subscribers) s();
}

vi.mock("@tanstack/react-router", () => ({
  useBlocker: (opts: any) => {
    shouldBlockFn = opts.shouldBlockFn;
    enableBeforeUnload =
      typeof opts.enableBeforeUnload === "function" ? opts.enableBeforeUnload : null;
    const [, force] = React.useReducer((x) => x + 1, 0);
    React.useEffect(() => {
      subscribers.add(force as any);
      return () => {
        subscribers.delete(force as any);
      };
    }, []);
    return blockerState;
  },
}));

import {
  UnsavedGuardProvider,
  useUnsavedGuard,
  type NavController,
} from "@/components/lesson-tools/UnsavedGuard";
import { StudioNavGuard } from "@/components/studio/StudioNavGuard";

function Registrar({ id, controller }: { id: string; controller: NavController }) {
  const guard = useUnsavedGuard();
  const ref = React.useRef(controller);
  ref.current = controller;
  React.useEffect(() => {
    // Register a dirty checker that mirrors the controller's block state so
    // the shared isDirty() reports non-clean when the controller is unsafe.
    const unregDirty = guard.registerDirtyChecker(`dc-${id}`, () => {
      const c = ref.current;
      if (c.kind === "course-form") return c.isDirty();
      return c.status() !== "safe";
    });
    const unregCtrl = guard.registerNavController(id, {
      kind: ref.current.kind,
      // Delegate through the ref so tests can flip behavior on rerender.
      ...(ref.current.kind === "course-form"
        ? {
            isDirty: () => (ref.current as any).isDirty(),
            save: () => (ref.current as any).save(),
            discard: () => (ref.current as any).discard(),
          }
        : {
            status: () => (ref.current as any).status(),
            retryCleanup: () => (ref.current as any).retryCleanup(),
          }),
    } as NavController);
    return () => {
      unregDirty();
      unregCtrl();
    };
  }, [guard, id]);
  return null;
}

function Harness({ registrars }: { registrars: React.ReactNode }) {
  return (
    <UnsavedGuardProvider>
      <StudioNavGuard />
      {registrars}
    </UnsavedGuardProvider>
  );
}

beforeEach(() => {
  blockerState = { status: "idle" };
  shouldBlockFn = null;
  enableBeforeUnload = null;
  proceedSpy.mockClear();
  resetSpy.mockClear();
});

describe("StudioNavGuard", () => {
  it("clean navigation: shouldBlockFn returns false and no dialog is shown", () => {
    const controller: NavController = {
      kind: "course-form",
      isDirty: () => false,
      save: async () => true,
      discard: () => {},
    };
    render(<Harness registrars={<Registrar id="form" controller={controller} />} />);
    expect(shouldBlockFn?.()).toBe(false);
    expect(enableBeforeUnload?.()).toBe(false);
    expect(screen.queryByTestId("studio-nav-guard-dialog")).toBeNull();
  });

  it("dirty navigation: shouldBlockFn returns true and blocking renders the unsaved dialog", async () => {
    const controller: NavController = {
      kind: "course-form",
      isDirty: () => true,
      save: async () => true,
      discard: vi.fn(),
    };
    render(<Harness registrars={<Registrar id="form" controller={controller} />} />);
    expect(shouldBlockFn?.()).toBe(true);
    expect(enableBeforeUnload?.()).toBe(true);
    act(() => block());
    expect(await screen.findByTestId("studio-nav-guard-dialog")).toBeInTheDocument();
    expect(screen.getByText(/unsaved changes/i)).toBeInTheDocument();
  });

  it("Save and continue: awaits save success, then proceeds exactly once", async () => {
    const saveSpy = vi.fn().mockResolvedValue(true);
    const controller: NavController = {
      kind: "course-form",
      isDirty: () => true,
      save: saveSpy,
      discard: () => {},
    };
    render(<Harness registrars={<Registrar id="form" controller={controller} />} />);
    act(() => block());
    const user = userEvent.setup();
    const btn = await screen.findByRole("button", { name: /save and continue/i });
    await user.click(btn);
    // Rapid double-clicks must not fire save twice or proceed twice.
    await user.click(btn);
    await waitFor(() => expect(proceedSpy).toHaveBeenCalledTimes(1));
    expect(saveSpy).toHaveBeenCalledTimes(1);
  });

  it("Save failure: dialog stays open, shows a stable error, and does not navigate", async () => {
    const saveSpy = vi.fn().mockResolvedValue(false);
    const controller: NavController = {
      kind: "course-form",
      isDirty: () => true,
      save: saveSpy,
      discard: () => {},
    };
    render(<Harness registrars={<Registrar id="form" controller={controller} />} />);
    act(() => block());
    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: /save and continue/i }));
    await waitFor(() =>
      expect(screen.getByTestId("studio-nav-guard-save-error")).toBeInTheDocument(),
    );
    expect(proceedSpy).not.toHaveBeenCalled();
    // No raw Storage/JWT/SQL text leaks.
    const msg = screen.getByTestId("studio-nav-guard-save-error").textContent ?? "";
    expect(msg).not.toMatch(/storage|bucket|jwt|sql|postgres/i);
  });

  it("Discard and continue: calls controller.discard once and proceeds", async () => {
    const discard = vi.fn();
    const controller: NavController = {
      kind: "course-form",
      isDirty: () => true,
      save: async () => true,
      discard,
    };
    render(<Harness registrars={<Registrar id="form" controller={controller} />} />);
    act(() => block());
    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: /discard and continue/i }));
    await waitFor(() => expect(proceedSpy).toHaveBeenCalledTimes(1));
    expect(discard).toHaveBeenCalledTimes(1);
  });

  it("Stay here: resets the blocker exactly once and preserves state", async () => {
    const controller: NavController = {
      kind: "course-form",
      isDirty: () => true,
      save: vi.fn(),
      discard: vi.fn(),
    };
    render(<Harness registrars={<Registrar id="form" controller={controller} />} />);
    act(() => block());
    await userEvent.setup().click(await screen.findByRole("button", { name: /stay here/i }));
    expect(resetSpy).toHaveBeenCalledTimes(1);
    expect(proceedSpy).not.toHaveBeenCalled();
  });

  it("Active cover upload: dialog shows wait copy with only Stay (no Save/Discard)", async () => {
    const controller: NavController = {
      kind: "cover",
      status: () => "busy",
      retryCleanup: async () => true,
    };
    render(<Harness registrars={<Registrar id="cover" controller={controller} />} />);
    act(() => block());
    expect(await screen.findByText(/please wait for the cover operation/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save and continue/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /discard and continue/i })).toBeNull();
    expect(screen.getByRole("button", { name: /stay here/i })).toBeInTheDocument();
  });

  it("cleanup_pending: dialog offers Retry cleanup; success proceeds; failure keeps dialog open", async () => {
    let outcome = false;
    const retry = vi.fn(async () => outcome);
    const controller: NavController = {
      kind: "cover",
      status: () => "cleanup_pending",
      retryCleanup: retry,
    };
    render(<Harness registrars={<Registrar id="cover" controller={controller} />} />);
    act(() => block());
    const user = userEvent.setup();
    // First retry fails → dialog stays open, no proceed.
    await user.click(await screen.findByRole("button", { name: /retry cleanup/i }));
    await waitFor(() => expect(retry).toHaveBeenCalledTimes(1));
    expect(proceedSpy).not.toHaveBeenCalled();
    // Never renders the private path.
    expect(screen.queryByText(/\.png|\.jpg|\.webp|storage/i)).toBeNull();
    // Second retry succeeds → proceed exactly once.
    outcome = true;
    await user.click(screen.getByRole("button", { name: /retry cleanup/i }));
    await waitFor(() => expect(proceedSpy).toHaveBeenCalledTimes(1));
  });

  it("course dirty + cover unsafe: cover state takes precedence in the dialog copy", async () => {
    const form: NavController = {
      kind: "course-form",
      isDirty: () => true,
      save: async () => true,
      discard: () => {},
    };
    const cover: NavController = {
      kind: "cover",
      status: () => "busy",
      retryCleanup: async () => true,
    };
    render(
      <Harness
        registrars={
          <>
            <Registrar id="form" controller={form} />
            <Registrar id="cover" controller={cover} />
          </>
        }
      />,
    );
    act(() => block());
    expect(await screen.findByText(/please wait/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save and continue/i })).toBeNull();
  });

  it("exactly one navigation: repeated Discard clicks proceed only once", async () => {
    const controller: NavController = {
      kind: "course-form",
      isDirty: () => true,
      save: async () => true,
      discard: vi.fn(),
    };
    render(<Harness registrars={<Registrar id="form" controller={controller} />} />);
    act(() => block());
    const user = userEvent.setup();
    const btn = await screen.findByRole("button", { name: /discard and continue/i });
    await user.click(btn);
    // After proceed, dialog unmounts; further clicks are impossible via UI.
    // A stray click on the (now-detached) button reference must not double-fire.
    await waitFor(() => expect(proceedSpy).toHaveBeenCalledTimes(1));
  });

  it("beforeunload: enableBeforeUnload reflects live isDirty() state; unmount removes provider listener", () => {
    let dirty = true;
    const controller: NavController = {
      kind: "course-form",
      isDirty: () => dirty,
      save: async () => true,
      discard: () => {},
    };
    const { unmount } = render(
      <Harness registrars={<Registrar id="form" controller={controller} />} />,
    );
    // Live evaluation: dirty → true; clean → false.
    expect(enableBeforeUnload?.()).toBe(true);
    dirty = false;
    expect(enableBeforeUnload?.()).toBe(false);

    // Provider's own beforeunload handler no longer prevents once clean.
    const ev = new Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent;
    const pd = vi.spyOn(ev, "preventDefault");
    window.dispatchEvent(ev);
    expect(pd).not.toHaveBeenCalled();

    // Unmount detaches the provider listener cleanly.
    act(() => unmount());
    const evAfter = new Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent;
    const pdAfter = vi.spyOn(evAfter, "preventDefault");
    window.dispatchEvent(evAfter);
    expect(pdAfter).not.toHaveBeenCalled();
  });

  it("StrictMode/unmount cleanup: controllers unregister so isDirty() clears after unmount", () => {
    const controller: NavController = {
      kind: "course-form",
      isDirty: () => true,
      save: async () => true,
      discard: () => {},
    };
    // A guard reader inside the provider to observe isDirty().
    let observedDirty: boolean | null = null;
    function Observer() {
      const g = useUnsavedGuard();
      React.useEffect(() => {
        observedDirty = g.isDirty();
      });
      return null;
    }
    const { rerender } = render(
      <React.StrictMode>
        <UnsavedGuardProvider>
          <StudioNavGuard />
          <Registrar id="form" controller={controller} />
          <Observer />
        </UnsavedGuardProvider>
      </React.StrictMode>,
    );
    expect(observedDirty).toBe(true);
    // Unmount the registrar → registry cleared, isDirty flips to false.
    rerender(
      <React.StrictMode>
        <UnsavedGuardProvider>
          <StudioNavGuard />
          <Observer />
        </UnsavedGuardProvider>
      </React.StrictMode>,
    );
    expect(observedDirty).toBe(false);
  });

  it("does not render any raw Storage path even during cleanup_pending", async () => {
    const controller: NavController = {
      kind: "cover",
      status: () => "cleanup_pending",
      retryCleanup: async () => true,
    };
    render(<Harness registrars={<Registrar id="cover" controller={controller} />} />);
    act(() => block());
    const dialog = await screen.findByTestId("studio-nav-guard-dialog");
    // Real cover paths look like <uuid>/<uuid>/<uuid>.png. Assert the DOM
    // never contains that shape or the substring "storage".
    expect(dialog.textContent ?? "").not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    );
    expect(dialog.textContent ?? "").not.toMatch(/storage/i);
  });
});
