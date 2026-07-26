import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowRight,
  BookOpen,
  Bookmark,
  Compass,
  FileText,
  GraduationCap,
  LogOut,
  Palette,
  FileCode,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  getLearnerDashboard,
  pickContinue,
  type LearnerDashboardDTO,
  type LearnerEnrollmentDTO,
} from "@/lib/learner.functions";
import { mapLearnerError } from "@/lib/learner-errors";
import { supabase } from "@/integrations/supabase/client";
import { NotificationsBell } from "@/components/NotificationsBell";
import { MobileMenu } from "@/components/MobileMenu";
import heroPerson from "@/assets/doodle-learner.png";
import megaphone from "@/assets/doodle-megaphone.png";
import pencil from "@/assets/doodle-pencil.png";
import cyberHead from "@/assets/doodle-cyber.png";
import avatarGeorge from "@/assets/avatar-george.jpg";

function dashboardQueryOptions(fn: () => Promise<LearnerDashboardDTO>) {
  return queryOptions({ queryKey: ["learner-dashboard"], queryFn: fn });
}

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — Mozok" },
      { name: "description", content: "Your learning dashboard: continue courses, revisit notes and bookmarks, and jump back in." },
      { property: "og:title", content: "Dashboard — Mozok" },
      { property: "og:description", content: "Your learning dashboard on Mozok." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Dashboard,
  errorComponent: ({ error }) => (
    <div className="p-8" role="alert">
      {mapLearnerError(error)}
    </div>
  ),
});

function iconFor(kind: string | null) {
  switch (kind) {
    case "megaphone": return megaphone;
    case "pencil": return pencil;
    case "cyber": return cyberHead;
    default: return null;
  }
}

