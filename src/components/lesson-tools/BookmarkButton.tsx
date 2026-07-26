import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bookmark, BookmarkCheck } from "lucide-react";
import { useRef } from "react";
import { toast } from "sonner";
import {
  addLessonBookmark,
  getLessonBookmark,
  removeLessonBookmark,
  type LearnerBookmarkDTO,
} from "@/lib/learner.functions";
import { mapLearnerError } from "@/lib/learner-errors";

export function BookmarkButton({ courseId, lessonId }: { courseId: string; lessonId: string }) {
  const qc = useQueryClient();
  const fetchBookmark = useServerFn(getLessonBookmark);
  const addFn = useServerFn(addLessonBookmark);
  const removeFn = useServerFn(removeLessonBookmark);

  const queryKey = ["lesson-bookmark", courseId, lessonId] as const;
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => fetchBookmark({ data: { lessonId } }),
    staleTime: 30_000,
  });

  const inFlightRef = useRef(false);
  const isBookmarked = !!data;

  const invalidateShared = () => {
    qc.invalidateQueries({ queryKey });
    // Mark the dashboard cache stale without forcing an active refetch when
    // the dashboard is unmounted (refetchType: "none").
    qc.invalidateQueries({ queryKey: ["learner-dashboard"], refetchType: "none" });
  };

  const mutation = useMutation({
    mutationFn: async (nextOn: boolean) => {
      if (nextOn) {
        await addFn({ data: { courseId, lessonId } });
      } else {
        await removeFn({ data: { lessonId } });
      }
      return nextOn;
    },
    onSuccess: (nextOn) => {
      // Authoritative update after RPC success — no false optimism.
      qc.setQueryData<LearnerBookmarkDTO | null>(queryKey, () =>
        nextOn
          ? {
              id: "pending",
              course_id: courseId,
              lesson_id: lessonId,
              created_at: new Date().toISOString(),
            }
          : null,
      );
      invalidateShared();
    },
    onError: (err) => {
      toast.error(mapLearnerError(err));
      // Prior authoritative state is retained; refresh to be safe.
      qc.invalidateQueries({ queryKey });
    },
    onSettled: () => {
      inFlightRef.current = false;
    },
  });

  const onClick = () => {
    if (inFlightRef.current || mutation.isPending || isLoading) return;
    inFlightRef.current = true;
    mutation.mutate(!isBookmarked);
  };

  const label = isBookmarked ? "Remove bookmark" : "Bookmark this lesson";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isBookmarked}
      aria-label={label}
      disabled={isLoading || mutation.isPending}
      data-testid="bookmark-button"
      className={`inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold transition min-h-11 min-w-11 ${
        isBookmarked
          ? "bg-foreground text-background"
          : "bg-card text-foreground ring-1 ring-border hover:bg-secondary"
      } disabled:opacity-70`}
    >
      {isBookmarked ? (
        <BookmarkCheck className="h-4 w-4" aria-hidden />
      ) : (
        <Bookmark className="h-4 w-4" aria-hidden />
      )}
      <span>{isBookmarked ? "Bookmarked" : "Bookmark"}</span>
    </button>
  );
}