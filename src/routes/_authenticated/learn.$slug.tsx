import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, CheckCircle2, Circle, PlayCircle, ChevronRight } from "lucide-react";
import { getLessonPlayer, markLessonComplete } from "@/lib/courses.functions";
import { toast } from "sonner";

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
  validateSearch: (s: Record<string, unknown>) => ({ lesson: typeof s.lesson === "string" ? s.lesson : undefined }),
  component: Player,
  errorComponent: ({ error }) => <div className="p-8" role="alert">{error.message}</div>,
});

function Player() {
  const { slug } = Route.useParams();
  const { lesson: lessonId } = Route.useSearch();
  const fetchPlayer = useServerFn(getLessonPlayer);
  const markDone = useServerFn(markLessonComplete);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const q = queryOptions({
    queryKey: ["lesson-player", slug, lessonId ?? "first"],
    queryFn: () => fetchPlayer({ data: { slug, lessonId } }),
  });
  const { data } = useSuspenseQuery(q);

  const mutation = useMutation({
    mutationFn: (input: { lessonId: string; courseId: string }) => markDone({ data: input }),
    onSuccess: (res) => {
      toast.success(`Lesson complete — ${res.progress}%`);
      qc.invalidateQueries({ queryKey: ["lesson-player", slug] });
      qc.invalidateQueries({ queryKey: ["my-enrollments"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!data) {
    return (
      <div className="min-h-screen grid place-items-center bg-background">
        <div className="text-center">
          <h1 className="text-2xl font-bold">No lessons available</h1>
          <Link to="/browse" className="mt-4 inline-block rounded-full bg-black px-5 py-2 text-sm text-background">Browse courses</Link>
        </div>
      </div>
    );
  }

  if (!data.enrolled) {
    return (
      <div className="min-h-screen grid place-items-center bg-background">
        <div className="rounded-3xl bg-card p-10 text-center">
          <h1 className="text-2xl font-bold">Enroll to start learning</h1>
          <p className="mt-2 text-muted-foreground">You need to enroll in this course first.</p>
          <Link to="/courses/$slug" params={{ slug }} className="mt-4 inline-block rounded-full bg-foreground px-6 py-3 text-sm font-semibold text-background">Go to course</Link>
        </div>
      </div>
    );
  }

  const { course, lessons, current, completedIds } = data;
  const completed = new Set(completedIds);
  const idx = lessons.findIndex((l) => l.id === current.id);
  const next = lessons[idx + 1];
  const isDone = completed.has(current.id);
  const doneCount = completedIds.length;
  const pct = Math.round((doneCount / lessons.length) * 100);

  return (
    <div className="min-h-screen bg-background" style={{ fontFamily: "Poppins, sans-serif" }}>
      <div className="mx-auto max-w-7xl px-6 py-8">
        <Link to="/learn" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-black"><ArrowLeft className="h-4 w-4" /> My learning</Link>
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
          <main className="rounded-3xl bg-card p-8">
            <div className="text-xs font-semibold uppercase tracking-wider text-foreground">{course.category} • {course.title}</div>
            <h1 className="mt-2 text-3xl font-bold md:text-4xl">{current.title}</h1>
            <div className="mt-6 aspect-video overflow-hidden rounded-2xl bg-foreground   grid place-items-center">
              {current.video_url ? (
                <video src={current.video_url} controls className="h-full w-full" />
              ) : (
                <PlayCircle className="h-20 w-20 text-background/70" />
              )}
            </div>
            {current.content && (
              <div className="mt-6 whitespace-pre-line text-foreground leading-relaxed">{current.content}</div>
            )}
            <div className="mt-8 flex items-center justify-between border-t border-border pt-6">
              <button
                onClick={() => mutation.mutate({ lessonId: current.id, courseId: course.id })}
                disabled={mutation.isPending || isDone}
                className={`inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition ${isDone ? "bg-secondary text-foreground" : "bg-foreground text-background hover:brightness-110"} disabled:opacity-70`}
              >
                <CheckCircle2 className="h-4 w-4" /> {isDone ? "Completed" : mutation.isPending ? "Saving..." : "Mark complete"}
              </button>
              {next && (
                <button
                  onClick={() => navigate({ to: "/learn/$slug", params: { slug }, search: { lesson: next.id } })}
                  className="inline-flex items-center gap-2 rounded-full bg-black px-5 py-2.5 text-sm font-semibold text-background"
                >
                  Next lesson <ChevronRight className="h-4 w-4" />
                </button>
              )}
            </div>
          </main>
          <aside className="rounded-3xl bg-card p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold">Course progress</h3>
              <span className="text-sm font-semibold text-foreground">{pct}%</span>
            </div>
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-secondary">
              <div className="h-full rounded-full bg-foreground transition-all" style={{ width: `${pct}%` }} />
            </div>
            <ul className="mt-6 space-y-1">
              {lessons.map((l) => {
                const done = completed.has(l.id);
                const active = l.id === current.id;
                return (
                  <li key={l.id}>
                    <button
                      onClick={() => navigate({ to: "/learn/$slug", params: { slug }, search: { lesson: l.id } })}
                      className={`flex w-full items-center gap-3 rounded-2xl p-3 text-left transition ${active ? "bg-background" : "hover:bg-background"}`}
                    >
                      {done ? <CheckCircle2 className="h-5 w-5 text-foreground" /> : <Circle className="h-5 w-5 text-muted-foreground/50" />}
                      <div className="flex-1 min-w-0">
                        <div className={`text-sm ${active ? "font-semibold" : ""} truncate`}>{l.title}</div>
                        {l.duration_seconds && <div className="text-xs text-muted-foreground">{Math.round(l.duration_seconds / 60)} min</div>}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </aside>
        </div>
      </div>
    </div>
  );
}