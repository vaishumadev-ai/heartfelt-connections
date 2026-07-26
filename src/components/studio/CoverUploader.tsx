import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  attachCourseCover,
  detachCourseCover,
  getMediaLimits,
  signCoverPreview,
} from "@/lib/media.functions";
import {
  buildCoverObjectPath,
  COVER_MAX_BYTES,
  COVER_VALIDATION_MESSAGE,
  type CoverValidationError,
  decodeImage,
  removeObjectStrict,
  uploadCoverToStorage,
  validateCoverFile,
} from "@/lib/media-uploads";
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

type UploadState =
  | { kind: "idle" }
  | { kind: "ready" }
  | { kind: "validating" }
  | { kind: "uploading"; path: string; progress?: number }
  | { kind: "attaching"; path: string }
  | { kind: "replacing"; path: string }
  | { kind: "removing" }
  | { kind: "failed"; message: string }
  | { kind: "cleanup_pending"; path: string };

// Generic operator-safe copy shown when a compensating Storage delete cannot
// complete. The exact orphan path is kept in private component state and NEVER
// rendered so it can't leak to the DOM, logs, error boundaries, or devtools.
const CLEANUP_PENDING_COPY =
  "The cover was saved, but an older file still needs cleanup. Retry cleanup.";

export type CoverUploaderProps = {
  courseId: string;
  isEditable: boolean;
  coverStoragePath: string | null;
  legacyCoverUrl: string | null;
};

/**
 * Cover-artwork editor with an explicit state machine so rapid Replace/Remove
 * clicks never leave the course pointing at a half-uploaded object.
 *
 * States: idle | ready | validating | uploading | attaching | replacing |
 *         removing | failed | cleanup_pending
 *
 * Ordering guarantees:
 *  - Upload writes the new object first; the `attach_course_cover` RPC runs
 *    strictly after and, on success, deletes the previous key atomically
 *    (metadata + storage delete in one transaction).
 *  - On attach failure the freshly-uploaded object is removed via
 *    `removeObjectStrict`. If that cleanup itself fails the UI enters
 *    `cleanup_pending` and surfaces a Retry cleanup control bound to the
 *    exact orphaned path.
 *  - Remove = detach RPC first (server delegates the object delete). Storage
 *    is never touched directly for existing cover paths on the client.
 *  - Optimistic local preview uses `URL.createObjectURL`; the blob URL is
 *    revoked on replacement and on unmount so no browser memory leaks.
 */
