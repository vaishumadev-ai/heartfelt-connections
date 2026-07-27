import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import {
  listAdminCourses,
  mapCourseGovernanceError,
  type AdminCourseRow,
} from "@/lib/courses.functions";

const adminCoursesQO = queryOptions({
  queryKey: ["admin-courses"],
  queryFn: () => listAdminCourses(),
});

export const Route = createFileRoute("/_authenticated/admin/courses")({
  head: () => ({
    meta: [
      { title: "Admin · Courses — Mozok" },
      { name: "description", content: "Admin console for curated course governance." },
      { name: "robots", content: "noindex" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(adminCoursesQO),
  component: AdminCourses,
  errorComponent: ({ error }) => (
    <div className="p-8" role="alert">
      {mapCourseGovernanceError(error)}
    </div>
  ),
});

const statusStyle: Record<string, string> = {
  draft: "bg-background text-muted-foreground",
  pending_review: "bg-foreground/10 text-foreground",
  approved: "bg-foreground text-primary-foreground",
  rejected: "bg-destructive/10 text-destructive",
};

function AdminCourses() {
  const { data } = useSuspenseQuery(adminCoursesQO);
  type Filter = "pending" | "approved" | "rejected" | "draft" | "all";
  const [filter, setFilter] = useState<Filter>("pending");
  const counts = useMemo(() => {
    const c = { pending: 0, approved: 0, rejected: 0, draft: 0, all: data.length };
    for (const r of data) {
      if (r.review_status === "pending_review") c.pending++;
      else if (r.review_status === "approved") c.approved++;
      else if (r.review_status === "rejected") c.rejected++;
      else if (r.review_status === "draft") c.draft++;
    }
    return c;
  }, [data]);
  const rows = useMemo(() => {
    if (filter === "all") return data;
    const status =
      filter === "pending"
        ? "pending_review"
        : filter === "approved"
          ? "approved"
          : filter === "rejected"
            ? "rejected"
            : "draft";
    return data.filter((c) => c.review_status === status);
  }, [data, filter]);
  const tabs: Array<{ id: Filter; label: string; count: number }> = [
    { id: "pending", label: "Pending review", count: counts.pending },
    { id: "approved", label: "Approved", count: counts.approved },
    { id: "rejected", label: "Rejected", count: counts.rejected },
    { id: "draft", label: "Draft", count: counts.draft },
    { id: "all", label: "All", count: counts.all },
  ];
  return (
    <div className="min-h-screen bg-background" style={{ fontFamily: "Poppins, sans-serif" }}>
      <div className="mx-auto max-w-6xl p-4 md:p-8">
        <div className="mb-6 flex items-center justify-between">
          <Link
            to="/dashboard"
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-black"
          >
            <ArrowLeft className="h-4 w-4" /> Dashboard
          </Link>
          <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
            <ShieldCheck className="h-4 w-4" /> Admin console
          </div>
        </div>
        <nav
          aria-label="Admin sections"
          className="mb-6 flex flex-wrap gap-2 text-xs font-semibold"
        >
          <span className="rounded-full bg-foreground px-4 py-1.5 text-primary-foreground">
            Courses
          </span>
          <Link
            to="/admin/instructors"
            className="rounded-full bg-card px-4 py-1.5 ring-1 ring-border hover:bg-foreground/5"
          >
            Instructor applications
          </Link>
        </nav>
        <div className="rounded-3xl bg-card p-6 md:p-8 ring-1 ring-border">
          <h1 className="text-2xl font-bold">Course governance</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Read-only overview. Use the detail page to review or unpublish an approved course with
            zero learner history.
          </p>
          <div
            role="tablist"
            aria-label="Filter courses by review status"
            className="mt-4 flex flex-wrap gap-2"
          >
            {tabs.map((t) => {
              const active = filter === t.id;
              return (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setFilter(t.id)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-border ${
                    active
                      ? "bg-foreground text-primary-foreground"
                      : "bg-card hover:bg-foreground/5"
                  }`}
                >
                  {t.label}
                  <span
                    className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] ${
                      active ? "bg-primary-foreground/20" : "bg-foreground/10"
                    }`}
                  >
                    {t.count}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-6 overflow-hidden rounded-2xl ring-1 ring-border">
            <table className="w-full text-sm">
              <thead className="bg-background text-left text-[11px] uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Course</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Enrollments</th>
                  <th className="px-4 py-3">Completions</th>
                  <th className="px-4 py-3">Reviews</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                      No courses in this view.
                    </td>
                  </tr>
                )}
                {rows.map((c: AdminCourseRow) => (
                  <tr key={c.id} className="border-t border-border/60">
                    <td className="px-4 py-3">
                      <div className="font-semibold">{c.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {c.category} · {c.instructor_name ?? "—"}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          statusStyle[c.review_status] ?? "bg-background"
                        }`}
                      >
                        {c.is_published ? "Published · " : ""}
                        {c.review_status.replace("_", " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3">{c.enrollments_count}</td>
                    <td className="px-4 py-3">{c.completions_count}</td>
                    <td className="px-4 py-3">{c.reviews_count}</td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        to="/admin/courses/$courseId"
                        params={{ courseId: c.id }}
                        className="rounded-full bg-foreground px-3 py-1.5 text-xs font-semibold text-primary-foreground"
                      >
                        Review
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
