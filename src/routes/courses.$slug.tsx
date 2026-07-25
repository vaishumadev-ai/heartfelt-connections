import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import {
  queryOptions,
  useQuery,
  useSuspenseQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Play,
  Heart,
  Clock,
  CheckCircle2,
  Star,
  Users,
  Globe,
  Award,
  BookOpen,
  Download,
  Smartphone,
  Infinity as InfinityIcon,
  Share2,
  Lock,
  Sparkles,
  AlertCircle,
  Loader2,
} from "lucide-react";
import {
  getCourseBySlug,
  enrollInCourse,
  listMyEnrollments,
  type CourseDetail,
} from "@/lib/courses.functions";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { CourseReviews } from "@/components/CourseReviews";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import doodleIdea from "@/assets/doodle-idea.png";
import doodleRocket from "@/assets/doodle-rocket.png";
import doodleGraduate from "@/assets/doodle-graduate.png";
import doodleBook from "@/assets/doodle-book.png";
import doodleMegaphone from "@/assets/doodle-megaphone.png";
import doodlePencil from "@/assets/doodle-pencil.png";
import doodleCyber from "@/assets/doodle-cyber.png";
import doodleLearner from "@/assets/doodle-learner.png";

const courseQuery = (slug: string) =>
  queryOptions({
    queryKey: ["course", slug],
    queryFn: () => getCourseBySlug({ data: { slug } }),
  });

export const Route = createFileRoute("/courses/$slug")({
  head: ({ loaderData }) => {
    const c = loaderData as CourseDetail | undefined;
    if (!c)
      return {
        meta: [{ title: "Course not found — Mozok" }, { name: "robots", content: "noindex" }],
      };
    const title = `${c.title} — Mozok`;
    const desc = c.subtitle ?? c.description?.slice(0, 150) ?? "Learn on Mozok.";
    return {
      meta: [
        { title },
        { name: "description", content: desc },
        { property: "og:title", content: title },
        { property: "og:description", content: desc },
        { property: "og:type", content: "article" },
        { name: "twitter:card", content: "summary_large_image" },
      ],
    };
  },
  loader: async ({ params, context }) => {
    const course = await context.queryClient.ensureQueryData(courseQuery(params.slug));
    if (!course) throw notFound();
    return course;
  },
  component: CoursePage,
  errorComponent: ({ error }) => (
    <div className="p-8" role="alert">
      {error.message}
    </div>
  ),
  notFoundComponent: () => (
    <div className="min-h-screen grid place-items-center bg-background">
      <div className="text-center">
        <h1 className="text-3xl font-bold">Course not found</h1>
        <Link
          to="/browse"
          className="mt-4 inline-block rounded-full bg-black px-5 py-2 text-sm text-background"
        >
          Browse courses
        </Link>
      </div>
    </div>
  ),
});

const heroDoodleFor = (kind: string | null) => {
  switch (kind) {
    case "megaphone":
      return doodleMegaphone;
    case "pencil":
      return doodlePencil;
    case "cyber":
      return doodleCyber;
    default:
      return doodleLearner;
  }
};

function fmtDuration(seconds: number | null) {
  if (!seconds) return "—";
  const m = Math.round(seconds / 60);
  return `${m} min`;
}

function totalHours(lessons: CourseDetail["lessons"]) {
  const secs = lessons.reduce((s, l) => s + (l.duration_seconds ?? 0), 0);
  return Math.max(1, Math.round(secs / 3600));
}

