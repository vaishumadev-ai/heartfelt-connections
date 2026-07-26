import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { listMyEnrollments } from "@/lib/courses.functions";

function makeQuery(fn: () => Promise<Awaited<ReturnType<typeof listMyEnrollments>>>) {
  return queryOptions({ queryKey: ["my-enrollments"], queryFn: fn });
}

export const Route = createFileRoute("/_authenticated/learn")({
  head: () => ({
    meta: [
      { title: "My learning — Mozok" },
      { name: "description", content: "Continue your enrolled courses." },
      { property: "og:title", content: "My learning — Mozok" },
      { property: "og:description", content: "Your enrolled courses on Mozok." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: LearnPage,
  errorComponent: ({ error }) => (
    <div className="p-8" role="alert">
      {error.message}
    </div>
  ),
});

function LearnPage() {
  const fetchFn = useServerFn(listMyEnrollments);
  const { data } = useSuspenseQuery(makeQuery(fetchFn));
  return (
    <div className="min-h-screen bg-background" style={{ fontFamily: "Poppins, sans-serif" }}>
      <div className="mx-auto max-w-6xl px-6 py-10">
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-black"
        >
          <ArrowLeft className="h-4 w-4" /> Dashboard
        </Link>
        <h1 className="mt-6 text-4xl font-bold md:text-5xl">My learning</h1>
        <p className="mt-2 text-muted-foreground">
          {data.length} course{data.length === 1 ? "" : "s"} enrolled
        </p>
        {data.length === 0 ? (
          <div className="mt-10 rounded-3xl bg-card p-10 text-center">
            <p className="text-muted-foreground">You haven't enrolled in any courses yet.</p>
            <Link
              to="/browse"
              className="mt-4 inline-block rounded-full bg-foreground px-6 py-3 text-sm font-semibold text-background"
            >
              Browse courses
            </Link>
          </div>
        ) : (
          <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {data.map(
              (e) =>
                e.course && (
                  <Link
                    key={e.course.id}
                    to="/learn/$slug"
                    params={{ slug: e.course.slug }}
                    search={{ lesson: undefined }}
                    className="group block rounded-3xl bg-card p-6 transition hover:-translate-y-1"
                  >
                    <div className="text-xs font-semibold uppercase tracking-wider text-foreground">
                      {e.course.category}
                    </div>
                    <h3 className="mt-2 text-xl font-bold">{e.course.title}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{e.course.subtitle}</p>
                    <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-secondary">
                      <div
                        className="h-full rounded-full bg-foreground transition-all"
                        style={{ width: `${e.progress}%` }}
                      />
                    </div>
                    <div className="mt-4 flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{e.progress}% complete</span>
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-foreground text-background transition-transform group-hover:translate-x-1">
                        <ArrowRight className="h-4 w-4" />
                      </span>
                    </div>
                  </Link>
                ),
            )}
          </div>
        )}
      </div>
    </div>
  );
}
