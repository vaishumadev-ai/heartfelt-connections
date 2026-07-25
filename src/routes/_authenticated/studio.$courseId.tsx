import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ArrowLeft, Plus, Trash2, Save, Send } from "lucide-react";
import {
  getMyCourse,
  updateCourse,
  upsertLesson,
  deleteLesson,
  submitCourseForReview,
} from "@/lib/courses.functions";

export const Route = createFileRoute("/_authenticated/studio/$courseId")({
  head: () => ({
    meta: [{ title: "Edit course — Mozok Studio" }, { name: "robots", content: "noindex" }],
  }),
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData({
      queryKey: ["my-course", params.courseId],
      queryFn: () => getMyCourse({ data: { courseId: params.courseId } }),
    }),
  component: EditCourse,
  errorComponent: ({ error }) => (
    <div className="p-8" role="alert">
      {error.message}
    </div>
  ),
  notFoundComponent: () => <div className="p-8">Course not found.</div>,
});

function EditCourse() {
  const { courseId } = Route.useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data } = useSuspenseQuery({
    queryKey: ["my-course", courseId],
    queryFn: () => getMyCourse({ data: { courseId } }),
  });

  const updateFn = useServerFn(updateCourse);
  const upsertLessonFn = useServerFn(upsertLesson);
  const deleteLessonFn = useServerFn(deleteLesson);
  const submitFn = useServerFn(submitCourseForReview);

  const course = data?.course;
  const lessons = data?.lessons ?? [];

  const [title, setTitle] = useState(course?.title ?? "");
  const [subtitle, setSubtitle] = useState(course?.subtitle ?? "");
  const [description, setDescription] = useState(course?.description ?? "");
  const [category, setCategory] = useState(course?.category ?? "");
  const [priceDollars, setPriceDollars] = useState(((course?.price_cents ?? 0) / 100).toFixed(2));
  const [duration, setDuration] = useState(course?.duration_label ?? "");
  const [iconKind, setIconKind] = useState(course?.icon_kind ?? "");

  const save = useMutation({
    mutationFn: () =>
      updateFn({
        data: {
          courseId,
          title,
          subtitle: subtitle || null,
          description: description || null,
          category,
          price_cents: Math.round(parseFloat(priceDollars || "0") * 100),
          duration_label: duration || null,
          icon_kind: iconKind || null,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-course", courseId] });
      qc.invalidateQueries({ queryKey: ["my-courses"] });
      qc.invalidateQueries({ queryKey: ["courses"] });
    },
  });

  const submit = useMutation({
    mutationFn: () => submitFn({ data: { courseId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-course", courseId] });
      qc.invalidateQueries({ queryKey: ["my-courses"] });
    },
  });

  const rs = (course as { review_status?: string }).review_status ?? "draft";
  const statusLabel: Record<string, string> = {
    draft: "Draft",
    pending_review: "Pending review",
    approved: "Approved",
    rejected: "Rejected",
  };
  const canSubmit = rs === "draft" || rs === "rejected";
  const isEditable = rs === "draft" || rs === "rejected";
  const lockedMessage =
    rs === "pending_review"
      ? "This course is awaiting admin review. Content is locked until a decision is made."
      : rs === "approved"
        ? "This course is approved and live. An admin must unpublish it for edit before changes can be made."
        : "";

  const addLesson = useMutation({
    mutationFn: (v: { title: string; position: number }) =>
      upsertLessonFn({ data: { courseId, title: v.title, position: v.position } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-course", courseId] }),
  });

  const removeLesson = useMutation({
    mutationFn: (lessonId: string) => deleteLessonFn({ data: { lessonId, courseId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-course", courseId] }),
  });

  const [newLessonTitle, setNewLessonTitle] = useState("");

  if (!data || !course) {
    return (
      <div className="p-8">
        Course not found.{" "}
        <Link to="/studio" className="text-foreground underline">
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
            to="/studio"
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-black"
          >
            <ArrowLeft className="h-4 w-4" /> Studio
          </Link>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-card px-3 py-1 text-[11px] font-semibold ring-1 ring-border">
              {statusLabel[rs] ?? rs}
            </span>
            <button
              onClick={() => submit.mutate()}
              disabled={submit.isPending || !canSubmit}
              title={
                canSubmit
                  ? "Send this course to admins for review"
                  : rs === "pending_review"
                    ? "Already pending review"
                    : "Already approved — publish state is admin-controlled"
              }
              className="flex items-center gap-2 rounded-full bg-black px-4 py-2 text-xs font-semibold text-background disabled:opacity-50"
            >
              <Send className="h-3 w-3" />
              {submit.isPending ? "Submitting…" : "Submit for review"}
            </button>
            {course.is_published && (
              <button
                onClick={() => navigate({ to: "/courses/$slug", params: { slug: course.slug } })}
                className="rounded-full bg-card px-4 py-2 text-xs font-semibold ring-1 ring-border"
              >
                View live
              </button>
            )}
          </div>
        </div>
        {rs === "rejected" &&
          (course as { review_decision_reason?: string | null }).review_decision_reason && (
            <div className="mb-6 rounded-2xl bg-card p-4 text-sm ring-1 ring-border">
              <span className="text-xs font-semibold uppercase text-muted-foreground">
                Reviewer feedback
              </span>
              <p className="mt-1">
                {(course as { review_decision_reason?: string | null }).review_decision_reason}
              </p>
            </div>
          )}
        {!isEditable && lockedMessage && (
          <div
            role="status"
            className="mb-6 rounded-2xl bg-foreground/5 p-4 text-sm ring-1 ring-border"
          >
            <span className="text-xs font-semibold uppercase text-muted-foreground">Locked</span>
            <p className="mt-1">{lockedMessage}</p>
          </div>
        )}

        <div className="rounded-3xl bg-card p-6 md:p-8">
          <h1 className="text-2xl font-bold">Course details</h1>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <Field label="Title">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label="Category">
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className={inputCls}
              >
                {["Development", "Design", "Marketing", "Language", "Security", "Business"].map(
                  (c) => (
                    <option key={c}>{c}</option>
                  ),
                )}
              </select>
            </Field>
            <Field label="Subtitle" full>
              <input
                value={subtitle}
                onChange={(e) => setSubtitle(e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label="Description" full>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                className={`${inputCls} resize-none`}
              />
            </Field>
            <Field label="Price (USD)">
              <input
                type="number"
                step="0.01"
                value={priceDollars}
                onChange={(e) => setPriceDollars(e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label="Duration label">
              <input
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                placeholder="e.g. 6h 30m"
                className={inputCls}
              />
            </Field>
            <Field label="Icon kind">
              <select
                value={iconKind}
                onChange={(e) => setIconKind(e.target.value)}
                className={inputCls}
              >
                <option value="">None</option>
                {["megaphone", "pencil", "cyber", "js", "html"].map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="mt-6 flex justify-end">
            <button
              onClick={() => save.mutate()}
              disabled={save.isPending}
              className="flex items-center gap-2 rounded-full bg-foreground px-6 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              <Save className="h-4 w-4" /> {save.isPending ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>

        <div className="mt-6 rounded-3xl bg-card p-6 md:p-8">
          <h2 className="text-xl font-bold">Lessons</h2>
          <ul className="mt-4 space-y-2">
            {lessons.map((l) => (
              <LessonRow
                key={l.id}
                lesson={l}
                courseId={courseId}
                onDelete={() => {
                  if (confirm(`Delete "${l.title}"?`)) removeLesson.mutate(l.id);
                }}
              />
            ))}
            {lessons.length === 0 && (
              <li className="rounded-2xl bg-background p-4 text-sm text-muted-foreground">
                No lessons yet.
              </li>
            )}
          </ul>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!newLessonTitle.trim()) return;
              addLesson.mutate({
                title: newLessonTitle.trim(),
                position: (lessons[lessons.length - 1]?.position ?? 0) + 1,
              });
              setNewLessonTitle("");
            }}
            className="mt-4 flex gap-2"
          >
            <input
              value={newLessonTitle}
              onChange={(e) => setNewLessonTitle(e.target.value)}
              placeholder="New lesson title"
              className={inputCls}
            />
            <button
              type="submit"
              className="flex items-center gap-2 rounded-full bg-black px-5 py-3 text-sm font-semibold text-background"
            >
              <Plus className="h-4 w-4" /> Add
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

const inputCls =
  "w-full rounded-2xl bg-background px-4 py-3 text-sm outline-none ring-1 ring-transparent focus:ring-foreground";

function Field({
  label,
  children,
  full,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <label className={`block ${full ? "md:col-span-2" : ""}`}>
      <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function LessonRow({
  lesson,
  courseId,
  onDelete,
}: {
  lesson: {
    id: string;
    title: string;
    position: number;
    duration_seconds: number | null;
    content: string | null;
    video_url: string | null;
  };
  courseId: string;
  onDelete: () => void;
}) {
  const qc = useQueryClient();
  const upsertLessonFn = useServerFn(upsertLesson);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(lesson.title);
  const [content, setContent] = useState(lesson.content ?? "");
  const [videoUrl, setVideoUrl] = useState(lesson.video_url ?? "");
  const [dur, setDur] = useState(lesson.duration_seconds?.toString() ?? "");

  const save = useMutation({
    mutationFn: () =>
      upsertLessonFn({
        data: {
          lessonId: lesson.id,
          courseId,
          title,
          position: lesson.position,
          content: content || null,
          video_url: videoUrl || null,
          duration_seconds: dur ? parseInt(dur, 10) : null,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-course", courseId] });
      setOpen(false);
    },
  });

  return (
    <li className="rounded-2xl bg-background">
      <div className="flex items-center justify-between p-4">
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-card text-xs font-bold">
            {lesson.position}
          </span>
          <span className="text-sm font-semibold">{lesson.title}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setOpen((v) => !v)}
            className="rounded-full bg-card px-3 py-1.5 text-xs font-semibold"
          >
            {open ? "Close" : "Edit"}
          </button>
          <button
            onClick={onDelete}
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
      {open && (
        <div className="grid gap-3 border-t border-border/60 p-4 md:grid-cols-2">
          <label className="md:col-span-2">
            <span className="mb-1 block text-xs font-semibold text-muted-foreground">Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
          </label>
          <label>
            <span className="mb-1 block text-xs font-semibold text-muted-foreground">
              Video URL
            </span>
            <input
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              className={inputCls}
            />
          </label>
          <label>
            <span className="mb-1 block text-xs font-semibold text-muted-foreground">
              Duration (seconds)
            </span>
            <input
              value={dur}
              onChange={(e) => setDur(e.target.value)}
              inputMode="numeric"
              className={inputCls}
            />
          </label>
          <label className="md:col-span-2">
            <span className="mb-1 block text-xs font-semibold text-muted-foreground">Content</span>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={5}
              className={`${inputCls} resize-none`}
            />
          </label>
          <div className="md:col-span-2 flex justify-end">
            <button
              onClick={() => save.mutate()}
              disabled={save.isPending}
              className="flex items-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              <Save className="h-4 w-4" /> Save lesson
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
