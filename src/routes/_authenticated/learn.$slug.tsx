import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import {
  queryOptions,
  useSuspenseQuery,
  useMutation,
  useQueryClient,
  useQueryErrorResetBoundary,
} from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  PlayCircle,
  ChevronRight,
  ChevronLeft,
  Menu,
  Lock,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getLessonPlayer,
  getLessonVideoUrl,
  markLessonComplete,
  setLastLesson,
  type LessonPlayerResult,
  type PlayerLessonDTO,
} from "@/lib/courses.functions";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { BookmarkButton } from "@/components/lesson-tools/BookmarkButton";
import { NotesPanel } from "@/components/lesson-tools/NotesPanel";
import { UnsavedGuardProvider, useUnsavedGuard } from "@/components/lesson-tools/UnsavedGuard";

export const Route = createFileRoute("/_authenticated/learn/$slug")({
  head: () => ({
    meta: [
      { title: "Lesson player — Mozok" },
      { name: "description", content: "Play lessons and track your progress." },
      { property: "og:title", content: "Lesson player — Mozok" },
      { property: "og:description", content: "Play lessons on Mozok." },
      { name: "robots", content: "noindex" },
    ],
  }),
  validateSearch: (s: Record<string, unknown>) => ({
    lesson: typeof s.lesson === "string" ? s.lesson : undefined,
  }),
  component: Player,
  pendingComponent: () => (
    <div className="min-h-screen bg-background" role="status" aria-live="polite">
      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="h-4 w-24 rounded bg-secondary" />
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
          <div className="h-96 rounded-3xl bg-card" />
          <div className="h-96 rounded-3xl bg-card" />
        </div>
        <span className="sr-only">Loading lesson…</span>
      </div>
    </div>
  ),
  errorComponent: PlayerErrorComponent,
});

/**
 * Route error boundary for the lesson player.
 *
 * Retry follows the supported TanStack Query + Router pattern:
 *   - `useQueryErrorResetBoundary().reset()` clears Query's boundary state
 *     so the next `useSuspenseQuery` re-runs `queryFn` instead of re-throwing
 *     the cached error.
 *   - `reset()` clears the Router `CatchBoundary` so the route component
 *     re-mounts.
 *   - `router.invalidate({ forcePending: true })` re-runs the route loader
 *     (which primes the Query cache) so the player receives fresh data.
 *
 * No raw error surface is exposed: `error.message`, `error.name`, and any
 * SQL/PostgREST/policy/table/function details never render.
 */
export function PlayerErrorComponent({ reset }: { error: Error; reset: () => void }) {
  const queryErrorReset = useQueryErrorResetBoundary();
  const router = useRouter();
  const onRetry = () => {
    queryErrorReset.reset();
    reset();
    router.invalidate({ forcePending: true });
  };
  return (
    <div className="min-h-screen grid place-items-center bg-background">
      <div className="rounded-3xl bg-card p-10 text-center max-w-md" role="alert">
        <h1 className="text-2xl font-bold">We couldn't load this lesson</h1>
        <p className="mt-2 text-muted-foreground">
          Something went wrong loading this lesson. Please try again.
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-6 inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm font-semibold text-background"
        >
          Retry
        </button>
      </div>
    </div>
  );
}

function Player() {
  const { slug } = Route.useParams();
  const { lesson: lessonId } = Route.useSearch();
  return <PlayerBody slug={slug} lessonId={lessonId} />;
}

/**
 * The single rendered player surface. The route wrapper (`Player`) reads
 * `slug`/`lessonId` from Route hooks and forwards them here. Exported so
 * component tests can render the same component the app uses without
 * duplicating logic.
 */
export function PlayerBody({ slug, lessonId }: { slug: string; lessonId?: string }) {
  return (
    <UnsavedGuardProvider>
      <PlayerBodyInner slug={slug} lessonId={lessonId} />
    </UnsavedGuardProvider>
  );
}

