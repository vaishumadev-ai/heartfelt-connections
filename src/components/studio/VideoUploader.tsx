import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Trash2, UploadCloud } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  attachLessonVideo,
  detachLessonVideo,
  getMediaLimits,
  signLessonVideoUrl,
} from "@/lib/media.functions";
import {
  buildTusUploadConfig,
  buildVideoObjectPath,
  VIDEO_MAX_BYTES,
  VIDEO_VALIDATION_MESSAGE,
  validateVideoFile,
  type VideoMime,
  type VideoValidationError,
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
import { useUnsavedGuard } from "@/components/lesson-tools/UnsavedGuard";

/**
 * Minimal shape of the `tus-js-client` Upload class we depend on. Kept as an
 * interface so tests can inject a fake driver via `__setTusDriver` without
 * pulling the real library through JSDOM (which chokes on its Blob helpers).
 */
export type TusDriverHandle = {
  start: () => void;
  abort: (shouldTerminate?: boolean) => Promise<void> | void;
};

export type TusDriverOptions = {
  file: File;
  config: ReturnType<typeof buildTusUploadConfig>;
  onProgress: (bytesUploaded: number, bytesTotal: number) => void;
  onSuccess: () => void;
  onError: (err: Error) => void;
};

export type TusDriver = (opts: TusDriverOptions) => TusDriverHandle;

async function realTusDriver(opts: TusDriverOptions): Promise<TusDriverHandle> {
  const mod = await import("tus-js-client");
  const upload = new mod.Upload(opts.file, {
    ...opts.config,
    onProgress: (bytesUploaded: number, bytesTotal: number) => {
      opts.onProgress(bytesUploaded, bytesTotal);
    },
    onSuccess: () => opts.onSuccess(),
    onError: (err: Error) => opts.onError(err),
  });
  upload.start();
  return {
    start: () => upload.start(),
    abort: (t) => upload.abort(t),
  };
}

function defaultTusDriver(opts: TusDriverOptions): TusDriverHandle {
  // Real production driver — kicks off the async import synchronously and
  // forwards start/abort to the eventual handle. There is deliberately no
  // mutable module-level driver; each component gets its own instance.
  let started: TusDriverHandle | null = null;
  void realTusDriver(opts).then((h) => {
    started = h;
  });
  return {
    start: () => started?.start(),
    abort: (t) => started?.abort(t) ?? undefined,
  };
}

type UploadState =
  | { kind: "idle" }
  | { kind: "validating" }
  | { kind: "uploading"; path: string; progress: number }
  | { kind: "attaching"; path: string }
  | { kind: "replacing"; path: string; progress: number }
  | { kind: "removing" }
  | { kind: "cleanup_pending"; orphanPath: string; message: string }
  | { kind: "failed"; message: string };

export type VideoUploaderProps = {
  lessonId: string;
  courseId: string;
  isEditable: boolean;
  videoStoragePath: string | null;
  /**
   * Optional injection seam. Production always uses the real TUS driver;
   * only behavioral tests pass a fake. There is no mutable module-level
   * driver — one instance can never influence another.
   */
  tusDriver?: TusDriver;
  onSaved?: () => void;
};

/**
 * Lesson-video editor with a resumable TUS upload to the private
 * `course-videos` bucket. Mirrors the CoverUploader state machine:
 *
 *  idle → validating → uploading → attaching → idle
 *                            ↘ failed
 *
 * Ordering guarantees:
 *  - Upload writes the new object first; `attach_lesson_video` runs strictly
 *    after and — inside a single transaction — updates the lesson row and
 *    deletes any previously-attached object. No client-side compensating
 *    delete is needed on the happy path.
 *  - Aborting an in-flight upload calls `tus.abort(true)` so partial chunks
 *    are terminated on the server and can't linger as orphans.
 *  - Remove = confirmation dialog → `detach_lesson_video` RPC which deletes
 *    both DB pointer and Storage object atomically.
 *
 * The private storage path never appears in the DOM; the UI shows only the
 * lesson's short label. The signed preview URL is fetched via a server
 * function and refreshed on each mount / after replace.
 */
export function VideoUploader({
  lessonId,
  courseId,
  isEditable,
  videoStoragePath,
  tusDriver,
  onSaved,
}: VideoUploaderProps) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [state, setState] = useState<UploadState>({ kind: "idle" });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const uploadRef = useRef<TusDriverHandle | null>(null);
  const guard = useUnsavedGuard();
  const signReqSeq = useRef(0);
  // Synchronous single-flight guard covering upload/replace/remove/retry.
  // Prevents rapid double-clicks from launching two operations in parallel.
  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const safeSet = useCallback((s: UploadState) => {
    if (mountedRef.current) setState(s);
  }, []);

  const limitsFn = useServerFn(getMediaLimits);
  const attachFn = useServerFn(attachLessonVideo);
  const detachFn = useServerFn(detachLessonVideo);
  const signFn = useServerFn(signLessonVideoUrl);

  const limitsQ = useQuery({
    queryKey: ["media-limits"],
    queryFn: () => limitsFn(),
    staleTime: 5 * 60_000,
  });

  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  useEffect(() => {
    // Clear immediately on any path change so a stale URL cannot linger.
    setSignedUrl(null);
    if (!videoStoragePath) return;
    const my = ++signReqSeq.current;
    signFn({ data: { storagePath: videoStoragePath, expiresIn: 3600 } })
      .then((r) => {
        if (my !== signReqSeq.current) return;
        setSignedUrl((r as { url: string | null } | null)?.url ?? null);
      })
      .catch(() => {
        if (my !== signReqSeq.current) return;
        setSignedUrl(null);
      });
  }, [videoStoragePath, signFn]);

  // Register as an unsafe-navigation source while a TUS upload, attach, or
  // remove RPC is in flight. UnsavedGuard reads this via a ref so its
  // identity is stable in StrictMode.
  const unsafeRef = useRef(false);
  unsafeRef.current =
    state.kind === "validating" ||
    state.kind === "uploading" ||
    state.kind === "replacing" ||
    state.kind === "attaching" ||
    state.kind === "removing" ||
    state.kind === "cleanup_pending";
  useEffect(() => {
    return guard.registerDirtyChecker(`studio-video-${lessonId}`, () => unsafeRef.current);
  }, [guard, lessonId]);

  const invalidateAll = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["my-course", courseId] });
    qc.invalidateQueries({ queryKey: ["my-courses"] });
    qc.invalidateQueries({ queryKey: ["course-readiness", courseId] });
    onSaved?.();
  }, [qc, courseId, onSaved]);

  // Compensating storage deletion. Runs as the same caller-scoped Supabase
  // client (Storage RLS enforces owner==uid); no service-role path.
  const tryDeleteStorageObject = useCallback(async (path: string): Promise<boolean> => {
    try {
      const { error } = await supabase.storage.from("course-videos").remove([path]);
      return !error;
    } catch {
      return false;
    }
  }, []);

  const runUpload = useCallback(
    async (file: File) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      const replacing = !!videoStoragePath;
      safeSet({ kind: "validating" });
      if (limitsQ.isError) {
        inFlightRef.current = false;
        safeSet({ kind: "failed", message: VIDEO_VALIDATION_MESSAGE.config_unavailable });
        return;
      }
      const v = validateVideoFile(file, limitsQ.data?.video ?? undefined);
      if (!v.ok) {
        inFlightRef.current = false;
        safeSet({
          kind: "failed",
          message: VIDEO_VALIDATION_MESSAGE[v.code as VideoValidationError],
        });
        return;
      }
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        inFlightRef.current = false;
        safeSet({ kind: "failed", message: "Please sign in again to upload." });
        return;
      }
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const accessToken = session?.access_token ?? "";
      if (!accessToken) {
        inFlightRef.current = false;
        safeSet({ kind: "failed", message: "Session expired. Please sign in again." });
        return;
      }
      let path: string;
      try {
        path = buildVideoObjectPath({ userId: user.id, courseId, ext: v.ext });
      } catch {
        inFlightRef.current = false;
        safeSet({ kind: "failed", message: VIDEO_VALIDATION_MESSAGE.config_unavailable });
        return;
      }
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
      const apiKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
      if (!supabaseUrl || !apiKey) {
        inFlightRef.current = false;
        safeSet({ kind: "failed", message: VIDEO_VALIDATION_MESSAGE.config_unavailable });
        return;
      }
      const config = buildTusUploadConfig({
        supabaseUrl,
        accessToken,
        apiKey,
        objectPath: path,
        mime: v.mime as VideoMime,
      });
      safeSet({ kind: replacing ? "replacing" : "uploading", path, progress: 0 });
      const driver: TusDriver = tusDriver ?? defaultTusDriver;

      await new Promise<void>((resolve) => {
        const handle = driver({
          file,
          config,
          onProgress: (uploaded, total) => {
            const pct = total > 0 ? Math.round((uploaded / total) * 100) : 0;
            if (!mountedRef.current) return;
            setState((prev) => {
              if (prev.kind === "uploading" || prev.kind === "replacing") {
                return { ...prev, progress: pct };
              }
              return prev;
            });
          },
          onError: (err) => {
            safeSet({
              kind: "failed",
              message: err instanceof Error ? err.message : "Upload failed.",
            });
            resolve();
          },
          onSuccess: async () => {
            safeSet({ kind: "attaching", path });
            try {
              const res = (await attachFn({
                data: { lessonId, storagePath: path },
              })) as { previousStoragePath?: string | null } | undefined;
              const prev = res?.previousStoragePath ?? null;
              invalidateAll();
              // Attach committed. If a previous object existed, delete it
              // now. If that delete fails we hold cleanup_pending so the
              // instructor can retry — never roll back working media.
              if (prev) {
                const ok = await tryDeleteStorageObject(prev);
                if (!ok) {
                  safeSet({
                    kind: "cleanup_pending",
                    orphanPath: prev,
                    message:
                      "Your new video is live, but we couldn't remove the previous file. Retry cleanup below.",
                  });
                } else {
                  safeSet({ kind: "idle" });
                }
              } else {
                safeSet({ kind: "idle" });
              }
            } catch (err) {
              // Attach failed. Existing attached video (if any) is
              // untouched. Delete only the freshly uploaded object.
              const ok = await tryDeleteStorageObject(path);
              if (ok) {
                safeSet({
                  kind: "failed",
                  message: err instanceof Error ? err.message : "Couldn't attach the video.",
                });
              } else {
                safeSet({
                  kind: "cleanup_pending",
                  orphanPath: path,
                  message:
                    "We couldn't finish attaching the video and couldn't clean up the leftover file. Retry cleanup below.",
                });
              }
            } finally {
              resolve();
            }
          },
        });
        uploadRef.current = handle;
      });
      uploadRef.current = null;
      inFlightRef.current = false;
      if (inputRef.current) inputRef.current.value = "";
    },
    [
      attachFn,
      courseId,
      invalidateAll,
      lessonId,
      limitsQ.data,
      limitsQ.isError,
      safeSet,
      tryDeleteStorageObject,
      tusDriver,
      videoStoragePath,
    ],
  );

  const removeMut = useMutation({
    mutationFn: async () => {
      if (inFlightRef.current) return { previousStoragePath: null as string | null };
      inFlightRef.current = true;
      safeSet({ kind: "removing" });
      const res = (await detachFn({ data: { lessonId } })) as
        | { previousStoragePath?: string | null }
        | undefined;
      return { previousStoragePath: res?.previousStoragePath ?? null };
    },
    onSuccess: async ({ previousStoragePath }) => {
      invalidateAll();
      if (previousStoragePath) {
        const ok = await tryDeleteStorageObject(previousStoragePath);
        if (!ok) {
          safeSet({
            kind: "cleanup_pending",
            orphanPath: previousStoragePath,
            message:
              "The video was detached, but we couldn't delete the file. Retry cleanup below.",
          });
          inFlightRef.current = false;
          return;
        }
      }
      safeSet({ kind: "idle" });
      inFlightRef.current = false;
    },
    onError: (err) => {
      inFlightRef.current = false;
      safeSet({
        kind: "failed",
        message: err instanceof Error ? err.message : "Couldn't remove the video.",
      });
    },
  });

  const retryCleanup = useCallback(async () => {
    if (state.kind !== "cleanup_pending" || inFlightRef.current) return;
    inFlightRef.current = true;
    const ok = await tryDeleteStorageObject(state.orphanPath);
    inFlightRef.current = false;
    if (ok) safeSet({ kind: "idle" });
  }, [state, safeSet, tryDeleteStorageObject]);

  const cancelUpload = useCallback(() => {
    if (uploadRef.current) {
      try {
        void uploadRef.current.abort(true);
      } catch {
        /* ignore */
      }
      uploadRef.current = null;
    }
    inFlightRef.current = false;
    safeSet({ kind: "idle" });
  }, [safeSet]);

  useEffect(() => {
    return () => {
      if (uploadRef.current) {
        try {
          void uploadRef.current.abort(true);
        } catch {
          /* ignore */
        }
        uploadRef.current = null;
      }
    };
  }, []);

  const busy =
    state.kind === "validating" ||
    state.kind === "uploading" ||
    state.kind === "replacing" ||
    state.kind === "attaching" ||
    state.kind === "removing" ||
    state.kind === "cleanup_pending";

  const helpText = useMemo(() => {
    const cap = limitsQ.data?.video.fileSizeLimit ?? VIDEO_MAX_BYTES;
    const mb = Math.round(cap / (1024 * 1024));
    return `MP4 or WebM. Up to ${mb} MB. Resumable — reconnect and continue if your network drops.`;
  }, [limitsQ.data]);

  const progress = state.kind === "uploading" || state.kind === "replacing" ? state.progress : null;

  return (
    <div data-testid={`video-uploader-${lessonId}`} data-state={state.kind}>
      <input
        ref={inputRef}
        type="file"
        accept="video/mp4,video/webm"
        className="sr-only"
        aria-label="Choose a lesson video"
        disabled={!isEditable || busy}
        onChange={(e) => {
          const file = e.currentTarget.files?.[0] ?? null;
          if (file) void runUpload(file);
        }}
      />
      <div className="rounded-2xl bg-background p-3 ring-1 ring-border">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-muted-foreground">Lesson video</p>
            <p className="mt-1 truncate text-sm">
              {videoStoragePath ? "Video attached" : "No video yet"}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">{helpText}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={!isEditable || busy}
              className="flex min-h-11 items-center gap-2 rounded-full bg-foreground px-4 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-60"
            >
              <UploadCloud className="h-4 w-4" aria-hidden />
              {videoStoragePath ? "Replace video" : "Upload video"}
            </button>
            {videoStoragePath && (
              <button
                type="button"
                onClick={() => {
                  if (!isEditable || busy) return;
                  setConfirmOpen(true);
                }}
                disabled={!isEditable || busy}
                aria-label="Remove lesson video"
                className="flex h-11 w-11 items-center justify-center rounded-full bg-card ring-1 ring-border disabled:opacity-60"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
        {(state.kind === "uploading" || state.kind === "replacing") && (
          <div
            className="mt-3"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress ?? 0}
            aria-label="Video upload progress"
          >
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>{state.kind === "replacing" ? "Replacing video…" : "Uploading video…"}</span>
              <span>{progress ?? 0}%</span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-card">
              <div
                className="h-full bg-foreground transition-[width]"
                style={{ width: `${progress ?? 0}%` }}
              />
            </div>
            <button
              type="button"
              onClick={cancelUpload}
              className="mt-2 text-[11px] font-semibold underline"
            >
              Cancel upload
            </button>
          </div>
        )}
        {state.kind === "attaching" && (
          <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Finalising…
          </p>
        )}
        {state.kind === "removing" && (
          <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Removing video…
          </p>
        )}
        {state.kind === "failed" && (
          <p role="alert" className="mt-3 rounded-2xl bg-red-50 p-3 text-xs text-red-700">
            {state.message}
          </p>
        )}
        {state.kind === "cleanup_pending" && (
          <div role="alert" className="mt-3 rounded-2xl bg-amber-50 p-3 text-xs text-amber-900">
            <p>{state.message}</p>
            <button
              type="button"
              onClick={() => void retryCleanup()}
              className="mt-2 rounded-full bg-foreground px-3 py-1 text-[11px] font-semibold text-primary-foreground"
            >
              Retry cleanup
            </button>
          </div>
        )}
        {!isEditable && (
          <p className="mt-3 text-[11px] text-muted-foreground">
            Video is locked while the course is under review or approved.
          </p>
        )}
        {videoStoragePath && signedUrl && !busy && (
          <video
            key={signedUrl}
            src={signedUrl}
            controls
            preload="metadata"
            className="mt-3 w-full rounded-xl bg-black"
          />
        )}
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this lesson video?</AlertDialogTitle>
            <AlertDialogDescription>
              The video will be detached from this lesson and permanently deleted from storage. You
              can upload a new one at any time.
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
              Remove video
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