export function CoverUploader({
  courseId,
  isEditable,
  coverStoragePath,
  legacyCoverUrl,
}: CoverUploaderProps) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const inFlight = useRef(false);
  const [state, setState] = useState<UploadState>({ kind: "idle" });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const localPreviewRef = useRef<string | null>(null);
  const signReqSeq = useRef(0);

  const limitsFn = useServerFn(getMediaLimits);
  const attachFn = useServerFn(attachCourseCover);
  const detachFn = useServerFn(detachCourseCover);
  const signFn = useServerFn(signCoverPreview);

  const limitsQ = useQuery({
    queryKey: ["media-limits"],
    queryFn: () => limitsFn(),
    staleTime: 5 * 60_000,
  });

  // Stale-preview protection: bump a monotonically increasing seq on each
  // sign request; ignore any resolved URL whose seq is not current. This
  // means a slow response for the previous cover cannot replace the preview
  // once the storage path has changed.
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!coverStoragePath) {
      setSignedUrl(null);
      return;
    }
    const my = ++signReqSeq.current;
    signFn({ data: { storagePath: coverStoragePath, expiresIn: 3600 } })
      .then((r) => {
        if (my !== signReqSeq.current) return; // stale
        setSignedUrl(r?.url ?? null);
      })
      .catch(() => {
        if (my !== signReqSeq.current) return;
        setSignedUrl(null);
      });
  }, [coverStoragePath, signFn]);

  // Preview precedence: local blob (optimistic during upload) → signed URL
  // (private bucket) → legacy public URL (rare fallback) → icon fallback.
  const previewUrl = localPreview ?? (coverStoragePath ? signedUrl : (legacyCoverUrl ?? null));

  const invalidateAll = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["my-course", courseId] });
    qc.invalidateQueries({ queryKey: ["my-courses"] });
    qc.invalidateQueries({ queryKey: ["course-readiness", courseId] });
  }, [qc, courseId]);

  const setBlobPreview = useCallback((next: string | null) => {
    if (localPreviewRef.current && localPreviewRef.current !== next) {
      try {
        URL.revokeObjectURL(localPreviewRef.current);
      } catch {
        /* ignore */
      }
    }
    localPreviewRef.current = next;
    setLocalPreview(next);
  }, []);

  const runUpload = useCallback(
    async (file: File) => {
      if (inFlight.current) return; // single-flight: rapid clicks coalesce
      inFlight.current = true;
      const replacing = !!coverStoragePath;
      setState({ kind: "validating" });
      try {
        // Fail closed when the media-limits query has errored (we don't know
        // the authoritative allowlist/size cap). If the query is still
        // pending, `limitsQ.data` is undefined — pass undefined so the
        // helper uses its compiled default (the same values enforced at
        // Storage by RLS) rather than blocking on a transient race.
        if (limitsQ.isError) {
          setState({
            kind: "failed",
            message: COVER_VALIDATION_MESSAGE.config_unavailable,
          });
          return;
        }
        const v = validateCoverFile(file, limitsQ.data?.cover ?? undefined);
        if (!v.ok) {
          setState({
            kind: "failed",
            message: COVER_VALIDATION_MESSAGE[v.code as CoverValidationError],
          });
          return;
        }
        // Decode the image to prove it isn't corrupt and read dimensions.
        // Non-16:9 is a soft recommendation and does NOT block upload.
        const decoded = await decodeImage(file);
        if (!decoded.ok) {
          setState({
            kind: "failed",
            message: COVER_VALIDATION_MESSAGE[decoded.code],
          });
          return;
        }
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          setState({ kind: "failed", message: "Please sign in again to upload." });
          return;
        }
        let path: string;
        try {
          path = buildCoverObjectPath({ userId: user.id, courseId, ext: v.ext });
        } catch {
          setState({
            kind: "failed",
            message: COVER_VALIDATION_MESSAGE.config_unavailable,
          });
          return;
        }
        // Optimistic local preview so the instructor sees their pick instantly.
        try {
          setBlobPreview(URL.createObjectURL(file));
        } catch {
          /* jsdom/browsers without URL.createObjectURL: skip preview */
        }
        setState({ kind: "uploading", path });
        try {
          await uploadCoverToStorage(supabase, path, file, v.mime);
        } catch (err) {
          setBlobPreview(null);
          setState({
            kind: "failed",
            message: err instanceof Error ? err.message : "Upload failed.",
          });
          return;
        }
        setState({ kind: replacing ? "replacing" : "attaching", path });
        let previousStoragePath: string | null = null;
        try {
          const res = await attachFn({ data: { courseId, storagePath: path } });
          previousStoragePath =
            (res &&
            typeof (res as { previousStoragePath?: unknown }).previousStoragePath === "string"
              ? (res as { previousStoragePath: string }).previousStoragePath
              : null) ?? null;
        } catch (err) {
          const attachMsg = err instanceof Error ? err.message : "Couldn't attach the cover.";
          // Attach failed — cover on the course is unchanged. Try to remove
          // ONLY the freshly-uploaded orphan (never the previously-attached
          // path). If that cleanup itself fails, surface cleanup_pending so
          // the user can retry cleanup of the recorded (but never-displayed)
          // orphan path.
          try {
            await removeObjectStrict(supabase, path);
            setBlobPreview(null);
            setState({ kind: "failed", message: attachMsg });
          } catch {
            setBlobPreview(null);
            setState({ kind: "cleanup_pending", path });
          }
          return;
        }
        // Attach succeeded → the new cover is authoritative. Refresh caches
        // so the fresh signed URL replaces the optimistic preview. Then, if
        // the RPC handed us a previously-attached path, run the compensating
        // Storage delete. Object-deletion failure here MUST NOT roll back
        // the attach; the new cover stays visible and we surface a
        // cleanup_pending retry with the previous (private) path.
        setState({ kind: "ready" });
        invalidateAll();
        if (previousStoragePath) {
          try {
            await removeObjectStrict(supabase, previousStoragePath);
          } catch {
            setState({ kind: "cleanup_pending", path: previousStoragePath });
          }
        }
      } finally {
        inFlight.current = false;
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [
      attachFn,
      courseId,
      coverStoragePath,
      invalidateAll,
      limitsQ.data,
      limitsQ.isError,
      setBlobPreview,
    ],
  );

  // Once the signed URL for the newly-attached cover has arrived, drop the
  // optimistic blob so we can revoke it.
  useEffect(() => {
    if (localPreview && signedUrl) setBlobPreview(null);
  }, [signedUrl, localPreview, setBlobPreview]);

  const removeMut = useMutation({
    mutationFn: async () => {
      if (inFlight.current) return { previousStoragePath: null as string | null };
      inFlight.current = true;
      setState({ kind: "removing" });
      try {
        // The detach RPC clears cover_storage_path in Postgres and returns
        // the previously-attached storage path. Physical object deletion is
        // a client-side compensating step performed only AFTER the DB
        // commits. If the object delete fails, the course is safely
        // detached and the UI enters cleanup_pending for retry.
        const res = await detachFn({ data: { courseId } });
        const previousStoragePath =
          (res && typeof (res as { previousStoragePath?: unknown }).previousStoragePath === "string"
            ? (res as { previousStoragePath: string }).previousStoragePath
            : null) ?? null;
        return { previousStoragePath };
      } finally {
        inFlight.current = false;
      }
    },
    onSuccess: async (res) => {
      setBlobPreview(null);
      invalidateAll();
      if (res?.previousStoragePath) {
        try {
          await removeObjectStrict(supabase, res.previousStoragePath);
          setState({ kind: "idle" });
        } catch {
          setState({ kind: "cleanup_pending", path: res.previousStoragePath });
        }
      } else {
        setState({ kind: "idle" });
      }
    },
    onError: (err) => {
      setState({
        kind: "failed",
        message: err instanceof Error ? err.message : "Couldn't remove the cover.",
      });
    },
  });

  const retryCleanup = useMutation({
    mutationFn: async (path: string) => {
      await removeObjectStrict(supabase, path);
    },
    onSuccess: () => setState({ kind: "idle" }),
    onError: (err) => {
      // Stay in cleanup_pending with the same (never-rendered) path so the
      // user can retry again. We deliberately do NOT surface the raw error
      // message: it can contain Storage/PostgREST internals.
      void err;
    },
  });

  useEffect(() => {
    return () => {
      inFlight.current = false;
      if (localPreviewRef.current) {
        try {
          URL.revokeObjectURL(localPreviewRef.current);
        } catch {
          /* ignore */
        }
        localPreviewRef.current = null;
      }
    };
  }, []);

  const busy =
    state.kind === "validating" ||
    state.kind === "uploading" ||
    state.kind === "attaching" ||
    state.kind === "replacing" ||
    state.kind === "removing";

  const helpText = useMemo(() => {
    const cap = limitsQ.data?.cover.fileSizeLimit ?? COVER_MAX_BYTES;
    const mb = Math.round((cap / (1024 * 1024)) * 10) / 10;
    return `JPEG, PNG, or WebP. Up to ${mb} MB. Recommended 1600×900.`;
  }, [limitsQ.data]);

  const statusLabel: Record<UploadState["kind"], string | null> = {
    idle: null,
    ready: null,
    validating: "Checking file…",
    uploading: "Uploading cover…",
    attaching: "Attaching cover…",
    replacing: "Replacing cover…",
    removing: "Removing cover…",
    failed: state.kind === "failed" ? state.message : null,
    cleanup_pending: null,
  };

  return (
    <div data-testid="cover-uploader-root" data-state={state.kind}>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        aria-label="Choose a cover image"
        disabled={!isEditable || busy}
        onChange={(e) => {
          const file = e.currentTarget.files?.[0] ?? null;
          if (file) void runUpload(file);
        }}
      />
      <div className="grid gap-4 md:grid-cols-[240px_1fr] md:items-start">
        <div
          className="relative aspect-[16/9] overflow-hidden rounded-2xl bg-background ring-1 ring-border"
          aria-live="polite"
        >
          {previewUrl ? (
            <img
              src={previewUrl}
              alt="Course cover preview"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
              No cover yet
            </div>
          )}
          {busy && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/70 text-xs font-semibold">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              {statusLabel[state.kind] ?? "Working…"}
            </div>
          )}
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{helpText}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={!isEditable || busy}
              className="flex min-h-11 items-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              <ImagePlus className="h-4 w-4" aria-hidden />
              {coverStoragePath || legacyCoverUrl ? "Replace cover" : "Upload cover"}
            </button>
            {coverStoragePath && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    if (!isEditable || busy) return;
                    setConfirmOpen(true);
                  }}
                  disabled={!isEditable || busy}
                  className="flex min-h-11 items-center gap-2 rounded-full bg-card px-4 py-2.5 text-sm font-semibold ring-1 ring-border disabled:opacity-60"
                >
                  <Trash2 className="h-4 w-4" aria-hidden /> Remove
                </button>
                <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Remove this cover?</AlertDialogTitle>
                      <AlertDialogDescription>
                        The cover will be detached from this course and the file deleted from
                        storage. You can upload another one at any time.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => {
                          setConfirmOpen(false);
                          removeMut.mutate();
                        }}
                      >
                        Remove cover
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            )}
          </div>
          {state.kind === "failed" && (
            <p role="alert" className="mt-3 rounded-2xl bg-red-50 p-3 text-xs text-red-700">
              {state.message}
            </p>
          )}
          {state.kind === "cleanup_pending" && (
            <div role="alert" className="mt-3 rounded-2xl bg-amber-50 p-3 text-xs text-amber-800">
              <p>{CLEANUP_PENDING_COPY}</p>
              <button
                type="button"
                onClick={() => retryCleanup.mutate(state.path)}
                disabled={retryCleanup.isPending}
                className="mt-2 inline-flex min-h-9 items-center gap-2 rounded-full bg-foreground px-4 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-60"
              >
                Retry cleanup
              </button>
            </div>
          )}
          {!isEditable && (
            <p className="mt-3 text-xs text-muted-foreground">
              Cover artwork is locked while the course is under review or approved.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