function PlayerBodyInner({ slug, lessonId }: { slug: string; lessonId?: string }) {
  const fetchPlayer = useServerFn(getLessonPlayer);
  const markDone = useServerFn(markLessonComplete);
  const persistLast = useServerFn(setLastLesson);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [mobileOpen, setMobileOpen] = useState(false);
  // Accessible completion status. Authoritative source for a11y regardless
  // of whether the toast is visible. Cleared on lesson change and on retry.
  const [completionStatus, setCompletionStatus] = useState<"idle" | "saving" | "saved" | "failed">(
    "idle",
  );
  // Call useUnsavedGuard unconditionally at the top level so hook order
  // stays stable across non-ready ↔ ready transitions. The guard is a
  // no-op until a child component registers a dirty checker (NotesPanel),
  // which itself is only mounted in the trackable ready state.
  const { guard } = useUnsavedGuard();

  const q = queryOptions({
    queryKey: ["lesson-player", slug, lessonId ?? "resume"] as const,
    queryFn: () => fetchPlayer({ data: { slug, lessonId } }),
  });
  const { data } = useSuspenseQuery(q);

  // Track a single in-flight completion request (in addition to disabled UI)
  // so rapid clicks or keyboard activations coalesce into one network call.
  const inFlightRef = useRef(false);
  const mutation = useMutation({
    mutationFn: (input: { lessonId: string; courseId: string }) => markDone({ data: input }),
    onMutate: () => {
      // Starting (or retrying) a completion clears any prior failure message.
      setCompletionStatus("saving");
    },
    onSuccess: (res) => {
      setCompletionStatus("saved");
      toast.success(`Lesson complete — ${res.progress}%`);
      qc.invalidateQueries({ queryKey: ["lesson-player", slug] });
      qc.invalidateQueries({ queryKey: ["my-enrollments"] });
      qc.invalidateQueries({ queryKey: ["learner-dashboard"], refetchType: "none" });
    },
    onError: () => {
      // Stable learner copy — never surface raw server/database error text.
      setCompletionStatus("failed");
      toast.error("We couldn't save your progress. Please try again.");
    },
    onSettled: () => {
      inFlightRef.current = false;
    },
  });

  const handleComplete = (courseId: string, currentLessonId: string) => {
    if (inFlightRef.current || mutation.isPending) return;
    inFlightRef.current = true;
    mutation.mutate({ lessonId: currentLessonId, courseId });
  };

  // Navigating to another lesson clears stale completion messaging.
  const currentLessonKey = data.state === "ready" ? data.current.id : null;
  useEffect(() => {
    setCompletionStatus("idle");
  }, [currentLessonKey]);

  // URL replace-once on server-resolved resume. Runs when the URL has no
  // explicit ?lesson and the server picked a lesson (ready state).
  const urlSyncedRef = useRef<string | null>(null);
  useEffect(() => {
    if (data.state !== "ready") return;
    if (lessonId) return;
    const target = data.current.id;
    if (urlSyncedRef.current === target) return;
    urlSyncedRef.current = target;
    navigate({
      to: "/learn/$slug",
      params: { slug },
      search: { lesson: target },
      replace: true,
    });
  }, [data, lessonId, navigate, slug]);

  // Persist last-lesson only for a trackable learner and only once per
  // stable (course, lesson) pair. Failures are silent — no console.error,
  // no toast, and never block rendering.
  const lastPersistedRef = useRef<string | null>(null);
  useEffect(() => {
    if (data.state !== "ready") return;
    if (!data.canTrackProgress) return;
    const key = `${data.course.id}:${data.current.id}`;
    if (lastPersistedRef.current === key) return;
    lastPersistedRef.current = key;
    persistLast({ data: { courseId: data.course.id, lessonId: data.current.id } })
      .then(() => {
        // Mark dashboard cache stale so the next mount reflects the new
        // last_lesson_id; no active refetch is forced.
        qc.invalidateQueries({ queryKey: ["learner-dashboard"], refetchType: "none" });
      })
      .catch(() => {
        // Intentionally silent; do not surface as a fake failure.
      });
  }, [data, persistLast, qc]);

  // ----- Non-ready states -----
  if (data.state === "course_not_found_or_hidden") {
    return (
      <StateShell
        title="Course unavailable"
        message="This course isn't available or hasn't been published yet."
        cta={{ label: "Browse courses", to: "/browse" }}
      />
    );
  }

  if (data.state === "empty_curriculum") {
    return (
      <StateShell
        title="No lessons yet"
        message="This course doesn't have any lessons available."
        cta={{ label: "My learning", to: "/learn" }}
      />
    );
  }

  if (data.state === "no_preview_available") {
    // Message follows canSelfEnroll — neutral copy covers paid unenrolled,
    // historical paid enrollments, and any other non-self-enroll path.
    const canEnroll = data.canSelfEnroll;
    return (
      <StateShell
        title="No preview available"
        message={canEnroll ? "Enroll to unlock the course." : "Full access isn't available yet."}
        cta={
          canEnroll
            ? { label: "Go to course", to: "/courses/$slug", params: { slug } }
            : { label: "My learning", to: "/learn" }
        }
      />
    );
  }

  if (data.state === "protected_lesson_requested") {
    // Copy is gated by canSelfEnroll so we never suggest enrollment when it
    // wouldn't grant access (paid course, historical paid enrollment, or
    // anyone with no self-enroll path).
    if (data.canSelfEnroll) {
      return (
        <StateShell
          title="Lesson locked"
          message="Enroll to unlock this lesson."
          cta={{ label: "Go to course", to: "/courses/$slug", params: { slug } }}
        />
      );
    }
    return (
      <StateShell
        title="Lesson locked"
        message="This lesson isn't available with your current access."
        cta={{ label: "My learning", to: "/learn" }}
      />
    );
  }

  if (data.state === "requested_lesson_unavailable") {
    return (
      <StateShell
        title="Lesson not found"
        message="We couldn't find that lesson in this course."
        cta={{ label: "Open course", to: "/learn/$slug", params: { slug } }}
      />
    );
  }

  // ----- Ready state -----
  const {
    course,
    lessons,
    current,
    completedLessonIds,
    prevId,
    nextId,
    entitlement,
    isEnrolled,
    canTrackProgress: track,
    progress,
    courseComplete,
    canSelfEnroll,
  } = data;
  const completed = new Set(completedLessonIds);
  const isDone = completed.has(current.id);
  const pct = progress ?? 0;
  const isCourseComplete = courseComplete;

  const goToLesson = (id: string) => {
    setMobileOpen(false);
    navigate({ to: "/learn/$slug", params: { slug }, search: { lesson: id } });
  };
  const guardedGoToLesson = (id: string) => guard(() => goToLesson(id));
  const guardedGoMyLearning = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    guard(() => navigate({ to: "/learn" }));
  };

  const curriculumList = (
    <CurriculumList
      lessons={lessons}
      currentId={current.id}
      completed={completed}
      onSelect={guardedGoToLesson}
      showProgress={track}
      pct={pct}
    />
  );

  return (
    <div className="min-h-screen bg-background" style={{ fontFamily: "Poppins, sans-serif" }}>
      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="flex items-center justify-between">
          <Link
            to="/learn"
            onClick={guardedGoMyLearning}
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground rounded-full px-2 py-1"
          >
            <ArrowLeft className="h-4 w-4" /> My learning
          </Link>
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <button
                type="button"
                aria-label="Open curriculum"
                className="lg:hidden inline-flex h-11 w-11 items-center justify-center rounded-full bg-card"
              >
                <Menu className="h-5 w-5" />
              </button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[86vw] max-w-sm overflow-y-auto">
              <SheetHeader>
                <SheetTitle>Curriculum</SheetTitle>
              </SheetHeader>
              <div className="mt-4">{curriculumList}</div>
            </SheetContent>
          </Sheet>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
          <main className="rounded-3xl bg-card p-8">
            <div className="text-xs font-semibold uppercase tracking-wider text-foreground">
              {course.category} • {course.title}
            </div>
            {/* Focused live region: announces lesson-title changes only. */}
            <h1
              className="mt-2 text-3xl font-bold md:text-4xl focus:outline-none"
              tabIndex={-1}
              aria-live="polite"
            >
              {current.title}
            </h1>

            {entitlement === "preview" && !isEnrolled && (
              <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-secondary px-3 py-1 text-xs font-semibold">
                <Lock className="h-3.5 w-3.5" /> Preview lesson
              </p>
            )}
            {entitlement === "preview" && isEnrolled && (
              <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-secondary px-3 py-1 text-xs font-semibold">
                <Lock className="h-3.5 w-3.5" /> Preview lesson
              </p>
            )}

            <div className="mt-6 aspect-video overflow-hidden rounded-2xl bg-foreground grid place-items-center">
              <LessonVideo slug={slug} lesson={current} />
            </div>

            {current.content ? (
              <div className="mt-6 whitespace-pre-line text-foreground leading-relaxed">
                {current.content}
              </div>
            ) : (
              !current.has_video && (
                <p className="mt-6 text-sm text-muted-foreground">
                  Content for this lesson isn't available yet.
                </p>
              )
            )}

            {isCourseComplete && (
              <div
                role="status"
                className="mt-6 rounded-2xl border border-border bg-secondary p-5"
                aria-live="polite"
              >
                <h2 className="text-lg font-bold">Course complete</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  You've completed every lesson in this course.
                </p>
              </div>
            )}

            <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-6">
              {/* Visually-hidden completion status: authoritative a11y
                  announcements independent of any toast. Success uses
                  role=status/polite; failure uses role=alert. Cleared on
                  lesson change and on retry. */}
              <div
                className="sr-only"
                role="status"
                aria-live="polite"
                data-testid="completion-status-polite"
              >
                {completionStatus === "saving" && "Saving your progress."}
                {completionStatus === "saved" && "Lesson complete. Progress saved."}
              </div>
              <div className="sr-only" role="alert" data-testid="completion-status-alert">
                {completionStatus === "failed" &&
                  "We couldn't save your progress. Please try again."}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => prevId && guardedGoToLesson(prevId)}
                  disabled={!prevId}
                  className="inline-flex items-center gap-2 rounded-full bg-card px-4 py-2.5 text-sm font-semibold text-foreground disabled:opacity-40 min-h-11"
                  aria-label="Previous lesson"
                >
                  <ChevronLeft className="h-4 w-4" /> Previous
                </button>
                <button
                  type="button"
                  onClick={() => nextId && guardedGoToLesson(nextId)}
                  disabled={!nextId}
                  className="inline-flex items-center gap-2 rounded-full bg-card px-4 py-2.5 text-sm font-semibold text-foreground disabled:opacity-40 min-h-11"
                  aria-label="Next lesson"
                >
                  Next <ChevronRight className="h-4 w-4" />
                </button>
              </div>

              {track ? (
                <button
                  type="button"
                  onClick={() => handleComplete(course.id, current.id)}
                  disabled={mutation.isPending || isDone}
                  aria-live="polite"
                  className={`inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition min-h-11 ${
                    isDone
                      ? "bg-secondary text-foreground"
                      : "bg-foreground text-background hover:brightness-110"
                  } disabled:opacity-70`}
                >
                  <CheckCircle2 className="h-4 w-4" />{" "}
                  {isDone ? "Completed" : mutation.isPending ? "Saving…" : "Mark complete"}
                </button>
              ) : (
                canSelfEnroll && (
                  <Link
                    to="/courses/$slug"
                    params={{ slug }}
                    className="inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm font-semibold text-background min-h-11"
                  >
                    Enroll to unlock full course
                  </Link>
                )
              )}
            </div>

            {track && (
              <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-border pt-6">
                <BookmarkButton courseId={course.id} lessonId={current.id} />
              </div>
            )}
            {track && (
              <NotesPanel
                key={`${course.id}:${current.id}`}
                courseId={course.id}
                lessonId={current.id}
              />
            )}
          </main>

          <aside className="hidden lg:block rounded-3xl bg-card p-6">{curriculumList}</aside>
        </div>
      </div>
    </div>
  );
}