function formatPrice(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function Dashboard() {
  const fetchDashboard = useServerFn(getLearnerDashboard);
  const { data } = useSuspenseQuery(dashboardQueryOptions(fetchDashboard));
  const enrollments = data.enrollments;
  const cont = pickContinue(enrollments);
  const [displayName, setDisplayName] = useState("there");
  const [avatar, setAvatar] = useState<string | null>(null);
  const navigate = useNavigate();
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const meta = data.user.user_metadata || {};
      setDisplayName(meta.display_name || meta.full_name || data.user.email?.split("@")[0] || "there");
      const { data: prof } = await supabase.from("profiles").select("display_name, avatar_url").eq("id", data.user.id).maybeSingle();
      if (prof?.display_name) setDisplayName(prof.display_name);
      if (prof?.avatar_url) setAvatar(prof.avatar_url);
    });
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/" });
  }

  const libraryPreview = enrollments.slice(0, 6);
  const recentNotes = data.notes.slice(0, 4);
  const recentBookmarks = data.bookmarks.slice(0, 4);

  return (
    <div className="min-h-screen bg-background" style={{ fontFamily: "Poppins, sans-serif" }}>
      <div className="flex min-h-screen w-full flex-col gap-5 p-4 md:p-6 lg:flex-row">
        <main className="flex-1 rounded-3xl bg-card p-6 md:p-10">
          <nav className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xl font-bold">
              <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-black">
                <div className="h-2.5 w-2.5 rounded-full bg-black" />
              </div>
              <span>Moz<span className="text-foreground">ok</span></span>
            </div>
            <div className="flex items-center gap-5 text-foreground">
              <Link to="/browse" title="Browse"><Compass className="h-5 w-5" /></Link>
              <Link to="/learn" title="My learning"><BookOpen className="h-5 w-5" /></Link>
              <Link to="/studio" title="Studio"><GraduationCap className="h-5 w-5" /></Link>
              <NotificationsBell />
              <button onClick={signOut} title="Sign out"><LogOut className="h-5 w-5" /></button>
              <MobileMenu onSignOut={signOut} displayName={displayName} />
            </div>
          </nav>

          <section className="mt-8 grid grid-cols-1 items-center gap-6 md:grid-cols-[240px_1fr]">
            <img src={heroPerson} alt="" width={240} height={240} className="w-48 md:w-full" />
            <div>
              <p className="text-2xl text-foreground">Hi {displayName},</p>
              <h1 className="mt-1 text-4xl font-bold leading-tight md:text-5xl">
                {cont ? "Pick up where you left off." : "Ready to start learning?"}
              </h1>
              <p className="mt-3 text-muted-foreground">
                {cont
                  ? `${enrollments.length} course${enrollments.length === 1 ? "" : "s"} in your library.`
                  : "Browse the catalog to enroll in your first free course."}
              </p>
            </div>
          </section>

          {/* Continue Learning */}
          <section className="mt-10">
            <h2 className="text-lg font-semibold">Continue learning</h2>
            {cont ? (
              <ContinueCard enrollment={cont.enrollment} reason={cont.reason} />
            ) : (
              <EmptyContinue />
            )}
          </section>

          {/* Library preview */}
          <section className="mt-10">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Your library</h2>
              {(data.libraryHasMore || enrollments.length > libraryPreview.length) && (
                <Link to="/learn" className="text-sm text-muted-foreground hover:text-foreground">
                  View all →
                </Link>
              )}
            </div>
            {libraryPreview.length === 0 ? (
              <div className="mt-4 rounded-3xl bg-card p-8 ring-1 ring-border text-center">
                <p className="text-muted-foreground">You haven't enrolled in any courses yet.</p>
                <Link
                  to="/browse"
                  className="mt-4 inline-block rounded-full bg-foreground px-5 py-2.5 text-sm font-semibold text-background"
                >
                  Browse courses
                </Link>
              </div>
            ) : (
              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {libraryPreview.map((e) => (
                  <LibraryCard key={e.id} enrollment={e} />
                ))}
              </div>
            )}
          </section>
        </main>

        <aside className="w-full space-y-6 lg:w-[360px]">
          <div className="rounded-3xl bg-foreground p-6 text-background">
            <div className="flex items-center gap-3">
              <img
                src={avatar || avatarGeorge}
                alt=""
                width={56}
                height={56}
                className="h-14 w-14 rounded-full object-cover"
              />
              <div>
                <div className="text-lg font-semibold">{displayName}</div>
                <div className="text-xs text-muted-foreground">
                  {enrollments.length} enrolled ·{" "}
                  {enrollments.filter((e) => e.progress >= 100).length} completed
                </div>
              </div>
            </div>
          </div>

          {/* Recent notes */}
          <div className="rounded-3xl bg-card p-6 ring-1 ring-border">
            <div className="mb-3 flex items-center gap-2">
              <FileText className="h-4 w-4" />
              <h3 className="font-semibold">Recent notes</h3>
            </div>
            {recentNotes.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Notes you take on any lesson will appear here.
              </p>
            ) : (
              <ul className="space-y-3">
                {recentNotes.map((n) => {
                  const course = enrollments.find((e) => e.course_id === n.course_id)?.course;
                  return (
                    <li key={n.id} className="rounded-2xl bg-background p-3 text-sm">
                      <div className="line-clamp-2 text-foreground">{n.body}</div>
                      {course && (
                        <Link
                          to="/learn/$slug"
                          params={{ slug: course.slug }}
                          search={{ lesson: n.lesson_id }}
                          className="mt-2 inline-block text-xs text-muted-foreground hover:text-foreground"
                        >
                          {course.title} →
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Recent bookmarks */}
          <div className="rounded-3xl bg-card p-6 ring-1 ring-border">
            <div className="mb-3 flex items-center gap-2">
              <Bookmark className="h-4 w-4" />
              <h3 className="font-semibold">Bookmarks</h3>
            </div>
            {recentBookmarks.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Save lessons to revisit them later.
              </p>
            ) : (
              <ul className="space-y-2">
                {recentBookmarks.map((b) => {
                  const course = enrollments.find((e) => e.course_id === b.course_id)?.course;
                  if (!course) return null;
                  return (
                    <li key={b.id}>
                      <Link
                        to="/learn/$slug"
                        params={{ slug: course.slug }}
                        search={{ lesson: b.lesson_id }}
                        className="flex items-center justify-between rounded-2xl p-2 text-sm hover:bg-background"
                      >
                        <span className="truncate">{course.title}</span>
                        <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
  // The router import stays used by future retry flows; reference to satisfy lint.
  void router;
}

function ContinueCard({
  enrollment,
  reason,
}: {
  enrollment: LearnerEnrollmentDTO;
  reason: "in_progress" | "recent";
}) {
  const img = iconFor(enrollment.course.icon_kind);
  const label =
    reason === "in_progress"
      ? enrollment.progress > 0
        ? `${enrollment.progress}% complete`
        : "In progress"
      : enrollment.progress >= 100
        ? "Revisit"
        : "Get started";
  return (
    <Link
      to="/learn/$slug"
      params={{ slug: enrollment.course.slug }}
      className="mt-4 grid grid-cols-1 gap-6 rounded-3xl bg-card p-6 ring-1 ring-border transition hover:-translate-y-0.5 md:grid-cols-[1fr_auto] md:items-center"
    >
      <div>
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {enrollment.course.category}
        </div>
        <h3 className="mt-1 text-2xl font-bold">{enrollment.course.title}</h3>
        {enrollment.course.subtitle && (
          <p className="mt-1 text-sm text-muted-foreground">{enrollment.course.subtitle}</p>
        )}
        <div className="mt-4 h-2 w-full max-w-md overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-foreground transition-all"
            style={{ width: `${Math.max(2, enrollment.progress)}%` }}
          />
        </div>
        <div className="mt-3 flex items-center gap-3 text-sm">
          <span className="text-muted-foreground">{label}</span>
          <span className="flex h-9 items-center gap-2 rounded-full bg-foreground px-4 text-sm font-semibold text-background">
            {enrollment.progress > 0 ? "Continue" : "Start"} <ArrowRight className="h-4 w-4" />
          </span>
        </div>
      </div>
      {img && (
        <img
          src={img}
          alt=""
          width={160}
          height={160}
          className="hidden h-32 w-40 object-contain md:block"
          loading="lazy"
        />
      )}
    </Link>
  );
}

function EmptyContinue() {
  return (
    <div className="mt-4 rounded-3xl bg-card p-8 ring-1 ring-border text-center">
      <p className="text-muted-foreground">Nothing here yet. Find a free course to begin.</p>
      <Link
        to="/browse"
        className="mt-4 inline-block rounded-full bg-foreground px-5 py-2.5 text-sm font-semibold text-background"
      >
        Browse courses
      </Link>
    </div>
  );
}

function LibraryCard({ enrollment }: { enrollment: LearnerEnrollmentDTO }) {
  const img = iconFor(enrollment.course.icon_kind);
  return (
    <Link
      to="/learn/$slug"
      params={{ slug: enrollment.course.slug }}
      className="block rounded-3xl bg-card p-5 ring-1 ring-border transition hover:-translate-y-0.5"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {enrollment.course.category}
          </div>
          <h3 className="mt-1 text-lg font-bold">{enrollment.course.title}</h3>
        </div>
        {img && (
          <img
            src={img}
            alt=""
            width={72}
            height={72}
            className="h-16 w-20 object-contain"
            loading="lazy"
          />
        )}
      </div>
      <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full rounded-full bg-foreground"
          style={{ width: `${enrollment.progress}%` }}
        />
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
        <span>{enrollment.progress}% complete</span>
        <ArrowRight className="h-4 w-4" />
      </div>
    </Link>
  );
}

// Kept for potential future glyph rendering; referenced to prevent lint churn.
void Palette;
void FileCode;