function CoursePage() {
  const { slug } = Route.useParams();
  const { data: course } = useSuspenseQuery(courseQuery(slug));
  const [userId, setUserId] = useState<string | null>(null);
  const [authResolved, setAuthResolved] = useState(false);
  const [expandAll, setExpandAll] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const enroll = useServerFn(enrollInCourse);
  const fetchEnrollments = useServerFn(listMyEnrollments);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserId(data.user?.id ?? null);
      setAuthResolved(true);
    });
  }, []);

  const enrollmentsQuery = useQuery({
    queryKey: ["my-enrollments", userId],
    queryFn: () => fetchEnrollments(),
    enabled: !!userId,
    retry: 1,
  });

  const enrollmentStatus: "guest" | "loading" | "error" | "known" = !authResolved
    ? "loading"
    : !userId
      ? "guest"
      : enrollmentsQuery.isPending || enrollmentsQuery.isFetching
        ? "loading"
        : enrollmentsQuery.isError
          ? "error"
          : "known";

  const isEnrolled =
    enrollmentStatus === "known" && !!course
      ? (enrollmentsQuery.data ?? []).some(
          (r: { course: { id: string } | null }) => r.course?.id === course.id,
        )
      : false;

  const mutation = useMutation({
    mutationFn: () => enroll({ data: { courseId: course!.id } }),
    onSuccess: () => {
      toast.success("Enrolled! Taking you to your first lesson…");
      qc.invalidateQueries({ queryKey: ["my-enrollments"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
      navigate({ to: "/learn/$slug", params: { slug: course!.slug } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const modules = useMemo(() => {
    if (!course) return [] as { title: string; lessons: CourseDetail["lessons"] }[];
    const map = new Map<string, CourseDetail["lessons"]>();
    for (const l of course.lessons) {
      const key = l.module_title || "Course content";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(l);
    }
    return Array.from(map.entries()).map(([title, lessons]) => ({ title, lessons }));
  }, [course]);

  if (!course) return null;

  const hours = totalHours(course.lessons);
  const price = course.price_cents === 0 ? "Free" : `$${(course.price_cents / 100).toFixed(2)}`;
  const heroDoodle = heroDoodleFor(course.icon_kind);
  const rating = Number(course.rating || 0);

  async function share() {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ title: course!.title, url });
      else {
        await navigator.clipboard.writeText(url);
        toast.success("Link copied");
      }
    } catch {
      /* user cancelled */
    }
  }

  const retryEnrollment = () => enrollmentsQuery.refetch();

  const renderPrimaryCta = (variant: "desktop" | "mobile") => {
    const base =
      variant === "desktop"
        ? "mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-foreground px-6 py-3 text-sm font-semibold text-background"
        : "flex-1 max-w-xs rounded-full bg-foreground px-5 py-3 text-center text-sm font-semibold text-background";

    if (enrollmentStatus === "guest") {
      return (
        <Link to="/auth" className={base}>
          Sign in to enroll
        </Link>
      );
    }
    if (enrollmentStatus === "loading") {
      return (
        <button
          disabled
          aria-busy="true"
          aria-label="Checking enrollment"
          className={`${base} disabled:opacity-60`}
        >
          <Loader2 className="h-4 w-4 animate-spin" /> Checking…
        </button>
      );
    }
    if (enrollmentStatus === "error") {
      return (
        <button
          onClick={retryEnrollment}
          className={`${base} bg-destructive text-destructive-foreground`}
        >
          <AlertCircle className="h-4 w-4" /> Retry
        </button>
      );
    }
    if (isEnrolled) {
      return (
        <Link
          to="/learn/$slug"
          params={{ slug: course.slug }}
          className={`${base} inline-flex items-center gap-2`}
        >
          <Play className="h-4 w-4" /> Continue learning
        </Link>
      );
    }
    return (
      <button
        disabled={mutation.isPending}
        onClick={() => mutation.mutate()}
        className={`${base} disabled:opacity-60`}
      >
        {mutation.isPending ? (
          "Enrolling..."
        ) : (
          <>
            <Sparkles className="h-4 w-4" /> {variant === "desktop" ? "Enroll now" : "Enroll now"}
          </>
        )}
      </button>
    );
  };

  return (
    <div
      className="min-h-screen bg-background pb-24 lg:pb-8"
      style={{ fontFamily: "Poppins, sans-serif" }}
    >
      {/* HERO */}
      <div className="border-b border-border bg-card">
        <div className="mx-auto max-w-7xl px-6 pb-10 pt-6">
          <Link
            to="/browse"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Back to browse
          </Link>
          <div className="mt-6 grid grid-cols-1 gap-10 lg:grid-cols-[1fr_380px]">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full border border-border px-3 py-1 font-semibold uppercase tracking-wider">
                  {course.category}
                </span>
                <span className="rounded-full border border-border px-3 py-1">{course.level}</span>
                <span className="rounded-full border border-border px-3 py-1 inline-flex items-center gap-1">
                  <Globe className="h-3 w-3" /> {course.language}
                </span>
              </div>
              <h1 className="mt-5 text-4xl font-bold leading-tight md:text-5xl">{course.title}</h1>
              {course.subtitle && (
                <p className="mt-3 text-lg text-muted-foreground">{course.subtitle}</p>
              )}
              <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                <span className="inline-flex items-center gap-1.5">
                  <Star className="h-4 w-4 fill-foreground text-foreground" />
                  <b>{rating.toFixed(1)}</b>
                  <span className="text-muted-foreground">({course.reviews_count} reviews)</span>
                </span>
                <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <Users className="h-4 w-4" /> {course.students_count.toLocaleString()} learners
                </span>
                <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <Clock className="h-4 w-4" /> {course.duration_label || `${hours}h`}
                </span>
                <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <Heart className="h-4 w-4" /> {course.likes}
                </span>
              </div>
              {course.instructor_name && (
                <div className="mt-6 inline-flex items-center gap-3 rounded-full border border-border bg-background px-3 py-1.5">
                  <div className="grid h-8 w-8 place-items-center rounded-full bg-secondary text-xs font-bold">
                    {course.instructor_name.slice(0, 1)}
                  </div>
                  <div className="text-sm">
                    <span className="text-muted-foreground">Taught by </span>
                    <b>{course.instructor_name}</b>
                    {course.instructor_title && (
                      <span className="text-muted-foreground"> · {course.instructor_title}</span>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="relative hidden lg:block">
              <img
                src={heroDoodle}
                alt=""
                aria-hidden
                className="mx-auto h-64 w-64 object-contain"
              />
            </div>
          </div>
        </div>
      </div>

      {/* BODY */}
      <div className="mx-auto max-w-7xl px-6 py-10">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-[1fr_380px]">
          <main className="min-w-0 space-y-12">
            {course.learn_outcomes.length > 0 && (
              <section>
                <div className="flex items-center gap-3">
                  <img src={doodleIdea} alt="" aria-hidden className="h-10 w-10" />
                  <h2 className="text-2xl font-bold">What you'll learn</h2>
                </div>
                <div className="mt-4 grid grid-cols-1 gap-3 rounded-3xl border border-border bg-card p-6 md:grid-cols-2">
                  {course.learn_outcomes.map((o) => (
                    <div key={o} className="flex items-start gap-2 text-sm">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-foreground" />
                      <span>{o}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {course.skills.length > 0 && (
              <section>
                <div className="flex items-center gap-3">
                  <img src={doodleRocket} alt="" aria-hidden className="h-10 w-10" />
                  <h2 className="text-2xl font-bold">Skills you'll gain</h2>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {course.skills.map((s) => (
                    <span
                      key={s}
                      className="rounded-full border border-border bg-card px-3 py-1.5 text-sm"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </section>
            )}

            <section>
              <h2 className="text-2xl font-bold">This course includes</h2>
              <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <li className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 text-sm">
                  <BookOpen className="h-4 w-4" /> {course.lessons.length} on-demand lessons
                </li>
                <li className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 text-sm">
                  <Clock className="h-4 w-4" /> {hours} hours of content
                </li>
                <li className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 text-sm">
                  <Download className="h-4 w-4" /> Downloadable resources
                </li>
                <li className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 text-sm">
                  <Smartphone className="h-4 w-4" /> Mobile & desktop access
                </li>
                <li className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 text-sm">
                  <InfinityIcon className="h-4 w-4" /> Full lifetime access
                </li>
                {course.certificate && (
                  <li className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 text-sm">
                    <Award className="h-4 w-4" /> Certificate of completion
                  </li>
                )}
              </ul>
            </section>

            <section>
              <div className="flex items-end justify-between gap-4">
                <div className="flex items-center gap-3">
                  <img src={doodleBook} alt="" aria-hidden className="h-10 w-10" />
                  <div>
                    <h2 className="text-2xl font-bold">Course curriculum</h2>
                    <p className="text-sm text-muted-foreground">
                      {modules.length} modules · {course.lessons.length} lessons · {hours}h total
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setExpandAll((v) => !v)}
                  className="text-sm font-semibold underline underline-offset-4"
                >
                  {expandAll ? "Collapse all" : "Expand all"}
                </button>
              </div>
              <div className="mt-4 overflow-hidden rounded-3xl border border-border bg-card">
                <Accordion
                  type="multiple"
                  value={expandAll ? modules.map((_, i) => `m-${i}`) : undefined}
                  className="w-full"
                >
                  {modules.map((m, i) => (
                    <AccordionItem key={m.title + i} value={`m-${i}`} className="border-border">
                      <AccordionTrigger className="px-5 py-4 hover:no-underline">
                        <div className="flex flex-1 items-center justify-between pr-3 text-left">
                          <div>
                            <div className="text-xs uppercase tracking-wider text-muted-foreground">
                              Module {i + 1}
                            </div>
                            <div className="text-base font-semibold">{m.title}</div>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {m.lessons.length} lessons
                          </div>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent className="border-t border-border bg-background/40 px-5 pb-4 pt-2">
                        <ul className="divide-y divide-border">
                          {m.lessons.map((l) => (
                            <li key={l.id} className="flex items-center gap-3 py-3 text-sm">
                              {l.is_preview ? (
                                <Play className="h-4 w-4" />
                              ) : isEnrolled ? (
                                <Play className="h-4 w-4" />
                              ) : (
                                <Lock className="h-4 w-4 text-muted-foreground" />
                              )}
                              <span className="flex-1">{l.title}</span>
                              {l.is_preview && (
                                <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold uppercase">
                                  Preview
                                </span>
                              )}
                              <span className="text-xs text-muted-foreground">
                                {fmtDuration(l.duration_seconds)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </div>
            </section>

            {course.description && (
              <section>
                <h2 className="text-2xl font-bold">About this course</h2>
                <p className="mt-3 whitespace-pre-line leading-relaxed text-foreground">
                  {course.description}
                </p>
              </section>
            )}

            {course.requirements.length > 0 && (
              <section>
                <h2 className="text-2xl font-bold">Requirements</h2>
                <ul className="mt-3 space-y-2 text-sm">
                  {course.requirements.map((r) => (
                    <li key={r} className="flex items-start gap-2">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-foreground" /> {r}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {course.audience.length > 0 && (
              <section>
                <h2 className="text-2xl font-bold">Who this course is for</h2>
                <ul className="mt-3 space-y-2 text-sm">
                  {course.audience.map((r) => (
                    <li key={r} className="flex items-start gap-2">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-foreground" /> {r}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {course.instructor_name && (
              <section>
                <div className="flex items-center gap-3">
                  <img src={doodleGraduate} alt="" aria-hidden className="h-10 w-10" />
                  <h2 className="text-2xl font-bold">Your instructor</h2>
                </div>
                <div className="mt-4 rounded-3xl border border-border bg-card p-6">
                  <div className="flex items-start gap-4">
                    <div className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-secondary text-xl font-bold">
                      {course.instructor_name.slice(0, 1)}
                    </div>
                    <div className="min-w-0">
                      <div className="text-lg font-bold">{course.instructor_name}</div>
                      {course.instructor_title && (
                        <div className="text-sm text-muted-foreground">
                          {course.instructor_title}
                        </div>
                      )}
                      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Star className="h-3 w-3" /> {rating.toFixed(1)} rating
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Users className="h-3 w-3" /> {course.students_count.toLocaleString()}{" "}
                          learners
                        </span>
                      </div>
                      {course.instructor_bio && (
                        <p className="mt-3 text-sm leading-relaxed">{course.instructor_bio}</p>
                      )}
                    </div>
                  </div>
                </div>
              </section>
            )}

            <section>
              <h2 className="text-2xl font-bold">Learner reviews</h2>
              <div className="mt-4 grid grid-cols-1 gap-4 rounded-3xl border border-border bg-card p-6 md:grid-cols-[220px_1fr]">
                <div className="flex flex-col items-center justify-center border-b border-border pb-4 md:border-b-0 md:border-r md:pb-0 md:pr-4">
                  <div className="text-5xl font-bold">{rating.toFixed(1)}</div>
                  <div className="mt-1 flex gap-0.5">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <Star
                        key={n}
                        className={`h-4 w-4 ${
                          n <= Math.round(rating)
                            ? "fill-foreground text-foreground"
                            : "text-muted-foreground"
                        }`}
                      />
                    ))}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {course.reviews_count} reviews
                  </div>
                </div>
                <div className="space-y-2">
                  {course.rating_breakdown.map((b) => {
                    const pct = course.reviews_count ? (b.count / course.reviews_count) * 100 : 0;
                    return (
                      <div key={b.stars} className="flex items-center gap-3 text-xs">
                        <span className="w-8 shrink-0">{b.stars}★</span>
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
                          <div className="h-full bg-foreground" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="w-8 shrink-0 text-right text-muted-foreground">
                          {b.count}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="mt-6">
                <CourseReviews courseId={course.id} />
              </div>
            </section>

            {course.faq.length > 0 && (
              <section>
                <h2 className="text-2xl font-bold">Frequently asked questions</h2>
                <div className="mt-4 overflow-hidden rounded-3xl border border-border bg-card">
                  <Accordion type="single" collapsible className="w-full">
                    {course.faq.map((f, i) => (
                      <AccordionItem key={i} value={`faq-${i}`} className="border-border">
                        <AccordionTrigger className="px-5 py-4 text-left hover:no-underline">
                          {f.q}
                        </AccordionTrigger>
                        <AccordionContent className="px-5 pb-4 text-sm text-muted-foreground">
                          {f.a}
                        </AccordionContent>
                      </AccordionItem>
                    ))}
                  </Accordion>
                </div>
              </section>
            )}

            {course.related.length > 0 && (
              <section>
                <h2 className="text-2xl font-bold">Related courses</h2>
                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {course.related.map((r) => (
                    <Link
                      key={r.id}
                      to="/courses/$slug"
                      params={{ slug: r.slug }}
                      className="group rounded-3xl border border-border bg-card p-5 transition hover:-translate-y-0.5"
                    >
                      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {r.category}
                      </div>
                      <div className="mt-2 line-clamp-2 text-lg font-bold group-hover:underline">
                        {r.title}
                      </div>
                      <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Star className="h-3 w-3" /> {Number(r.rating).toFixed(1)}
                        </span>
                        <span>
                          {r.price_cents === 0 ? "Free" : `$${(r.price_cents / 100).toFixed(2)}`}
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            )}
          </main>

          {/* STICKY ENROLL CARD */}
          <aside className="hidden lg:block">
            <div className="sticky top-6 space-y-4">
              <div className="overflow-hidden rounded-3xl border border-border bg-card">
                <div className="relative aspect-video border-b border-border bg-secondary">
                  <img
                    src={heroDoodle}
                    alt=""
                    aria-hidden
                    className="absolute inset-0 m-auto h-32 w-32"
                  />
                  <button className="absolute inset-0 grid place-items-center">
                    <span className="grid h-14 w-14 place-items-center rounded-full bg-foreground text-background">
                      <Play className="h-5 w-5 fill-background" />
                    </span>
                  </button>
                  <span className="absolute bottom-2 left-2 rounded-full bg-background/90 px-2 py-0.5 text-[10px] font-semibold uppercase">
                    Preview
                  </span>
                </div>
                <div className="p-6">
                  <div className="flex items-baseline justify-between">
                    <div className="text-3xl font-bold">{price}</div>
                    {course.price_cents > 0 && (
                      <div className="text-xs text-muted-foreground line-through">
                        ${((course.price_cents * 1.5) / 100).toFixed(2)}
                      </div>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    One-time payment · Lifetime access
                  </div>
                  {renderPrimaryCta("desktop")}
                  {enrollmentStatus === "error" && (
                    <p role="alert" className="mt-2 text-xs text-destructive">
                      Couldn't check your enrollment. Tap Retry.
                    </p>
                  )}
                  <button
                    onClick={share}
                    className="mt-3 flex w-full items-center justify-center gap-2 rounded-full border border-border px-6 py-2.5 text-sm font-medium"
                  >
                    <Share2 className="h-4 w-4" /> Share
                  </button>
                  <div className="mt-5 space-y-2 text-xs text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-foreground" /> 30-day money-back
                      guarantee
                    </div>
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-foreground" /> Full lifetime access
                    </div>
                    {course.certificate && (
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-3.5 w-3.5 text-foreground" /> Certificate on
                        completion
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-foreground" /> Learn at your own
                      pace
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>

      {/* MOBILE STICKY BAR */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card p-3 lg:hidden">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
          <div>
            <div className="text-lg font-bold leading-none">{price}</div>
            <div className="text-[11px] text-muted-foreground">Lifetime access</div>
          </div>
          {renderPrimaryCta("mobile")}
        </div>
      </div>
    </div>
  );
}
