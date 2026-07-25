import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { Bell, Menu, Search, MoreHorizontal, Heart, ArrowRight, LayoutGrid, List, ChevronLeft, ChevronRight, Palette, FileCode, LogOut, BookOpen, Compass, GraduationCap } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { listCourses, type CourseCard } from "@/lib/courses.functions";
import { supabase } from "@/integrations/supabase/client";
import heroPerson from "@/assets/hero-person.png";
import megaphone from "@/assets/megaphone.png";
import pencil from "@/assets/pencil.png";
import cyberHead from "@/assets/cyber-head.png";
import avatarUser from "@/assets/avatar-user.jpg";
import avatarGeorge from "@/assets/avatar-george.jpg";

const coursesQueryOptions = queryOptions({
  queryKey: ["courses"],
  queryFn: () => listCourses(),
});

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — Mozok" },
      { name: "description", content: "Your learning dashboard: continue courses, discover new skills, and track progress." },
      { property: "og:title", content: "Dashboard — Mozok" },
      { property: "og:description", content: "Your learning dashboard on Mozok." },
      { name: "robots", content: "noindex" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(coursesQueryOptions),
  component: Dashboard,
  errorComponent: ({ error }) => <div className="p-8" role="alert">{error.message}</div>,
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
  const { data: courses } = useSuspenseQuery(coursesQueryOptions);
  const [displayName, setDisplayName] = useState("there");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const navigate = useNavigate();

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

  const filtered = search
    ? courses.filter((c) => c.title.toLowerCase().includes(search.toLowerCase()) || c.category.toLowerCase().includes(search.toLowerCase()))
    : courses;

  const featured = filtered[0];
  const secondary = filtered.slice(1, 3);
  const subscribed = filtered.slice(3, 7);

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
              <Bell className="h-5 w-5" />
              <button onClick={signOut} title="Sign out"><LogOut className="h-5 w-5" /></button>
              <Menu className="h-5 w-5" />
            </div>
          </nav>

          <section className="mt-8 grid grid-cols-1 items-center gap-6 md:grid-cols-[240px_1fr]">
            <img src={heroPerson} alt="Learner illustration" width={240} height={240} className="w-48 md:w-full" />
            <div>
              <p className="text-2xl text-foreground">Hi {displayName},</p>
              <h1 className="mt-1 text-4xl font-bold leading-tight md:text-5xl">What do you wanna learn?</h1>
              <div className="mt-6 flex items-center rounded-full bg-card p-1.5 ring-1 ring-border">
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search ..."
                  className="flex-1 bg-transparent px-5 py-2 text-sm outline-none placeholder:text-muted-foreground"
                />
                <button className="flex h-11 w-11 items-center justify-center rounded-full bg-foreground text-primary-foreground">
                  <Search className="h-5 w-5" />
                </button>
              </div>
            </div>
          </section>

          <div className="mt-10 flex items-center justify-between border-b border-border pb-2">
            <div className="flex gap-6 text-sm">
              <button className="relative pb-2 font-semibold">
                All
                <span className="absolute inset-x-0 -bottom-[1px] mx-auto h-0.5 w-6 rounded-full bg-foreground" />
              </button>
              <button className="pb-2 text-muted-foreground">New</button>
              <button className="pb-2 text-muted-foreground">Popular</button>
            </div>
            <div className="flex items-center gap-3 text-muted-foreground">
              <List className="h-5 w-5" />
              <LayoutGrid className="h-5 w-5" />
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
            {featured && (
              <Link to="/courses/$slug" params={{ slug: featured.slug }} className="row-span-2 block rounded-3xl bg-card p-6 ring-1 ring-border transition-transform hover:-translate-y-1">
                <h3 className="text-3xl font-bold">{featured.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{featured.subtitle}</p>
                <div className="mt-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <img src={avatar || avatarUser} alt="" width={48} height={48} className="h-12 w-12 rounded-full object-cover" loading="lazy" />
                    <div>
                      <div className="text-2xl font-bold text-foreground">{Number(featured.rating).toFixed(1)}</div>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Heart className="h-3 w-3 fill-foreground text-foreground" /> {featured.likes}
                      </div>
                    </div>
                  </div>
                  {iconFor(featured.icon_kind) && (
                    <img src={iconFor(featured.icon_kind)!} alt="" width={160} height={160} className="h-32 w-32 object-contain" loading="lazy" />
                  )}
                </div>
                <div className="mt-8 flex items-center justify-between">
                  <div className="rounded-full bg-secondary px-4 py-2 text-sm font-semibold text-foreground">{formatPrice(featured.price_cents)}</div>
                  <div className="text-sm text-muted-foreground">{featured.duration_label}</div>
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-foreground text-background">
                    <ArrowRight className="h-4 w-4" />
                  </span>
                </div>
              </Link>
            )}

            {secondary.map((c) => (
              <SmallCard key={c.id} course={c} />
            ))}
          </div>
        </main>

        <aside className="w-full space-y-6 lg:w-[360px]">
          <div className="rounded-3xl bg-foreground p-6 text-background">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <img src={avatar || avatarGeorge} alt={displayName} width={56} height={56} className="h-14 w-14 rounded-full object-cover" />
                <div>
                  <div className="text-lg font-semibold">{displayName}</div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="h-2 w-2 rounded-full bg-foreground" /> Online
                  </div>
                </div>
              </div>
              <MoreHorizontal className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="mt-6 grid grid-cols-3 text-center">
              <div><div className="text-xs text-muted-foreground">Score</div><div className="mt-1 text-xl font-bold">9.7</div></div>
              <div className="border-x border-white/10"><div className="text-xs text-muted-foreground">Earned coins</div><div className="mt-1 text-xl font-bold">10.5K</div></div>
              <div><div className="text-xs text-muted-foreground">Followers</div><div className="mt-1 text-xl font-bold">100K</div></div>
            </div>
          </div>

          <div className="rounded-3xl bg-card p-6">
            <div className="flex gap-6 border-b border-border pb-3 text-sm">
              <button className="relative pb-1 font-semibold">
                Subscribed
                <span className="absolute inset-x-0 -bottom-[13px] mx-auto h-0.5 w-16 rounded-full bg-foreground" />
              </button>
              <button className="text-muted-foreground">Upcoming</button>
              <button className="text-muted-foreground">Passed</button>
            </div>
            <ul className="mt-4 space-y-2">
              {subscribed.map((c, i) => (
                <li key={c.id} className={`flex items-center justify-between rounded-2xl p-3 ${i === 1 ? "bg-background" : ""}`}>
                  <div className="flex items-center gap-3">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-xl text-sm font-bold ${tintFor(c.icon_kind)}`}>
                      {glyphFor(c.icon_kind, c.title)}
                    </div>
                    <div>
                      <div className="text-sm font-semibold">{c.title}</div>
                      <div className="text-xs text-muted-foreground">{c.subtitle}</div>
                    </div>
                  </div>
                  <div className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-xs font-semibold text-muted-foreground">
                    {50 + i * 10}
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-3xl bg-card p-6">
            <div className="flex items-center justify-between">
              <h4 className="text-lg font-semibold">Calendar</h4>
              <div className="flex items-center gap-3 text-muted-foreground">
                <ChevronLeft className="h-4 w-4" />
                <ChevronRight className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-4 grid grid-cols-5 gap-2 text-center">
              {[
                { d: 13, wd: "Mon", active: true, dot: "bg-foreground" },
                { d: 14, wd: "Tue", dot: "bg-foreground" },
                { d: 15, wd: "Wed", dot: "bg-foreground" },
                { d: 16, wd: "Thu", dot: "bg-foreground" },
                { d: 17, wd: "Fri", dot: "bg-foreground" },
              ].map((day) => (
                <div key={day.d} className={`rounded-2xl py-3 ${day.active ? " ring-1 ring-border" : ""}`}>
                  <div className={`mx-auto mb-2 h-1.5 w-1.5 rounded-full ${day.dot}`} />
                  <div className={`text-lg font-bold ${day.active ? "" : "text-foreground"}`}>{day.d}</div>
                  <div className="text-[10px] text-muted-foreground">{day.wd}</div>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function SmallCard({ course }: { course: CourseCard }) {
  const img = iconFor(course.icon_kind);
  const priceBg = course.icon_kind === "cyber" ? "bg-secondary" : "bg-secondary";
  return (
    <Link to="/courses/$slug" params={{ slug: course.slug }} className="block rounded-3xl bg-card p-5 ring-1 ring-border transition-transform hover:-translate-y-1">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-xl font-bold">{course.title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{course.subtitle}</p>
        </div>
        {img && <img src={img} alt="" width={120} height={90} className="h-20 w-28 object-contain" loading="lazy" />}
      </div>
      <div className="mt-6 flex items-center justify-between">
        <div className={`rounded-full ${priceBg} px-3 py-1.5 text-xs font-semibold`}>{formatPrice(course.price_cents)}</div>
        <div className="text-xs text-muted-foreground">{course.duration_label}</div>
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-foreground text-background">
          <ArrowRight className="h-4 w-4" />
        </span>
      </div>
    </Link>
  );
}

function tintFor(kind: string | null) {
  switch (kind) {
    case "megaphone": return "bg-secondary text-foreground";
    case "js": return "bg-secondary text-foreground";
    case "html": return "bg-secondary text-foreground";
    case "pencil": return "bg-black text-background";
    case "cyber": return "bg-secondary text-foreground";
    default: return "bg-background text-foreground";
  }
}

function glyphFor(kind: string | null, title: string) {
  if (kind === "pencil") return <Palette className="h-4 w-4" />;
  if (kind === "html") return <FileCode className="h-4 w-4" />;
  if (kind === "js") return "JS";
  return title.charAt(0);
}
// Prevent unused import lint if Suspense not used elsewhere
void Suspense;