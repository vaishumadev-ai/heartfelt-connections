import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ArrowLeft, Plus, Pencil, Trash2, GraduationCap } from "lucide-react";
import {
  listMyCourses,
  getMyRoles,
  becomeInstructor,
  createCourse,
  deleteCourse,
  type MyCourse,
} from "@/lib/courses.functions";

const myCoursesQO = queryOptions({ queryKey: ["my-courses"], queryFn: () => listMyCourses() });
const myRolesQO = queryOptions({ queryKey: ["my-roles"], queryFn: () => getMyRoles() });

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
    context.queryClient.ensureQueryData(myCoursesQO);
  },
  component: Studio,
  errorComponent: ({ error }) => <div className="p-8" role="alert">{error.message}</div>,
});

function Studio() {
  const { data: roles } = useSuspenseQuery(myRolesQO);
  const isInstructor = roles.includes("instructor") || roles.includes("admin");
  const qc = useQueryClient();
  const becomeFn = useServerFn(becomeInstructor);
  const become = useMutation({
    mutationFn: () => becomeFn(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-roles"] }),
  });

  return (
    <div className="min-h-screen bg-background" style={{ fontFamily: "Instrument Serif, serif" }}>
      <div className="mx-auto max-w-5xl p-4 md:p-8">
        <div className="mb-6 flex items-center justify-between">
          <Link to="/dashboard" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-black">
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

          {!isInstructor ? (
            <div className="rounded-2xl border border-dashed border-border p-8 text-center">
              <h2 className="text-xl font-semibold">Become an instructor</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Publish courses on Mozok. It only takes a click.
              </p>
              <button
                onClick={() => become.mutate()}
                disabled={become.isPending}
                className="mt-6 rounded-full bg-foreground px-6 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                {become.isPending ? "Enabling…" : "Enable instructor mode"}
              </button>
            </div>
          ) : (
            <InstructorPanel />
          )}
        </div>
      </div>
    </div>
  );
}

function InstructorPanel() {
  const { data: courses } = useSuspenseQuery(myCoursesQO);
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
            className="rounded-full bg-card px-5 py-3 text-sm outline-none ring-1 ring-border focus:ring-[#ff5a6a]"
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
          <p className="rounded-2xl bg-background p-6 text-sm text-muted-foreground">No courses yet. Create your first one above.</p>
        ) : (
          <ul className="space-y-3">
            {courses.map((c: MyCourse) => (
              <li key={c.id} className="flex items-center justify-between rounded-2xl bg-card p-4 ring-1 ring-border">
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
                      if (confirm(`Delete "${c.title}"? This cannot be undone.`)) remove.mutate(c.id);
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