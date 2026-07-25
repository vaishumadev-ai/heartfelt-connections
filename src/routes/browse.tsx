import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Search, ArrowRight, Heart } from "lucide-react";
import { listCourses, type CourseCard } from "@/lib/courses.functions";

const q = queryOptions({ queryKey: ["courses"], queryFn: () => listCourses() });

export const Route = createFileRoute("/browse")({
  head: () => ({
    meta: [
      { title: "Browse courses — Mozok" },
      { name: "description", content: "Explore all Mozok courses across design, code, languages and security." },
      { property: "og:title", content: "Browse courses — Mozok" },
      { property: "og:description", content: "Explore all Mozok courses." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(q),
  component: Browse,
  errorComponent: ({ error }) => <div className="p-8" role="alert">{error.message}</div>,
});

function Browse() {
  const { data: courses } = useSuspenseQuery(q);
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState<string>("All");
  const cats = ["All", ...Array.from(new Set(courses.map((c) => c.category)))];
  const filtered = courses.filter((c) => {
    const okCat = cat === "All" || c.category === cat;
    const okSearch = !search || c.title.toLowerCase().includes(search.toLowerCase());
    return okCat && okSearch;
  });
  return (
    <div className="min-h-screen bg-background" style={{ fontFamily: "Instrument Serif, serif" }}>
      <div className="mx-auto max-w-7xl px-6 py-10">
        <div className="flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 text-xl font-bold">
            <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-black">
              <div className="h-2.5 w-2.5 rounded-full bg-black" />
            </div>
            <span>Moz<span className="text-foreground">ok</span></span>
          </Link>
          <Link to="/auth" className="rounded-full bg-black px-5 py-2 text-sm font-semibold text-background">Sign in</Link>
        </div>
        <h1 className="mt-10 text-4xl font-bold md:text-5xl">Browse all courses</h1>
        <p className="mt-2 text-muted-foreground">Find your next skill. {courses.length} courses available.</p>
        <div className="mt-6 flex items-center rounded-full bg-card p-1.5">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search courses..." className="flex-1 bg-transparent px-5 py-2 text-sm outline-none" />
          <button className="flex h-11 w-11 items-center justify-center rounded-full bg-foreground text-background"><Search className="h-5 w-5" /></button>
        </div>
        <div className="mt-6 flex flex-wrap gap-2">
          {cats.map((c) => (
            <button key={c} onClick={() => setCat(c)} className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${cat === c ? "bg-black text-background" : "bg-card text-foreground hover:bg-secondary"}`}>{c}</button>
          ))}
        </div>
        <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => <BrowseCard key={c.id} course={c} />)}
        </div>
      </div>
    </div>
  );
}

function BrowseCard({ course }: { course: CourseCard }) {
  return (
    <Link to="/courses/$slug" params={{ slug: course.slug }} className="group block rounded-3xl bg-card p-6 ring-1 ring-border transition-all hover:-translate-y-1 hover:">
      <div className="text-xs font-semibold uppercase tracking-wider text-foreground">{course.category}</div>
      <h3 className="mt-2 text-xl font-bold">{course.title}</h3>
      <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{course.subtitle}</p>
      <div className="mt-6 flex items-center justify-between">
        <div className="rounded-full bg-secondary px-3 py-1.5 text-xs font-semibold">${(course.price_cents / 100).toFixed(2)}</div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Heart className="h-3 w-3 fill-foreground text-foreground" /> {course.likes}
          <span>•</span>
          <span>{course.duration_label}</span>
        </div>
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-foreground text-background transition-transform group-hover:translate-x-1"><ArrowRight className="h-4 w-4" /></div>
      </div>
    </Link>
  );
}