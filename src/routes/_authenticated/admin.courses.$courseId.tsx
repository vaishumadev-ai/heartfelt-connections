import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient, useMutation, useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ArrowLeft, AlertTriangle, CheckCircle2, XCircle, ExternalLink } from "lucide-react";
import {
  getAdminCourse,
  unpublishForEdit,
  approveCourse,
  rejectCourse,
  mapCourseGovernanceError,
} from "@/lib/courses.functions";
import type { CourseReadinessBlocker } from "@/lib/course-readiness";

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
  const approveFn = useServerFn(approveCourse);
  const rejectFn = useServerFn(rejectCourse);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectErr, setRejectErr] = useState<string | null>(null);
  const [approveBlockers, setApproveBlockers] = useState<CourseReadinessBlocker[] | null>(null);

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

  const approve = useMutation({
    mutationFn: () => approveFn({ data: { courseId } }),
    onSuccess: (res) => {
      if (res.ok) {
        setConfirmApprove(false);
        setApproveBlockers(null);
        // Public catalogue and admin views must reflect the new published state.
        qc.invalidateQueries({ queryKey: ["admin-course", courseId] });
        qc.invalidateQueries({ queryKey: ["admin-courses"] });
        qc.invalidateQueries({ queryKey: ["courses"] });
        qc.invalidateQueries({ queryKey: ["course"] });
      } else {
        // Readiness regressed between submission and admin review.
        setApproveBlockers(res.blockers);
      }
    },
    onError: (e: Error) => setErr(mapCourseGovernanceError(e)),
  });

  const reject = useMutation({
    mutationFn: (v: { reason: string }) => rejectFn({ data: { courseId, reason: v.reason } }),
    onSuccess: () => {
      setRejectOpen(false);
      setRejectReason("");
      qc.invalidateQueries({ queryKey: ["admin-course", courseId] });
      qc.invalidateQueries({ queryKey: ["admin-courses"] });
    },
    onError: (e: Error) => setRejectErr(mapCourseGovernanceError(e)),
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

  const isPending = data.review_status === "pending_review";

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
          <div className="flex items-center gap-2">
            <Link
              to="/courses/$slug"
              params={{ slug: data.slug }}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 rounded-full bg-card px-3 py-1 text-[11px] font-semibold ring-1 ring-border hover:bg-foreground/5"
            >
              <ExternalLink className="h-3 w-3" /> Preview as learner
            </Link>
            <Link
              to="/admin/instructors"
              className="rounded-full bg-card px-3 py-1 text-[11px] font-semibold ring-1 ring-border hover:bg-foreground/5"
            >
              Instructor applications
            </Link>
            <span className="rounded-full bg-card px-3 py-1 text-[11px] font-semibold ring-1 ring-border">
              {data.is_published ? "Published · " : ""}
              {data.review_status.replace("_", " ")}
            </span>
          </div>
        </div>

        {isPending && (
          <div className="mb-6 rounded-3xl bg-card p-6 md:p-8 ring-1 ring-border">
            <h2 className="text-lg font-bold">Pending review</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Approving publishes this course to the public catalogue. Rejection sends it back to
              the instructor with your feedback. Readiness is re-checked at approval time.
            </p>
            {data.review_decision_reason && (
              <div className="mt-3 rounded-2xl bg-background p-3 text-xs">
                <div className="mb-1 font-semibold uppercase text-muted-foreground">
                  Previous decision reason
                </div>
                {data.review_decision_reason}
              </div>
            )}
            {approveBlockers && approveBlockers.length > 0 && (
              <div
                role="alert"
                className="mt-4 rounded-2xl bg-destructive/10 p-4 text-sm text-destructive"
              >
                <div className="mb-2 font-semibold">
                  Approval refused — readiness regressed while pending
                </div>
                <ul className="list-inside list-disc space-y-1">
                  {approveBlockers.map((b, i) => (
                    <li key={i}>{b.message}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setApproveBlockers(null);
                  setConfirmApprove(true);
                }}
                disabled={approve.isPending}
                className="flex items-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                <CheckCircle2 className="h-4 w-4" /> Approve &amp; publish
              </button>
              <button
                type="button"
                onClick={() => {
                  setRejectErr(null);
                  setRejectOpen(true);
                }}
                disabled={reject.isPending}
                className="flex items-center gap-2 rounded-full bg-card px-5 py-2.5 text-sm font-semibold ring-1 ring-border hover:bg-foreground/5 disabled:opacity-60"
              >
                <XCircle className="h-4 w-4" /> Reject with reason
              </button>
            </div>
          </div>
        )}

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

        {confirmApprove && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Confirm approval"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          >
            <div className="w-full max-w-md rounded-3xl bg-card p-6 ring-1 ring-border">
              <h3 className="text-lg font-bold">Approve and publish?</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                This publishes "{data.title}" to the public catalogue and notifies the instructor.
                Course readiness will be re-checked atomically. This action cannot be silently
                undone.
              </p>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmApprove(false)}
                  disabled={approve.isPending}
                  className="rounded-full bg-background px-4 py-2 text-sm font-semibold ring-1 ring-border disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => approve.mutate()}
                  disabled={approve.isPending}
                  aria-busy={approve.isPending}
                  className="rounded-full bg-foreground px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                >
                  {approve.isPending ? "Approving…" : "Yes, publish"}
                </button>
              </div>
            </div>
          </div>
        )}

        {rejectOpen && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Reject course"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          >
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setRejectErr(null);
                const r = rejectReason.trim();
                if (!r) {
                  setRejectErr("Reason required");
                  return;
                }
                reject.mutate({ reason: r });
              }}
              className="w-full max-w-md rounded-3xl bg-card p-6 ring-1 ring-border"
            >
              <h3 className="text-lg font-bold">Reject with reason</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                The instructor sees this reason and receives a notification linking back to the
                studio.
              </p>
              <label className="mt-4 block">
                <span className="mb-1 block text-xs font-semibold text-muted-foreground">
                  Reason (required)
                </span>
                <textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value.slice(0, 1000))}
                  rows={4}
                  placeholder="What must the instructor change?"
                  className="w-full resize-none rounded-2xl bg-background p-3 text-sm outline-none ring-1 ring-border focus:ring-foreground"
                />
              </label>
              {rejectErr && (
                <div
                  role="alert"
                  className="mt-3 rounded-2xl bg-destructive/10 p-3 text-sm text-destructive"
                >
                  {rejectErr}
                </div>
              )}
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRejectOpen(false)}
                  disabled={reject.isPending}
                  className="rounded-full bg-background px-4 py-2 text-sm font-semibold ring-1 ring-border disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={reject.isPending || !rejectReason.trim()}
                  aria-busy={reject.isPending}
                  className="rounded-full bg-foreground px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                >
                  {reject.isPending ? "Rejecting…" : "Reject"}
                </button>
              </div>
            </form>
          </div>
        )}
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
