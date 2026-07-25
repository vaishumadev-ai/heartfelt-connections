import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { ArrowLeft, Play, Heart, Clock, CheckCircle2 } from "lucide-react";
import { getCourseBySlug, enrollInCourse, type CourseDetail } from "@/lib/courses.functions";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { CourseReviews } from "@/components/CourseReviews";

const courseQuery = (slug: string) =>
  queryOptions({
    queryKey: ["course", slug],
    queryFn: () => getCourseBySlug({ data: { slug } }),
  });

export const Route = createFileRoute("/courses/$slug")({
  head: ({ loaderData }) => {
    const c = loaderData as CourseDetail | undefined;
    if (!c) return { meta: [{ title: "Course not found — Mozok" }, { name: "robots", content: "noindex" }] };
    const title = `${c.title} — Mozok`;
    const desc = c.subtitle ?? c.description?.slice(0, 150) ?? "Learn on Mozok.";
    return {
      meta: [
        { title }, { name: "description", content: desc },
        { property: "og:title", content: title }, { property: "og:description", content: desc },
        { property: "og:type", content: "article" }, { name: "twitter:card", content: "summary_large_image" },
      ],
    };
  },
  loader: async ({ params, context }) => {
    const course = await context.queryClient.ensureQueryData(courseQuery(params.slug));
    if (!course) throw notFound();
    return course;
  },
  component: CoursePage,
  errorComponent: ({ error }) => <div className="p-8" role="alert">{error.message}</div>,
  notFoundComponent: () => (
    <div className="min-h-screen grid place-items-center bg-background">
      <div className="text-center">
        <h1 className="text-3xl font-bold">Course not found</h1>
        <Link to="/browse" className="mt-4 inline-block rounded-full bg-black px-5 py-2 text-sm text-background">Browse courses</Link>
      </div>
    </div>
  ),
});

function CoursePage() {
  const { slug } = Route.useParams();
  const { data: course } = useSuspenseQuery(courseQuery(slug));
  const [userId, setUserId] = useState<string | null>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const enroll = useServerFn(enrollInCourse);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  const mutation = useMutation({
    mutationFn: () => enroll({ data: { courseId: course!.id } }),
    onSuccess: () => {
      toast.success("Enrolled! Redirecting to your learning...");
      qc.invalidateQueries({ queryKey: ["my-enrollments"] });
      navigate({ to: "/learn" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!course) return null;

  return (
    <div className="min-h-screen bg-background" style={{ fontFamily: "Poppins, sans-serif" }}>
      <div className="mx-auto max-w-6xl px-6 py-8">
        <Link to="/browse" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-black"><ArrowLeft className="h-4 w-4" /> Back to browse</Link>
        <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[1fr_360px]">
          <div className="rounded-3xl bg-card p-8">
            <div className="text-xs font-semibold uppercase tracking-wider text-foreground">{course.category}</div>
            <h1 className="mt-2 text-4xl font-bold md:text-5xl">{course.title}</h1>
            <p className="mt-3 text-lg text-muted-foreground">{course.subtitle}</p>
            <div className="mt-6 flex items-center gap-6 text-sm text-muted-foreground">
              <span className="flex items-center gap-1"><Heart className="h-4 w-4 fill-foreground text-foreground" /> {course.likes}</span>
              <span className="flex items-center gap-1"><Clock className="h-4 w-4" /> {course.duration_label}</span>
              <span>⭐ {Number(course.rating).toFixed(1)}</span>
            </div>
            {course.description && (
              <>
                <h2 className="mt-10 text-xl font-bold">About this course</h2>
                <p className="mt-3 whitespace-pre-line text-foreground">{course.description}</p>
              </>
            )}
            <h2 className="mt-10 text-xl font-bold">Lessons ({course.lessons.length})</h2>
            <ul className="mt-4 space-y-2">
              {course.lessons.length === 0 && <li className="text-sm text-muted-foreground">Lessons coming soon.</li>}
              {course.lessons.map((l, i) => (
                <li key={l.id} className="flex items-center gap-4 rounded-2xl bg-secondary p-4">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-card text-sm font-bold text-muted-foreground">{i + 1}</div>
                  <div className="flex-1">
                    <div className="font-semibold">{l.title}</div>
                    {l.duration_seconds && <div className="text-xs text-muted-foreground">{Math.round(l.duration_seconds / 60)} min</div>}
                  </div>
                  <Play className="h-4 w-4 text-muted-foreground" />
                </li>
              ))}
            </ul>
            <CourseReviews courseId={course.id} />
          </div>
          <aside className="space-y-4">
            <div className="rounded-3xl bg-card p-6">
              <div className="text-3xl font-bold">${(course.price_cents / 100).toFixed(2)}</div>
              <div className="mt-1 text-xs text-muted-foreground">One-time payment • Lifetime access</div>
              {userId ? (
                <button
                  disabled={mutation.isPending}
                  onClick={() => mutation.mutate()}
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-foreground px-6 py-3 text-sm font-semibold text-primary-foreground transition hover:brightness-110 disabled:opacity-60"
                >
                  {mutation.isPending ? "Enrolling..." : <><CheckCircle2 className="h-4 w-4" /> Enroll now</>}
                </button>
              ) : (
                <Link to="/auth" className="mt-4 flex w-full items-center justify-center rounded-full bg-black px-6 py-3 text-sm font-semibold text-background">Sign in to enroll</Link>
              )}
              <ul className="mt-6 space-y-2 text-sm text-muted-foreground">
                <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-foreground" /> Full lifetime access</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-foreground" /> Certificate of completion</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-foreground" /> Learn at your own pace</li>
              </ul>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}