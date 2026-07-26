import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  deleteLessonNote,
  getLessonNote,
  saveLessonNote,
  type LearnerNoteDTO,
} from "@/lib/learner.functions";
import { mapLearnerError } from "@/lib/learner-errors";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useUnsavedGuard } from "./UnsavedGuard";

const MAX = 4000;

export function NotesPanel({ courseId, lessonId }: { courseId: string; lessonId: string }) {
  const qc = useQueryClient();
  const fetchNote = useServerFn(getLessonNote);
  const saveFn = useServerFn(saveLessonNote);
  const deleteFn = useServerFn(deleteLessonNote);

  const queryKey = ["lesson-note", courseId, lessonId] as const;
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => fetchNote({ data: { lessonId } }),
    staleTime: 30_000,
  });

  // Preserve original whitespace: track draft as-typed, no trim.
  const [draft, setDraft] = useState("");
  const [hasEdited, setHasEdited] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const lastPersisted = data?.body ?? "";

  // On lesson change or fetch resolve, reset draft to authoritative body.
  useEffect(() => {
    setDraft(data?.body ?? "");
    setHasEdited(false);
    setSavedFlash(false);
    setErrorMsg(null);
  }, [data?.body, lessonId]);

  const trimmedLen = draft.trim().length;
  const isDirty = hasEdited && draft !== lastPersisted;
  const overLimit = draft.length > MAX;
  const emptyBody = trimmedLen === 0;
  const canSave = isDirty && !emptyBody && !overLimit;

  const { registerDirtyChecker } = useUnsavedGuard();
  useEffect(() => {
    return registerDirtyChecker(`note:${lessonId}`, () => isDirty);
  }, [isDirty, lessonId, registerDirtyChecker]);

  const invalidateShared = useCallback(() => {
    qc.invalidateQueries({ queryKey });
    qc.invalidateQueries({ queryKey: ["learner-dashboard"], refetchType: "none" });
  }, [qc, queryKey]);

  const inFlightSaveRef = useRef(false);
  const saveMutation = useMutation({
    mutationFn: async (body: string) => {
      await saveFn({ data: { courseId, lessonId, body } });
      return body;
    },
    onSuccess: (body) => {
      qc.setQueryData<LearnerNoteDTO | null>(queryKey, (prev) => ({
        id: prev?.id ?? "pending",
        course_id: courseId,
        lesson_id: lessonId,
        body,
        created_at: prev?.created_at ?? new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));
      setSavedFlash(true);
      setErrorMsg(null);
      setHasEdited(false);
      invalidateShared();
    },
    onError: (err) => {
      setErrorMsg(mapLearnerError(err));
      setSavedFlash(false);
      // remain dirty so the learner can retry
    },
    onSettled: () => {
      inFlightSaveRef.current = false;
    },
  });

  const doSave = () => {
    if (!canSave || inFlightSaveRef.current || saveMutation.isPending) return;
    inFlightSaveRef.current = true;
    setSavedFlash(false);
    setErrorMsg(null);
    saveMutation.mutate(draft);
  };

  const inFlightDeleteRef = useRef(false);
  const deleteMutation = useMutation({
    mutationFn: async () => deleteFn({ data: { lessonId } }),
    onSuccess: () => {
      qc.setQueryData<LearnerNoteDTO | null>(queryKey, null);
      setDraft("");
      setHasEdited(false);
      setSavedFlash(false);
      setErrorMsg(null);
      invalidateShared();
      toast.success("Note deleted.");
    },
    onError: (err) => {
      setErrorMsg(mapLearnerError(err));
    },
    onSettled: () => {
      inFlightDeleteRef.current = false;
    },
  });

  const onDelete = () => {
    if (inFlightDeleteRef.current || deleteMutation.isPending) return;
    inFlightDeleteRef.current = true;
    deleteMutation.mutate();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      doSave();
    }
  };

  const textareaId = `lesson-note-${lessonId}`;
  const errorId = `${textareaId}-error`;
  const statusId = `${textareaId}-status`;
  const remaining = MAX - draft.length;
  const nearLimit = remaining <= 400;

  return (
    <section
      aria-labelledby={`${textareaId}-heading`}
      className="mt-8 rounded-3xl bg-card p-6 ring-1 ring-border"
      data-testid="notes-panel"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id={`${textareaId}-heading`} className="text-lg font-bold">
          My notes
        </h2>
        {data && !isLoading && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button
                type="button"
                className="text-sm font-semibold text-muted-foreground underline underline-offset-4 hover:text-foreground min-h-11 px-2"
                aria-label="Delete note"
                data-testid="note-delete-trigger"
              >
                Delete
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this note?</AlertDialogTitle>
                <AlertDialogDescription>
                  This removes your note for this lesson. You can write a new one anytime.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={onDelete} data-testid="note-delete-confirm">
                  Delete note
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      <label htmlFor={textareaId} className="sr-only">
        Note for this lesson
      </label>
      {isLoading ? (
        <p role="status" className="mt-4 text-sm text-muted-foreground">
          Loading your note…
        </p>
      ) : (
        <textarea
          id={textareaId}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setHasEdited(true);
            setSavedFlash(false);
          }}
          onKeyDown={onKeyDown}
          placeholder={data ? "" : "Write a note for this lesson…"}
          aria-invalid={overLimit || undefined}
          aria-describedby={`${statusId}${errorMsg ? ` ${errorId}` : ""}`}
          className="mt-4 min-h-32 w-full resize-y rounded-2xl bg-background p-4 text-sm text-foreground ring-1 ring-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground"
          data-testid="note-textarea"
        />
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div
          id={statusId}
          className="text-xs text-muted-foreground"
          role="status"
          aria-live="polite"
          data-testid="note-status"
        >
          {saveMutation.isPending && "Saving…"}
          {!saveMutation.isPending && savedFlash && "Saved."}
          {!saveMutation.isPending && !savedFlash && isDirty && "Unsaved changes."}
          {!saveMutation.isPending && !savedFlash && !isDirty && data && "Saved."}
        </div>
        <div
          className={`text-xs ${nearLimit ? (overLimit ? "text-destructive" : "text-foreground") : "text-muted-foreground"}`}
          data-testid="note-counter"
          aria-live="polite"
        >
          {draft.length} / {MAX}
        </div>
      </div>

      {errorMsg && (
        <div
          id={errorId}
          role="alert"
          className="mt-3 rounded-2xl bg-destructive/10 px-4 py-3 text-sm text-destructive"
          data-testid="note-error"
        >
          {errorMsg}
        </div>
      )}

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={doSave}
          disabled={!canSave || saveMutation.isPending}
          className="inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm font-semibold text-background disabled:opacity-50 min-h-11"
          data-testid="note-save"
        >
          {saveMutation.isPending ? "Saving…" : "Save note"}
        </button>
        <span className="text-xs text-muted-foreground hidden sm:inline">
          Tip:{" "}
          {typeof navigator !== "undefined" && navigator.platform?.includes("Mac") ? "⌘" : "Ctrl"}
          +Enter to save
        </span>
      </div>
    </section>
  );
}
