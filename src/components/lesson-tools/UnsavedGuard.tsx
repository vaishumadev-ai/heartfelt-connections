import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type DirtyChecker = () => boolean;

type GuardContextValue = {
  registerDirtyChecker: (id: string, checker: DirtyChecker) => () => void;
  /** Runs `action` if no dirty checker is dirty; otherwise prompts. */
  guard: (action: () => void) => void;
};

const GuardContext = createContext<GuardContextValue | null>(null);

export function UnsavedGuardProvider({ children }: { children: React.ReactNode }) {
  const checkersRef = useRef(new Map<string, DirtyChecker>());
  const [pendingAction, setPendingAction] = useState<null | (() => void)>(null);

  const registerDirtyChecker = useCallback((id: string, checker: DirtyChecker) => {
    checkersRef.current.set(id, checker);
    return () => {
      checkersRef.current.delete(id);
    };
  }, []);

  const isDirty = useCallback(() => {
    for (const c of checkersRef.current.values()) if (c()) return true;
    return false;
  }, []);

  const guard = useCallback(
    (action: () => void) => {
      if (isDirty()) {
        setPendingAction(() => action);
      } else {
        action();
      }
    },
    [isDirty],
  );

  // Browser tab close/reload protection. Body is never stored anywhere.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!isDirty()) return;
      e.preventDefault();
      // Modern browsers ignore custom text; setting returnValue triggers the prompt.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  return (
    <GuardContext.Provider value={{ registerDirtyChecker, guard }}>
      {children}
      <AlertDialog
        open={pendingAction !== null}
        onOpenChange={(o) => {
          if (!o) setPendingAction(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>You have unsaved notes</AlertDialogTitle>
            <AlertDialogDescription>
              If you leave now, your unsaved note will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Stay and continue editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const a = pendingAction;
                setPendingAction(null);
                a?.();
              }}
            >
              Discard and navigate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </GuardContext.Provider>
  );
}

export function useUnsavedGuard() {
  const ctx = useContext(GuardContext);
  if (!ctx) {
    // Outside a provider: pass-through (used by tests or non-tracked states).
    return {
      registerDirtyChecker: () => () => {},
      guard: (action: () => void) => action(),
    } as GuardContextValue;
  }
  return ctx;
}
