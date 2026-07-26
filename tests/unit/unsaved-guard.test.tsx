/* @vitest-environment jsdom */
import { describe, it, expect, vi } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { UnsavedGuardProvider, useUnsavedGuard } from "@/components/lesson-tools/UnsavedGuard";

function Harness({
  dirty,
  onAction,
  mountChild = true,
}: {
  dirty: boolean;
  onAction: () => void;
  mountChild?: boolean;
}) {
  return (
    <UnsavedGuardProvider>
      {mountChild ? <DirtyRegistrar dirty={dirty} /> : null}
      <Trigger onAction={onAction} />
    </UnsavedGuardProvider>
  );
}

function DirtyRegistrar({ dirty }: { dirty: boolean }) {
  const { registerDirtyChecker } = useUnsavedGuard();
  const ref = React.useRef(dirty);
  ref.current = dirty;
  React.useEffect(() => registerDirtyChecker("t", () => ref.current), [registerDirtyChecker]);
  return null;
}

function Trigger({ onAction }: { onAction: () => void }) {
  const { guard } = useUnsavedGuard();
  return (
    <button type="button" onClick={() => guard(onAction)}>
      go
    </button>
  );
}

describe("UnsavedGuard", () => {
  it("multiple sources: any dirty source blocks; clearing one but not the other still blocks", async () => {
    const action = vi.fn();
    function TwoSources({ a, b }: { a: boolean; b: boolean }) {
      return (
        <UnsavedGuardProvider>
          <DirtyRegistrarNamed id="a" dirty={a} />
          <DirtyRegistrarNamed id="b" dirty={b} />
          <Trigger onAction={action} />
        </UnsavedGuardProvider>
      );
    }
    function DirtyRegistrarNamed({ id, dirty }: { id: string; dirty: boolean }) {
      const { registerDirtyChecker } = useUnsavedGuard();
      const r = React.useRef(dirty);
      r.current = dirty;
      React.useEffect(
        () => registerDirtyChecker(id, () => r.current),
        [registerDirtyChecker, id],
      );
      return null;
    }
    const { rerender } = render(<TwoSources a={true} b={true} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "go" }));
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /stay/i }));

    // Clear only source A → still dirty via B → still prompts.
    rerender(<TwoSources a={false} b={true} />);
    await user.click(screen.getByRole("button", { name: "go" }));
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /stay/i }));

    // Clear both → runs immediately.
    rerender(<TwoSources a={false} b={false} />);
    await user.click(screen.getByRole("button", { name: "go" }));
    expect(action).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("StrictMode double-invoke leaves exactly one live registration per source", async () => {
    // React StrictMode intentionally invokes effect setup/teardown twice in
    // development. The registry must survive this without leaking a stale
    // checker: after the unmount+remount cycle only one live entry exists,
    // so clearing the sole visible source clears the guard.
    const action = vi.fn();
    function DirtyOnce({ dirty }: { dirty: boolean }) {
      const { registerDirtyChecker } = useUnsavedGuard();
      const r = React.useRef(dirty);
      r.current = dirty;
      React.useEffect(
        () => registerDirtyChecker("once", () => r.current),
        [registerDirtyChecker],
      );
      return null;
    }
    const { rerender } = render(
      <React.StrictMode>
        <UnsavedGuardProvider>
          <DirtyOnce dirty={true} />
          <Trigger onAction={action} />
        </UnsavedGuardProvider>
      </React.StrictMode>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "go" }));
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /stay/i }));

    // Flip to clean — if StrictMode's throw-away setup had left a duplicate
    // registration behind, this would still prompt.
    rerender(
      <React.StrictMode>
        <UnsavedGuardProvider>
          <DirtyOnce dirty={false} />
          <Trigger onAction={action} />
        </UnsavedGuardProvider>
      </React.StrictMode>,
    );
    await user.click(screen.getByRole("button", { name: "go" }));
    expect(action).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("clean state: guard runs action immediately; no dialog", async () => {
    const action = vi.fn();
    render(<Harness dirty={false} onAction={action} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "go" }));
    expect(action).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("dirty: prompts, discard runs action once and closes without dialog loop", async () => {
    const action = vi.fn();
    render(<Harness dirty={true} onAction={action} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "go" }));
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(action).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /discard and navigate/i }));
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("unregisters dirty checker on unmount; beforeunload attaches while dirty, detaches when clean/unmounted", async () => {
    const action = vi.fn();
    const { rerender, unmount } = render(<Harness dirty={true} onAction={action} />);

    // beforeunload while dirty: preventDefault is invoked (browsers use this
    // as the signal to show the leave-page confirmation).
    const evDirty = new Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent;
    const preventDefault = vi.spyOn(evDirty, "preventDefault");
    window.dispatchEvent(evDirty);
    expect(preventDefault).toHaveBeenCalled();

    // Unmount the dirty registrar → guard now considers state clean.
    rerender(<Harness dirty={true} onAction={action} mountChild={false} />);
    const evClean = new Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent;
    const pd2 = vi.spyOn(evClean, "preventDefault");
    window.dispatchEvent(evClean);
    expect(pd2).not.toHaveBeenCalled();

    // Clean state: guard executes action immediately (no dialog loop).
    await userEvent.setup().click(screen.getByRole("button", { name: "go" }));
    expect(action).toHaveBeenCalledTimes(1);

    // Full unmount detaches handler cleanly.
    act(() => unmount());
    const evAfter = new Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent;
    const pd3 = vi.spyOn(evAfter, "preventDefault");
    window.dispatchEvent(evAfter);
    expect(pd3).not.toHaveBeenCalled();
  });

  it("registry entry is removed on unmount, independently of beforeunload listener removal", async () => {
    // Directly assert the registry cleanup contract: after unmounting the
    // dirty registrar, guard(action) runs synchronously (no dialog), proving
    // the checker was removed — this is independent of window listener state.
    const action = vi.fn();
    const { rerender } = render(<Harness dirty={true} onAction={action} />);
    // Sanity: dirty state currently blocks.
    await userEvent.setup().click(screen.getByRole("button", { name: "go" }));
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    // Close dialog and unmount the registrar (registry entry must be dropped).
    await userEvent.setup().click(screen.getByRole("button", { name: /stay/i }));
    rerender(<Harness dirty={true} onAction={action} mountChild={false} />);
    action.mockClear();
    await userEvent.setup().click(screen.getByRole("button", { name: "go" }));
    // Guard resolves immediately — checker was unregistered.
    expect(action).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
