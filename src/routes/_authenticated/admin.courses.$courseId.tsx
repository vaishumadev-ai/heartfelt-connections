import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient, useMutation, useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ArrowLeft, AlertTriangle } from "lucide-react";
import {
  getAdminCourse,
  unpublishForEdit,
  mapCourseGovernanceError,
} from "@/lib/courses.functions";

export const Route = createFileRoute("/_authenticated/admin/courses/$courseId")({
  head: () => ({
    meta: [{ title: "Admin · Course detail — Mozok" }, { name: "robots", content: "noindex" }],
  }),
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(
      queryOptions({
        queryKey: ["admin-course", params.courseId],
        queryFn: () => getAdminCourse({ data: { courseId: params.courseId } }),
      }),
    ),
  component: AdminCourseDetail,
  errorComponent: ({ error }) => (
    <div className="p-8" role="alert">
      {mapCourseGovernanceError(error)}
    </div>
  ),
  notFoundComponent: () => <div className="p-8">Course not found.</div>,
});

function AdminCourseDetail() {
  const { courseId } = Route.useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data } = useSuspenseQuery(
    queryOptions({
      queryKey: ["admin-course", courseId],
      queryFn: () => getAdminCourse({ data: { courseId } }),
    }),
  );
  const unpublishFn = useServerFn(unpublishForEdit);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const unpublish = useMutation({
    mutationFn: (v: { reason: string }) => unpublishFn({ data: { courseId, reason: v.reason } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-course", courseId] });
      qc.invalidateQueries({ queryKey: ["admin-courses"] });
      qc.invalidateQueries({ queryKey: ["courses"] });
      navigate({ to: "/admin/courses" });
    },
    onError: (e: Error) => setErr(mapCourseGovernanceError(e)),
  });

  if (!data) {
    return (
      <div className="p-8">
        Course not found.{" "}
        <Link to="/admin/courses" className="underline">
          Back
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background" style={{ fontFamily: "Poppins, sans-serif" }}>
      <div className="mx-auto max-w-4xl p-4 md:p-8">
        <div className="mb-6 flex items-center justify-between">
          <Link
            to="/admin/courses"
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-black"
          >
            <ArrowLeft className="h-4 w-4" /> All courses
          </Link>
          <span className="rounded-full bg-card px-3 py-1 text-[11px] font-semibold ring-1 ring-border">
            {data.is_published ? "Published · " : ""}
            {data.review_status.replace("_", " ")}
          </span>
        </div>
        <div className="rounded-3xl bg-card p-6 md:p-8 ring-1 ring-border">
          <h1 className="text-2xl font-bold">{data.title}</h1>
          {data.subtitle && <p className="mt-1 text-muted-foreground">{data.subtitle}</p>}
          <div className="mt-4 text-sm text-muted-foreground">
            {data.category} · {data.instructor_name ?? "—"} · ${(data.price_cents / 100).toFixed(2)}
          </div>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <Stat label="Enrollments" value={data.enrollments_count} />
            <Stat label="Completions" value={data.completions_count} />
            <Stat label="Reviews" value={data.reviews_count} />
          </div>
          {data.description && (
            <div className="mt-6 rounded-2xl bg-background p-4 text-sm">
              <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                Description
              </div>
              {data.description}
            </div>
          )}
        </div>

        <div className="mt-6 rounded-3xl bg-card p-6 md:p-8 ring-1 ring-border">
          <h2 className="text-lg font-bold">Lessons</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Read-only metadata. Content and video URLs are never shown here.
          </p>
          {data.lessons.length === 0 ? (
            <div className="mt-4 rounded-2xl bg-background p-4 text-sm text-muted-foreground">
              No lessons.
            </div>
          ) : (
            <ol className="mt-4 space-y-2">
              {data.lessons.map((l) => (
                <li
                  key={l.id}
                  className="flex items-center justify-between rounded-2xl bg-background p-3 text-sm"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-card text-xs font-bold">
                      {l.position}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{l.title}</div>
                      {l.module_title && (
                        <div className="text-[11px] text-muted-foreground">{l.module_title}</div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    {l.is_preview && (
                      <span className="rounded-full bg-foreground/10 px-2 py-0.5 font-semibold">
                        Preview
                      </span>
                    )}
                    {l.duration_seconds != null && (
                      <span>{Math.round(l.duration_seconds / 60)}m</span>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="mt-6 rounded-3xl bg-card p-6 md:p-8 ring-1 ring-border">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-foreground" />
            <h2 className="text-lg font-bold">Unpublish for edit</h2>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Returns an approved, published course to draft so the instructor can revise and
            resubmit. Allowed only when there are no learner enrollments, completions, or reviews.
          </p>
          {!data.can_unpublish ? (
            <div className="mt-4 rounded-2xl bg-background p-4 text-sm text-muted-foreground">
              This course cannot be unpublished from here. It must be approved and published, with
              zero enrollments and zero completions.
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setErr(null);
                if (!reason.trim()) {
                  setErr("Reason required");
                  return;
                }
                unpublish.mutate({ reason: reason.trim() });
              }}
              className="mt-4"
            >
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-muted-foreground">
                  Reason (audited)
                </span>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value.slice(0, 1000))}
                  rows={4}
                  placeholder="Why is this course being returned to draft?"
                  className="w-full resize-none rounded-2xl bg-background p-3 text-sm outline-none ring-1 ring-border focus:ring-foreground"
                />
              </label>
              {err && (
                <div
                  className="mt-3 rounded-2xl bg-destructive/10 p-3 text-sm text-destructive"
                  role="alert"
                >
                  {err}
                </div>
              )}
              <div className="mt-4 flex justify-end">
                <button
                  type="submit"
                  disabled={unpublish.isPending || !reason.trim()}
                  className="rounded-full bg-foreground px-5 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                >
                  {unpublish.isPending ? "Unpublishing…" : "Unpublish for edit"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-background p-4">
      <div className="text-xs font-semibold uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
    </div>
  );
}
