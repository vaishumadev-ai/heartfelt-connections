import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ArrowLeft, Plus, Pencil, Trash2, GraduationCap, ShieldCheck } from "lucide-react";
import {
  listMyCourses,
  getMyRoles,
  applyForInstructor,
  withdrawInstructorApplication,
  getMyInstructorApplication,
  createCourse,
  deleteCourse,
  type MyCourse,
  type MyApplication,
} from "@/lib/courses.functions";

const myCoursesQO = queryOptions({ queryKey: ["my-courses"], queryFn: () => listMyCourses() });
const myRolesQO = queryOptions({ queryKey: ["my-roles"], queryFn: () => getMyRoles() });
const myAppQO = queryOptions({
  queryKey: ["my-instructor-app"],
  queryFn: () => getMyInstructorApplication(),
});

export const Route = createFileRoute("/_authenticated/studio")({
  head: () => ({
    meta: [
      { title: "Instructor Studio — Mozok" },
      { name: "description", content: "Create and manage your Mozok courses and lessons." },
      { name: "robots", content: "noindex" },
    ],
  }),
  loader: ({ context }) => {
    context.queryClient.ensureQueryData(myRolesQO);
    context.queryClient.ensureQueryData(myAppQO);
  },
  component: Studio,
  errorComponent: ({ error }) => (
    <div className="p-8" role="alert">
      {error.message}
    </div>
  ),
});

