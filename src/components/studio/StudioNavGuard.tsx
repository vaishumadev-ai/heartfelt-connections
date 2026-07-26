import { useEffect, useState } from "react";
import { useBlocker } from "@tanstack/react-router";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useUnsavedGuard } from "@/components/lesson-tools/UnsavedGuard";

/**
 * Route-level navigation guard for the Studio course editor. Renders exactly
 * one AlertDialog and holds the sole TanStack Router `useBlocker` for the
 * subtree, coordinating the CourseEditor form and CoverUploader nav
 * controllers registered via `UnsavedGuardProvider`.
 *
 * Dialog modes:
 *  - "wait"    → cover has an in-flight validating/uploading/attaching/
 *                replacing/removing operation. Only Stay is shown.
 *  - "cleanup" → cover reached cleanup_pending (storage orphan). Retry
 *                cleanup + Stay. The private path is never rendered.
 *  - "unsaved" → course fields are dirty. Save / Discard / Stay.
 */
export function StudioNavGuard() {
  const guard = useUnsavedGuard();
  const [busy, setBusy] = useState<null | "saving" | "cleaning">(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const blocker = useBlocker({
    withResolver: true,
    shouldBlockFn: () => guard.isDirty(),
    enableBeforeUnload: () => guard.isDirty(),
  });

  const blocked = blocker.status === "blocked";

  // Reset transient dialog state whenever the blocker leaves the "blocked"
  // status (either proceed() or reset() fired) so the next block starts fresh.
  useEffect(() => {
    if (!blocked) {
      setBusy(null);
      setSaveError(null);
    }
  }, [blocked]);

  if (!blocked) return null;

  const snap = guard.snapshotBlockState();
  const { coverBusy, cleanupPending, courseDirty } = snap;

  const stay = () => {
    if (busy) return;
    blocker.reset();
  };

  const saveAndContinue = async () => {
    if (busy) return;
    setBusy("saving");
    setSaveError(null);
    const ok = await snap.saveAll();
    if (ok) {
      blocker.proceed();
    } else {
      setBusy(null);
      setSaveError("Save failed. Your changes are preserved — please review and try again.");
    }
  };

  const discardAndContinue = () => {
    if (busy) return;
    snap.discardAll();
    blocker.proceed();
  };

  const retryCleanup = async () => {
    if (busy) return;
    setBusy("cleaning");
    const ok = await snap.retryCleanupAll();
    if (ok) blocker.proceed();
    else setBusy(null);
  };

  const mode: "wait" | "cleanup" | "unsaved" = coverBusy
    ? "wait"
    : cleanupPending
      ? "cleanup"
      : "unsaved";

  const title =
    mode === "wait"
      ? "Cover operation in progress"
      : mode === "cleanup"
        ? "Cover cleanup pending"
        : "You have unsaved changes";

  const description =
    mode === "wait"
      ? "Please wait for the cover operation to finish before leaving."
      : mode === "cleanup"
        ? "The cover was saved, but an older file still needs cleanup."
        : "Save your changes before leaving, or discard them to continue.";

  return (
    <AlertDialog
      open
      onOpenChange={(o) => {
        // Radix routes ESC / AlertDialogCancel through this callback.
        // Route it through stay() so we call blocker.reset() exactly once.
        if (!o) stay();
      }}
    >
      <AlertDialogContent data-testid="studio-nav-guard-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {saveError && (
          <p
            role="alert"
            className="rounded-2xl bg-red-50 p-3 text-xs text-red-700"
            data-testid="studio-nav-guard-save-error"
          >
            {saveError}
          </p>
        )}
        <AlertDialogFooter>
          {mode === "wait" && (
            <AlertDialogCancel>Stay here</AlertDialogCancel>
          )}
          {mode === "cleanup" && (
            <>
              <AlertDialogCancel disabled={busy !== null}>
                Stay here
              </AlertDialogCancel>
              <button
                type="button"
                onClick={retryCleanup}
                disabled={busy !== null}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                {busy === "cleaning" ? "Retrying…" : "Retry cleanup"}
              </button>
            </>
          )}
          {mode === "unsaved" && (
            <>
              <AlertDialogCancel disabled={busy !== null}>
                Stay here
              </AlertDialogCancel>
              <button
                type="button"
                onClick={discardAndContinue}
                disabled={busy !== null}
                className="mt-2 inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-card px-5 py-2.5 text-sm font-semibold ring-1 ring-border disabled:opacity-60 sm:mt-0"
              >
                Discard and continue
              </button>
              <button
                type="button"
                onClick={saveAndContinue}
                disabled={busy !== null || !courseDirty}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                {busy === "saving" ? "Saving…" : "Save and continue"}
              </button>
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}