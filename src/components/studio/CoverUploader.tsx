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
  bestEffortRemoveObject,
  buildCoverObjectPath,
  COVER_MAX_BYTES,
  COVER_VALIDATION_MESSAGE,
  type CoverValidationError,
  uploadCoverToStorage,
  validateCoverFile,
} from "@/lib/media-uploads";

type UploadState =
  | { kind: "idle" }
  | { kind: "validating" }
  | { kind: "uploading"; path: string; progress?: number }
  | { kind: "attaching"; path: string }
  | { kind: "removing" }
  | { kind: "failed"; message: string };

export type CoverUploaderProps = {
  courseId: string;
  isEditable: boolean;
  coverStoragePath: string | null;
  legacyCoverUrl: string | null;
};

/**
 * Cover-artwork editor. Runs a small state machine so a rapid replace/remove
 * sequence never leaves the course pointing at a half-uploaded object.
 *
 * Ordering guarantees:
 *  - Upload → attach. On attach failure, the freshly-uploaded object is
 *    removed via a best-effort cleanup so it does not linger orphaned.
 *  - Replace = upload new object → attach (RPC swaps the metadata). The old
 *    object is cleaned up server-side by the attach RPC.
 *  - Remove = detach RPC first, then Storage delete; failing the delete
 *    still leaves the course in a consistent state (no reference remains).
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

  const limitsFn = useServerFn(getMediaLimits);
  const attachFn = useServerFn(attachCourseCover);
  const detachFn = useServerFn(detachCourseCover);
  const signFn = useServerFn(signCoverPreview);

  const limitsQ = useQuery({
    queryKey: ["media-limits"],
    queryFn: () => limitsFn(),
    staleTime: 5 * 60_000,
  });

  const signedQ = useQuery({
    queryKey: ["course-cover-sign", courseId, coverStoragePath],
    queryFn: () =>
      coverStoragePath
        ? signFn({ data: { storagePath: coverStoragePath, expiresIn: 3600 } })
        : Promise.resolve({ url: null, expiresIn: 0 }),
    enabled: !!coverStoragePath,
    // Refresh a bit before the URL expires so the preview never breaks.
    staleTime: 55 * 60_000,
  });

  const previewUrl = coverStoragePath ? (signedQ.data?.url ?? null) : legacyCoverUrl;

  const invalidateAll = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["my-course", courseId] });
    qc.invalidateQueries({ queryKey: ["course-readiness", courseId] });
    qc.invalidateQueries({ queryKey: ["course-cover-sign", courseId] });
  }, [qc, courseId]);

  const runUpload = useCallback(
    async (file: File) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setState({ kind: "validating" });
      try {
        const v = validateCoverFile(file);
        if (!v.ok) {
          setState({
            kind: "failed",
            message: COVER_VALIDATION_MESSAGE[v.code as CoverValidationError],
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
        const path = buildCoverObjectPath({ userId: user.id, courseId, ext: v.ext });
        setState({ kind: "uploading", path });
        try {
          await uploadCoverToStorage(supabase, path, file, v.mime);
        } catch (err) {
          setState({
            kind: "failed",
            message: err instanceof Error ? err.message : "Upload failed.",
          });
          return;
        }
        setState({ kind: "attaching", path });
        try {
          await attachFn({ data: { courseId, storagePath: path } });
        } catch (err) {
          // Attach failed — clean up the orphan object we just wrote.
          await bestEffortRemoveObject(supabase, path);
          setState({
            kind: "failed",
            message: err instanceof Error ? err.message : "Couldn't attach the cover.",
          });
          return;
        }
        setState({ kind: "idle" });
        invalidateAll();
      } finally {
        inFlight.current = false;
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [attachFn, courseId, invalidateAll],
  );

  const removeMut = useMutation({
    mutationFn: async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      setState({ kind: "removing" });
      try {
        await detachFn({ data: { courseId } });
      } finally {
        inFlight.current = false;
      }
    },
    onSuccess: () => {
      setState({ kind: "idle" });
      invalidateAll();
    },
    onError: (err) => {
      setState({
        kind: "failed",
        message: err instanceof Error ? err.message : "Couldn't remove the cover.",
      });
    },
  });

  useEffect(() => {
    return () => {
      inFlight.current = false;
    };
  }, []);

  const busy =
    state.kind === "validating" ||
    state.kind === "uploading" ||
    state.kind === "attaching" ||
    state.kind === "removing";

  const helpText = useMemo(() => {
    const cap = limitsQ.data?.cover.fileSizeLimit ?? COVER_MAX_BYTES;
    const mb = Math.round((cap / (1024 * 1024)) * 10) / 10;
    return `JPEG, PNG, or WebP. Up to ${mb} MB. Recommended 1600×900.`;
  }, [limitsQ.data]);

  const statusLabel: Record<UploadState["kind"], string | null> = {
    idle: null,
    validating: "Checking file…",
    uploading: "Uploading cover…",
    attaching: "Attaching cover…",
    removing: "Removing cover…",
    failed: state.kind === "failed" ? state.message : null,
  };

  return (
    <div>
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
              {previewUrl ? "Replace cover" : "Upload cover"}
            </button>
            {coverStoragePath && (
              <button
                type="button"
                onClick={() => {
                  if (!isEditable || busy) return;
                  if (confirm("Remove this cover?")) removeMut.mutate();
                }}
                disabled={!isEditable || busy}
                className="flex min-h-11 items-center gap-2 rounded-full bg-card px-4 py-2.5 text-sm font-semibold ring-1 ring-border disabled:opacity-60"
              >
                <Trash2 className="h-4 w-4" aria-hidden /> Remove
              </button>
            )}
          </div>
          {state.kind === "failed" && (
            <p role="alert" className="mt-3 rounded-2xl bg-red-50 p-3 text-xs text-red-700">
              {state.message}
            </p>
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