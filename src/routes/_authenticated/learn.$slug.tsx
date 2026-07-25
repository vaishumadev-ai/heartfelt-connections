import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
import { useEffect, useRef, useState } from "react";
import {
  getLessonPlayer,
  markLessonComplete,
  setLastLesson,
  type LessonPlayerResult,
  type PlayerLessonDTO,
} from "@/lib/courses.functions";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

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
  errorComponent: ({ error, reset }) => (
    <div className="min-h-screen grid place-items-center bg-background">
      <div className="rounded-3xl bg-card p-10 text-center max-w-md" role="alert">
        <h1 className="text-2xl font-bold">We couldn't load this lesson</h1>
        <p className="mt-2 text-muted-foreground">{error.message}</p>
        <button
          onClick={() => reset()}
          className="mt-6 inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm font-semibold text-background"
        >
          Retry
        </button>
      </div>
    </div>
  ),
});

function Player() {
  const { slug } = Route.useParams();
  const { lesson: lessonId } = Route.useSearch();
  const fetchPlayer = useServerFn(getLessonPlayer);
  const markDone = useServerFn(markLessonComplete);
  const persistLast = useServerFn(setLastLesson);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [mobileOpen, setMobileOpen] = useState(false);

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
    onSuccess: (res) => {
      toast.success(`Lesson complete — ${res.progress}%`);
      qc.invalidateQueries({ queryKey: ["lesson-player", slug] });
      qc.invalidateQueries({ queryKey: ["my-enrollments"] });
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => {
      inFlightRef.current = false;
    },
  });

  const handleComplete = (courseId: string, currentLessonId: string) => {
    if (inFlightRef.current || mutation.isPending) return;
    inFlightRef.current = true;
    mutation.mutate({ lessonId: currentLessonId, courseId });
  };

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
    persistLast({ data: { courseId: data.course.id, lessonId: data.current.id } }).catch(() => {
      // Intentionally silent; do not surface as a fake failure.
    });
  }, [data, persistLast]);

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
    return (
      <StateShell
        title="No preview available"
        message="Enroll to unlock the full course content."
        cta={{ label: "Go to course", to: "/courses/$slug", params: { slug } }}
      />
    );
  }

  if (data.state === "protected_lesson_requested") {
    return (
      <StateShell
        title="Lesson locked"
        message="This lesson requires enrollment. Preview lessons remain available."
        cta={{ label: "Go to course", to: "/courses/$slug", params: { slug } }}
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
  const { course, lessons, current, completedLessonIds, prevId, nextId, entitlement, isEnrolled, canTrackProgress: track, progress } = data;
  const completed = new Set(completedLessonIds);
  const isDone = completed.has(current.id);
  const pct = progress ?? 0;
  const isCourseComplete = track && lessons.length > 0 && completedLessonIds.length >= lessons.length;

  const goToLesson = (id: string) => {
    setMobileOpen(false);
    navigate({ to: "/learn/$slug", params: { slug }, search: { lesson: id } });
  };

  const curriculumList = (
    <CurriculumList
      lessons={lessons}
      currentId={current.id}
      completed={completed}
      onSelect={goToLesson}
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
          <main className="rounded-3xl bg-card p-8" aria-live="polite">
            <div className="text-xs font-semibold uppercase tracking-wider text-foreground">
              {course.category} • {course.title}
            </div>
            <h1 className="mt-2 text-3xl font-bold md:text-4xl">{current.title}</h1>

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
              {current.video_url ? (
                <video
                  key={current.id}
                  src={current.video_url}
                  controls
                  className="h-full w-full"
                  aria-label={`Video: ${current.title}`}
                />
              ) : (
                <div className="text-center text-background/70">
                  <PlayCircle className="mx-auto h-20 w-20" />
                  <p className="mt-2 text-sm">No video for this lesson</p>
                </div>
              )}
            </div>

            {current.content ? (
              <div className="mt-6 whitespace-pre-line text-foreground leading-relaxed">
                {current.content}
              </div>
            ) : (
              !current.video_url && (
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
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => prevId && goToLesson(prevId)}
                  disabled={!prevId}
                  className="inline-flex items-center gap-2 rounded-full bg-card px-4 py-2.5 text-sm font-semibold text-foreground disabled:opacity-40 min-h-11"
                  aria-label="Previous lesson"
                >
                  <ChevronLeft className="h-4 w-4" /> Previous
                </button>
                <button
                  type="button"
                  onClick={() => nextId && goToLesson(nextId)}
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
                !isEnrolled && (
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
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-secondary" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <div className="h-full rounded-full bg-foreground transition-all" style={{ width: `${pct}%` }} />
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
                  <div className={`text-sm ${active ? "font-semibold" : ""} truncate`}>{l.title}</div>
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