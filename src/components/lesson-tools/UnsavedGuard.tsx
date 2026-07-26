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

/**
 * Cooperative nav controllers let a route-level blocker query and act on
 * every registered "unsafe navigation" source (course editor form, cover
 * uploader). This lets the studio route render exactly one blocker and one
 * dialog, while keeping the form/uploader owners of their own state.
 */
export type CourseFormNavController = {
  kind: "course-form";
  isDirty: () => boolean;
  /** Runs the existing Save action. Resolves true on confirmed success. */
  save: () => Promise<boolean>;
  /** Restores the last confirmed values (no navigation). */
  discard: () => void;
};

export type CoverNavController = {
  kind: "cover";
  /** Current media state class — never includes raw storage paths. */
  status: () => "safe" | "busy" | "cleanup_pending";
  /** Retries the pending storage cleanup for the orphan the uploader tracks. */
  retryCleanup: () => Promise<boolean>;
};

export type NavController = CourseFormNavController | CoverNavController;

export type BlockSnapshot = {
  courseDirty: boolean;
  coverBusy: boolean;
  cleanupPending: boolean;
  saveAll: () => Promise<boolean>;
  discardAll: () => void;
  retryCleanupAll: () => Promise<boolean>;
};

type GuardContextValue = {
  registerDirtyChecker: (id: string, checker: DirtyChecker) => () => void;
  /** Runs `action` if no dirty checker is dirty; otherwise prompts. */
  guard: (action: () => void) => void;
  /** True if any registered dirty checker currently reports dirty. */
  isDirty: () => boolean;
  /** Register a cooperative nav controller. Returns unregister. */
  registerNavController: (id: string, controller: NavController) => () => void;
  /** Snapshot every controller's status and return coordinated actions. */
  snapshotBlockState: () => BlockSnapshot;
};

const GuardContext = createContext<GuardContextValue | null>(null);

export function UnsavedGuardProvider({ children }: { children: React.ReactNode }) {
  const checkersRef = useRef(new Map<string, DirtyChecker>());
  const controllersRef = useRef(new Map<string, NavController>());
  const [pendingAction, setPendingAction] = useState<null | (() => void)>(null);

  const registerDirtyChecker = useCallback((id: string, checker: DirtyChecker) => {
    checkersRef.current.set(id, checker);
    return () => {
      checkersRef.current.delete(id);
    };
  }, []);

  const registerNavController = useCallback((id: string, controller: NavController) => {
    controllersRef.current.set(id, controller);
    return () => {
      controllersRef.current.delete(id);
    };
  }, []);

  const isDirty = useCallback(() => {
    for (const c of checkersRef.current.values()) if (c()) return true;
    return false;
  }, []);

  const snapshotBlockState = useCallback((): BlockSnapshot => {
    const controllers = Array.from(controllersRef.current.values());
    let courseDirty = false;
    let coverBusy = false;
    let cleanupPending = false;
    for (const c of controllers) {
      if (c.kind === "course-form" && c.isDirty()) courseDirty = true;
      if (c.kind === "cover") {
        const s = c.status();
        if (s === "busy") coverBusy = true;
        if (s === "cleanup_pending") cleanupPending = true;
      }
    }
    const formControllers = controllers.filter(
      (c): c is CourseFormNavController => c.kind === "course-form",
    );
    const coverControllers = controllers.filter((c): c is CoverNavController => c.kind === "cover");
    return {
      courseDirty,
      coverBusy,
      cleanupPending,
      saveAll: async () => {
        for (const c of formControllers) {
          const ok = await c.save();
          if (!ok) return false;
        }
        return true;
      },
      discardAll: () => {
        for (const c of formControllers) c.discard();
      },
      retryCleanupAll: async () => {
        for (const c of coverControllers) {
          const ok = await c.retryCleanup();
          if (!ok) return false;
        }
        return true;
      },
    };
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
    <GuardContext.Provider
      value={{
        registerDirtyChecker,
        guard,
        isDirty,
        registerNavController,
        snapshotBlockState,
      }}
    >
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
      isDirty: () => false,
      registerNavController: () => () => {},
      snapshotBlockState: () => ({
        courseDirty: false,
        coverBusy: false,
        cleanupPending: false,
        saveAll: async () => true,
        discardAll: () => {},
        retryCleanupAll: async () => true,
      }),
    } as GuardContextValue;
  }
  return ctx;
}