function Studio() {
  const { data: roles } = useSuspenseQuery(myRolesQO);
  const isInstructor = roles.includes("instructor");
  const isAdmin = roles.includes("admin");
  const qc = useQueryClient();
  const applyFn = useServerFn(applyForInstructor);
  const withdrawFn = useServerFn(withdrawInstructorApplication);
  const { data: myApp } = useSuspenseQuery(myAppQO);
  const apply = useMutation({
    mutationFn: (v: { reason: string }) => applyFn({ data: { reason: v.reason } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-roles"] });
      qc.invalidateQueries({ queryKey: ["my-instructor-app"] });
    },
  });
  const withdraw = useMutation({
    mutationFn: (id: string) => withdrawFn({ data: { applicationId: id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-instructor-app"] }),
  });

  return (
    <div className="min-h-screen bg-background" style={{ fontFamily: "Poppins, sans-serif" }}>
      <div className="mx-auto max-w-5xl p-4 md:p-8">
        <div className="mb-6 flex items-center justify-between">
          <Link
            to="/dashboard"
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-black"
          >
            <ArrowLeft className="h-4 w-4" /> Back to dashboard
          </Link>
        </div>
        <div className="rounded-3xl bg-card p-6 md:p-10">
          <div className="mb-8 flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-foreground/10 text-foreground">
              <GraduationCap className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-3xl font-bold">Instructor Studio</h1>
              <p className="text-sm text-muted-foreground">Create and manage your courses.</p>
            </div>
          </div>

          {isAdmin && !isInstructor && (
            <AdminOnlyPanel />
          )}
          {isInstructor && <InstructorPanel />}
          {!isInstructor && !isAdmin && (
            <ApplicationPanel
              app={myApp}
              onApply={(reason) => apply.mutate({ reason })}
              onWithdraw={(id) => withdraw.mutate(id)}
              pending={apply.isPending || withdraw.isPending}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function AdminOnlyPanel() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between rounded-2xl bg-foreground/5 p-4 ring-1 ring-border">
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-5 w-5" />
          <div>
            <div className="text-sm font-semibold">Admin console</div>
            <div className="text-xs text-muted-foreground">
              Review pending courses and manage curation.
            </div>
          </div>
        </div>
        <Link
          to="/admin/courses"
          className="rounded-full bg-foreground px-4 py-2 text-xs font-semibold text-primary-foreground"
        >
          Open admin
        </Link>
      </div>
      <p className="rounded-2xl bg-background p-4 text-sm text-muted-foreground">
        You're signed in as an admin. Studio authoring is instructor-only. Apply for an
        instructor role from a separate account if you want to author courses.
      </p>
    </div>
  );
}

function ApplicationPanel({
  app,
  onApply,
  onWithdraw,
  pending,
}: {
  app: MyApplication | null;
  onApply: (reason: string) => void;
  onWithdraw: (id: string) => void;
  pending: boolean;
}) {
  const [reason, setReason] = useState("");
  if (app && app.status === "pending") {
    return (
      <div className="rounded-2xl border border-dashed border-border p-8 text-center">
        <h2 className="text-xl font-semibold">Application pending review</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          An admin will review your request. You'll gain Studio access once approved.
        </p>
        {app.application_reason && (
          <p className="mx-auto mt-4 max-w-md rounded-2xl bg-background p-3 text-left text-sm">
            <span className="text-xs font-semibold uppercase text-muted-foreground">Your note</span>
            <br />
            {app.application_reason}
          </p>
        )}
        <button
          onClick={() => onWithdraw(app.id)}
          disabled={pending}
          className="mt-6 rounded-full bg-card px-5 py-2 text-sm font-semibold ring-1 ring-border disabled:opacity-60"
        >
          Withdraw application
        </button>
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-dashed border-border p-8">
      <h2 className="text-xl font-semibold">Apply to become an instructor</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Mozok is a curated platform. An admin reviews each application before you can build courses.
      </p>
      {app && app.status === "rejected" && app.decision_reason && (
        <p className="mt-4 rounded-2xl bg-background p-3 text-sm">
          <span className="text-xs font-semibold uppercase text-muted-foreground">
            Previous decision
          </span>
          <br />
          {app.decision_reason}
        </p>
      )}
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value.slice(0, 1000))}
        rows={4}
        placeholder="Tell us what you'd like to teach (optional)"
        className="mt-4 w-full resize-none rounded-2xl bg-background p-4 text-sm outline-none ring-1 ring-border focus:ring-foreground"
      />
      <div className="mt-4 flex justify-end">
        <button
          onClick={() => onApply(reason.trim())}
          disabled={pending}
          className="rounded-full bg-foreground px-6 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {pending ? "Submitting…" : "Submit application"}
        </button>
      </div>
    </div>
  );
}

function InstructorPanel() {
  const { data: courses } = useSuspenseQuery(myCoursesQO);
  const { data: roles } = useSuspenseQuery(myRolesQO);
  const isAdmin = roles.includes("admin");
  const qc = useQueryClient();
  const navigate = useNavigate();
  const createFn = useServerFn(createCourse);
  const deleteFn = useServerFn(deleteCourse);

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("Development");

  const create = useMutation({
    mutationFn: (v: { title: string; category: string }) => createFn({ data: v }),
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ["my-courses"] });
      setTitle("");
      if (row?.id) navigate({ to: "/studio/$courseId", params: { courseId: row.id } });
    },
  });

  const remove = useMutation({
    mutationFn: (courseId: string) => deleteFn({ data: { courseId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-courses"] }),
  });

  return (
    <div className="space-y-8">
      {isAdmin && (
        <div className="flex items-center justify-between rounded-2xl bg-foreground/5 p-4 ring-1 ring-border">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-5 w-5" />
            <div>
              <div className="text-sm font-semibold">Admin console</div>
              <div className="text-xs text-muted-foreground">
                Review pending courses and manage curation.
              </div>
            </div>
          </div>
          <Link
            to="/admin/courses"
            className="rounded-full bg-foreground px-4 py-2 text-xs font-semibold text-primary-foreground"
          >
            Open admin
          </Link>
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim()) return;
          create.mutate({ title: title.trim(), category });
        }}
        className="rounded-2xl bg-background p-5"
      >
        <h2 className="mb-3 text-sm font-semibold text-foreground">Create a new course</h2>
        <div className="grid gap-3 md:grid-cols-[1fr_200px_auto]">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Course title"
            className="rounded-full bg-card px-5 py-3 text-sm outline-none ring-1 ring-border focus:ring-foreground"
          />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rounded-full bg-card px-5 py-3 text-sm outline-none ring-1 ring-border"
          >
            {["Development", "Design", "Marketing", "Language", "Security", "Business"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <button
            type="submit"
            disabled={create.isPending}
            className="flex items-center justify-center gap-2 rounded-full bg-foreground px-6 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            <Plus className="h-4 w-4" /> Create
          </button>
        </div>
      </form>

      <div>
        <h2 className="mb-4 text-sm font-semibold text-foreground">Your courses</h2>
        {courses.length === 0 ? (
          <p className="rounded-2xl bg-background p-6 text-sm text-muted-foreground">
            No courses yet. Create your first one above.
          </p>
        ) : (
          <ul className="space-y-3">
            {courses.map((c: MyCourse) => (
              <li
                key={c.id}
                className="flex items-center justify-between rounded-2xl bg-card p-4 ring-1 ring-border"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-base font-semibold">{c.title}</h3>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        c.is_published ? "-foreground -foreground" : "-foreground -foreground"
                      }`}
                    >
                      {c.is_published ? "Published" : "Draft"}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {c.category} · ${(c.price_cents / 100).toFixed(2)}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Link
                    to="/studio/$courseId"
                    params={{ courseId: c.id }}
                    className="flex items-center gap-1 rounded-full bg-black px-4 py-2 text-xs font-semibold text-background"
                  >
                    <Pencil className="h-3 w-3" /> Edit
                  </Link>
                  <button
                    onClick={() => {
                      if (confirm(`Delete "${c.title}"? This cannot be undone.`))
                        remove.mutate(c.id);
                    }}
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-background text-muted-foreground hover:-foreground"
                    title="Delete"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