function CurriculumList({
  lessons,
  currentId,
  completed,
  onSelect,
  showProgress,
  pct,
}: {
  lessons: PlayerLessonDTO[];
  currentId: string;
  completed: Set<string>;
  onSelect: (id: string) => void;
  showProgress: boolean;
  pct: number;
}) {
  return (
    <div>
      {showProgress && (
        <>
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold">Course progress</h3>
            <span className="text-sm font-semibold text-foreground">{pct}%</span>
          </div>
          <div
            className="mt-3 h-2 w-full overflow-hidden rounded-full bg-secondary"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
          >
            <div
              className="h-full rounded-full bg-foreground transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
        </>
      )}
      {!showProgress && <h3 className="text-lg font-bold">Curriculum</h3>}
      <ul className="mt-6 space-y-1">
        {lessons.map((l) => {
          const done = completed.has(l.id);
          const active = l.id === currentId;
          return (
            <li key={l.id}>
              <button
                type="button"
                onClick={() => onSelect(l.id)}
                aria-current={active ? "true" : undefined}
                className={`flex w-full items-center gap-3 rounded-2xl p-3 text-left transition min-h-11 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground ${
                  active ? "bg-background" : "hover:bg-background"
                }`}
              >
                {done ? (
                  <CheckCircle2 className="h-5 w-5 text-foreground" aria-hidden />
                ) : (
                  <Circle className="h-5 w-5 text-muted-foreground/50" aria-hidden />
                )}
                <div className="flex-1 min-w-0">
                  <div className={`text-sm ${active ? "font-semibold" : ""} truncate`}>
                    {l.title}
                  </div>
                  {l.duration_seconds ? (
                    <div className="text-xs text-muted-foreground">
                      {Math.round(l.duration_seconds / 60)} min
                    </div>
                  ) : null}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function StateShell({
  title,
  message,
  cta,
}: {
  title: string;
  message: string;
  cta: { label: string; to: string; params?: Record<string, string> };
}) {
  return (
    <div className="min-h-screen grid place-items-center bg-background">
      <div className="rounded-3xl bg-card p-10 text-center max-w-md">
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="mt-2 text-muted-foreground">{message}</p>
        <Link
          to={cta.to as "/browse"}
          params={cta.params as { slug: string } | undefined}
          className="mt-6 inline-block rounded-full bg-foreground px-6 py-3 text-sm font-semibold text-background"
        >
          {cta.label}
        </Link>
      </div>
    </div>
  );
}

// Re-export type-only symbol used above (helps tree-shaking checks).
export type { LessonPlayerResult };

// ============ LessonVideo — signed URL state machine ============
//
// Fetches a short-lived signed URL for the current lesson's private video
// object. Behaviour contract (P0C.3 Checkpoint 3):
//   - No fetch when the lesson has no video (`has_video === false`).
//   - The signed URL never enters query keys, router search params,
//     localStorage, error messages, or the console. It lives only in this
//     component's local state and disappears on unmount / lesson change.
//   - Stale responses (from a previous lessonId or request generation) are
//     ignored via a monotonically-increasing request id.
//   - The URL is refreshed ~30s before expiry.
//   - On media/network `error`, we automatically re-sign exactly once. A
//     second failure lands in the stable "failed" state with a manual
//     Retry action. Retry re-arms the single auto-retry budget.
//   - Refresh timers are cleared on lesson change and unmount.
//   - The video element preserves `currentTime` and playing state across
//     silent refreshes.
function LessonVideo({ slug, lesson }: { slug: string; lesson: PlayerLessonDTO }) {
  const signFn = useServerFn(getLessonVideoUrl);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "failed">(
    lesson.has_video ? "loading" : "idle",
  );
  const [url, setUrl] = useState<string | null>(null);

  const requestIdRef = useRef(0);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoRetryUsedRef = useRef(false);
  const mountedRef = useRef(true);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const preservedTimeRef = useRef(0);
  const preservedPausedRef = useRef(true);

  const clearRefreshTimer = useCallback(() => {
    if (refreshTimerRef.current !== null) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
  }, []);

  const load = useCallback(async () => {
    const myId = ++requestIdRef.current;
    if (mountedRef.current) setState("loading");
    try {
      const res = await signFn({ data: { slug, lessonId: lesson.id } });
      if (myId !== requestIdRef.current || !mountedRef.current) return;
      setUrl(res.signedUrl);
      setState("ready");
      clearRefreshTimer();
      const msUntilRefresh = Math.max(1000, res.expiresAt - Date.now() - 30_000);
      refreshTimerRef.current = setTimeout(() => {
        void load();
      }, msUntilRefresh);
    } catch {
      if (myId !== requestIdRef.current || !mountedRef.current) return;
      setUrl(null);
      setState("failed");
      clearRefreshTimer();
    }
  }, [signFn, slug, lesson.id, clearRefreshTimer]);

  // Reset on lesson change and mount.
  useEffect(() => {
    mountedRef.current = true;
    // Bump the generation counter so any in-flight promise resolves stale.
    requestIdRef.current += 1;
    clearRefreshTimer();
    setUrl(null);
    autoRetryUsedRef.current = false;
    preservedTimeRef.current = 0;
    preservedPausedRef.current = true;
    if (!lesson.has_video) {
      setState("idle");
      return () => {
        clearRefreshTimer();
      };
    }
    void load();
    return () => {
      clearRefreshTimer();
    };
  }, [lesson.id, lesson.has_video, load, clearRefreshTimer]);

  // Unmount cleanup.
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      clearRefreshTimer();
    };
  }, [clearRefreshTimer]);

  // Preserve currentTime / playing state across a silent refresh.
  useEffect(() => {
    if (state !== "ready" || !url) return;
    const el = videoRef.current;
    if (!el) return;
    const t = preservedTimeRef.current;
    if (t > 0) {
      try {
        el.currentTime = t;
      } catch {
        // Some browsers throw before metadata is loaded; ignore.
      }
    }
    if (!preservedPausedRef.current) {
      el.play().catch(() => {
        // Autoplay may be blocked; the user can resume manually.
      });
    }
  }, [state, url]);

  const handleTimeUpdate: React.ReactEventHandler<HTMLVideoElement> = () => {
    const el = videoRef.current;
    if (el && Number.isFinite(el.currentTime)) preservedTimeRef.current = el.currentTime;
  };
  const handlePlay = () => {
    preservedPausedRef.current = false;
  };
  const handlePause = () => {
    preservedPausedRef.current = true;
  };
  const handleError: React.ReactEventHandler<HTMLVideoElement> = () => {
    if (!autoRetryUsedRef.current) {
      autoRetryUsedRef.current = true;
      void load();
    } else {
      setUrl(null);
      setState("failed");
      clearRefreshTimer();
    }
  };

  if (!lesson.has_video) {
    return (
      <div className="text-center text-background/70" data-testid="video-empty">
        <PlayCircle className="mx-auto h-20 w-20" />
        <p className="mt-2 text-sm">No video for this lesson</p>
      </div>
    );
  }

  if (state === "loading") {
    return (
      <div
        className="text-center text-background/70"
        role="status"
        aria-live="polite"
        data-testid="video-loading"
      >
        <p className="text-sm">Loading video…</p>
      </div>
    );
  }

  if (state === "failed" || !url) {
    return (
      <div className="text-center text-background/70" role="alert" data-testid="video-failed">
        <p className="text-sm">Video is temporarily unavailable.</p>
        <button
          type="button"
          onClick={() => {
            autoRetryUsedRef.current = false;
            void load();
          }}
          data-testid="video-retry"
          className="mt-3 inline-flex items-center gap-2 rounded-full bg-background px-4 py-2 text-sm font-semibold text-foreground min-h-11"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <video
      ref={videoRef}
      key={lesson.id}
      src={url}
      controls
      className="h-full w-full"
      aria-label={`Video: ${lesson.title}`}
      onTimeUpdate={handleTimeUpdate}
      onPlay={handlePlay}
      onPause={handlePause}
      onError={handleError}
      data-testid="video-element"
    />
  );
}
