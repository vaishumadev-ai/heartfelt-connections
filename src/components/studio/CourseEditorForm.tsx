import { useSuspenseQuery, useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Plus, Trash2, Save, Send, ArrowUp, ArrowDown } from "lucide-react";
import {
  getMyCourse,
  updateCourse,
  upsertLesson,
  deleteLesson,
  reorderLessons,
  submitCourseForReview,
  getCourseReadiness,
  isCourseEditable,
  mapCourseGovernanceError,
  COURSE_UPDATE_LIMITS,
  type SubmitCourseResult,
} from "@/lib/courses.functions";
import { StructuredListEditor } from "@/components/studio/StructuredListEditor";
import { FaqEditor, type FaqPair } from "@/components/studio/FaqEditor";
import { ReadinessPanel } from "@/components/studio/ReadinessPanel";
import { CoverUploader } from "@/components/studio/CoverUploader";
import { useUnsavedGuard } from "@/components/lesson-tools/UnsavedGuard";
import type { CourseReadinessBlocker } from "@/lib/course-readiness";

const CATEGORIES = ["Development", "Design", "Marketing", "Language", "Security", "Business"];
const LEVELS = ["Beginner", "Intermediate", "Advanced"];
const LANGUAGES = ["English", "Spanish", "French", "German", "Portuguese"];

type SaveStatus = "clean" | "unsaved" | "saving" | "saved" | "failed";

type FormState = {
  title: string;
  subtitle: string;
  description: string;
  category: string;
  level: string;
  language: string;
  duration_label: string;
  priceDollars: string;
  instructor_name: string;
  instructor_title: string;
  instructor_bio: string;
  learn_outcomes: string[];
  skills: string[];
  requirements: string[];
  audience: string[];
  faq: FaqPair[];
};

function hydrate(course: Record<string, unknown> | null | undefined): FormState {
  const c = course ?? {};
  return {
    title: (c.title as string) ?? "",
    subtitle: (c.subtitle as string) ?? "",
    description: (c.description as string) ?? "",
    category: (c.category as string) ?? "",
    level: (c.level as string) ?? "Beginner",
    language: (c.language as string) ?? "English",
    duration_label: (c.duration_label as string) ?? "",
    priceDollars: (((c.price_cents as number) ?? 0) / 100).toFixed(2),
    instructor_name: (c.instructor_name as string) ?? "",
    instructor_title: (c.instructor_title as string) ?? "",
    instructor_bio: (c.instructor_bio as string) ?? "",
    learn_outcomes: Array.isArray(c.learn_outcomes) ? (c.learn_outcomes as string[]) : [],
    skills: Array.isArray(c.skills) ? (c.skills as string[]) : [],
    requirements: Array.isArray(c.requirements) ? (c.requirements as string[]) : [],
    audience: Array.isArray(c.audience) ? (c.audience as string[]) : [],
    faq: Array.isArray(c.faq) ? (c.faq as FaqPair[]) : [],
  };
}

function equalState(a: FormState, b: FormState): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export type CourseEditorFormProps = { courseId: string };

/**
 * Route-agnostic Course Editor. Extracted from the studio.$courseId route so
 * behavioral tests can mount the exact production form without the router.
 * The route file must render this component and nothing else form-related.
 */
export function CourseEditorForm({ courseId }: CourseEditorFormProps) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const guard = useUnsavedGuard();

  const { data } = useSuspenseQuery({
    queryKey: ["my-course", courseId],
    queryFn: () => getMyCourse({ data: { courseId } }),
  });

  const updateFn = useServerFn(updateCourse);
  const upsertLessonFn = useServerFn(upsertLesson);
  const deleteLessonFn = useServerFn(deleteLesson);
  const reorderLessonsFn = useServerFn(reorderLessons);
  const submitFn = useServerFn(submitCourseForReview);
  const readinessFn = useServerFn(getCourseReadiness);

  const course = data?.course as
    | (Record<string, unknown> & {
        id: string;
        slug: string;
        is_published?: boolean | null;
        review_status?: string | null;
        cover_storage_path?: string | null;
        cover_url?: string | null;
      })
    | null
    | undefined;
  const lessons = useMemo(() => data?.lessons ?? [], [data?.lessons]);
  const rs = (course?.review_status ?? "draft") as string;
  const isEditable = isCourseEditable({
    is_published: course?.is_published,
    review_status: rs,
  });
  const lockedMessage =
    rs === "pending_review"
      ? "This course is awaiting admin review. Content is locked until a decision is made."
      : rs === "approved"
        ? "This course is approved and live. An admin must unpublish it for edit before changes can be made."
        : "";

  const baseline = useMemo(() => hydrate(course as Record<string, unknown>), [course]);
  const [form, setForm] = useState<FormState>(baseline);
  const [savedBaseline, setSavedBaseline] = useState<FormState>(baseline);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("clean");
  const [saveError, setSaveError] = useState<string | null>(null);
  const courseIdRef = useRef(courseId);

  useEffect(() => {
    courseIdRef.current = courseId;
    setForm(baseline);
    setSavedBaseline(baseline);
    setSaveStatus("clean");
    setSaveError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  useEffect(() => {
    if (equalState(form, savedBaseline)) {
      setForm(baseline);
      setSavedBaseline(baseline);
      setSaveStatus((s) => (s === "saved" || s === "clean" ? "clean" : s));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseline]);

  const dirty = !equalState(form, savedBaseline);
  useEffect(() => {
    if (dirty && saveStatus === "clean") setSaveStatus("unsaved");
    if (!dirty && saveStatus === "unsaved") setSaveStatus("clean");
  }, [dirty, saveStatus]);

  useEffect(() => {
    return guard.registerDirtyChecker(`studio-course-${courseId}`, () => dirty);
  }, [guard, courseId, dirty]);

  const patch = useCallback(<K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
  }, []);

  const readinessQ = useQuery({
    queryKey: ["course-readiness", courseId],
    queryFn: () => readinessFn({ data: { courseId } }),
    enabled: !!course,
  });
  const [submissionBlockers, setSubmissionBlockers] = useState<CourseReadinessBlocker[] | null>(
    null,
  );
  const displayBlockers = submissionBlockers ?? readinessQ.data?.blockers ?? [];
  const isReady = submissionBlockers ? false : !!readinessQ.data?.is_ready;

  const saveInFlight = useRef(false);
  const save = useMutation({
    mutationFn: async () => {
      if (saveInFlight.current) throw new Error("stale_course");
      saveInFlight.current = true;
      const capturedId = courseIdRef.current;
      if (capturedId !== courseId) throw new Error("stale_course");
      setSaveStatus("saving");
      setSaveError(null);
      try {
        await updateFn({
          data: {
            courseId,
            title: form.title,
            subtitle: form.subtitle || null,
            description: form.description || null,
            category: form.category,
            level: form.level,
            language: form.language,
            duration_label: form.duration_label || null,
            price_cents: Math.round(parseFloat(form.priceDollars || "0") * 100),
            instructor_name: form.instructor_name || null,
            instructor_title: form.instructor_title || null,
            instructor_bio: form.instructor_bio || null,
            learn_outcomes: form.learn_outcomes,
            skills: form.skills,
            requirements: form.requirements,
            audience: form.audience,
            faq: form.faq,
          },
        });
      } finally {
        saveInFlight.current = false;
      }
      if (courseIdRef.current !== capturedId) throw new Error("stale_course");
      return capturedId;
    },
    onSuccess: (capturedId) => {
      if (capturedId !== courseIdRef.current) return;
      setSavedBaseline(form);
      setSaveStatus("saved");
      qc.invalidateQueries({ queryKey: ["my-course", courseId] });
      qc.invalidateQueries({ queryKey: ["my-courses"] });
      qc.invalidateQueries({ queryKey: ["courses"] });
      qc.invalidateQueries({ queryKey: ["course-readiness", courseId] });
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : "";
      if (msg === "stale_course") return;
      setSaveStatus("failed");
      setSaveError(mapCourseGovernanceError(err));
    },
  });

  const submit = useMutation({
    mutationFn: () => submitFn({ data: { courseId } }) as Promise<SubmitCourseResult>,
    onSuccess: (res) => {
      if (res.ok) {
        setSubmissionBlockers(null);
        qc.invalidateQueries({ queryKey: ["my-course", courseId] });
        qc.invalidateQueries({ queryKey: ["my-courses"] });
        qc.invalidateQueries({ queryKey: ["course-readiness", courseId] });
        return;
      }
      if (res.code === "course_not_ready") {
        setSubmissionBlockers(res.blockers);
        qc.invalidateQueries({ queryKey: ["course-readiness", courseId] });
      } else {
        setSubmissionBlockers([]);
      }
    },
  });

  const focusTarget = useCallback((target: string) => {
    const el = document.getElementById(target);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    if (
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      el instanceof HTMLSelectElement
    ) {
      el.focus();
    }
  }, []);

  const addLesson = useMutation({
    mutationFn: (v: { title: string; position: number }) =>
      upsertLessonFn({ data: { courseId, title: v.title, position: v.position } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-course", courseId] });
      qc.invalidateQueries({ queryKey: ["course-readiness", courseId] });
    },
  });
  const removeLesson = useMutation({
    mutationFn: (lessonId: string) => deleteLessonFn({ data: { lessonId, courseId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-course", courseId] });
      qc.invalidateQueries({ queryKey: ["course-readiness", courseId] });
    },
  });

  const [reorderAnnounce, setReorderAnnounce] = useState<string>("");
  const [reorderError, setReorderError] = useState<string | null>(null);
  const pendingFocusLessonId = useRef<string | null>(null);
  const reorder = useMutation({
    mutationFn: (v: { lessonIds: string[] }) =>
      reorderLessonsFn({ data: { courseId, lessonIds: v.lessonIds } }),
    onSuccess: () => {
      setReorderError(null);
      qc.invalidateQueries({ queryKey: ["my-course", courseId] });
      qc.invalidateQueries({ queryKey: ["course-readiness", courseId] });
    },
    onError: (err) => {
      setReorderError(mapCourseGovernanceError(err));
      pendingFocusLessonId.current = null;
    },
  });

  const moveLesson = useCallback(
    (lessonId: string, direction: -1 | 1) => {
      if (!isEditable || reorder.isPending) return;
      const ordered = [...lessons]
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
        .map((l) => l.id);
      const idx = ordered.indexOf(lessonId);
      const target = idx + direction;
      if (idx < 0 || target < 0 || target >= ordered.length) return;
      const next = ordered.slice();
      [next[idx], next[target]] = [next[target], next[idx]];
      pendingFocusLessonId.current = lessonId;
      setReorderAnnounce(`Lesson moved to position ${target + 1} of ${ordered.length}.`);
      // No permanent optimistic reorder — the query cache is the source of
      // truth. On success we invalidate; on error we surface a stable message.
      reorder.mutate({ lessonIds: next });
    },
    [isEditable, lessons, reorder],
  );

  useEffect(() => {
    const id = pendingFocusLessonId.current;
    if (!id) return;
    if (reorder.isPending) return;
    // Prefer the Move-up button, but if it is disabled (first position) fall
    // back to the row wrapper. HTMLButtonElement.focus() is a no-op on a
    // disabled button, so we must detect and reroute focus explicitly.
    const btn = document.querySelector<HTMLButtonElement>(
      `[data-lesson-move-focus="${id}"]`,
    );
    if (btn && !btn.disabled) {
      btn.focus();
    } else {
      const row = document.querySelector<HTMLElement>(`[data-lesson-row-focus="${id}"]`);
      row?.focus();
    }
    pendingFocusLessonId.current = null;
  }, [lessons, reorder.isPending]);

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

  const disabled = !isEditable;
  const canSaveNow = isEditable && dirty && saveStatus !== "saving";
  const canSubmitNow =
    isEditable && !dirty && saveStatus !== "saving" && !submit.isPending && isReady;

  const saveStatusLabel: Record<SaveStatus, string> = {
    clean: "All changes saved",
    unsaved: "Unsaved changes",
    saving: "Saving…",
    saved: "Saved",
    failed: saveError ?? "Save failed",
  };
  const statusLabel: Record<string, string> = {
    draft: "Draft",
    pending_review: "Pending review",
    approved: "Approved",
    rejected: "Rejected",
  };

  return (
    <div className="min-h-screen bg-background" style={{ fontFamily: "Poppins, sans-serif" }}>
      <div className="mx-auto max-w-4xl p-4 md:p-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <Link
            to="/studio"
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Studio
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <span
              aria-live="polite"
              className="rounded-full bg-card px-3 py-1 text-[11px] font-semibold ring-1 ring-border"
            >
              {statusLabel[rs] ?? rs}
            </span>
            <span
              aria-live="polite"
              className={`rounded-full px-3 py-1 text-[11px] font-semibold ring-1 ${saveStatus === "failed" ? "bg-red-50 text-red-700 ring-red-200" : "bg-card ring-border"}`}
            >
              {saveStatusLabel[saveStatus]}
            </span>
            <button
              onClick={() => submit.mutate()}
              disabled={!canSubmitNow}
              title={
                canSubmitNow
                  ? "Send this course to admins for review"
                  : !isEditable
                    ? "Course is locked"
                    : dirty
                      ? "Save your changes first"
                      : !isReady
                        ? "Resolve readiness items first"
                        : "Please wait…"
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
        {submit.isError && (
          <div role="alert" className="mb-6 rounded-2xl bg-red-50 p-4 text-sm ring-1 ring-red-200">
            {mapCourseGovernanceError(submit.error)}
          </div>
        )}
        {submissionBlockers !== null && submissionBlockers.length === 0 && !submit.isError && (
          <div role="alert" className="mb-6 rounded-2xl bg-red-50 p-4 text-sm ring-1 ring-red-200">
            We couldn't confirm readiness. Try again in a moment.
          </div>
        )}
        {submit.isSuccess && submissionBlockers === null && (
          <div role="status" className="mb-6 rounded-2xl bg-card p-4 text-sm ring-1 ring-border">
            Course sent for admin review — it is pending review, not published.
          </div>
        )}

        <Section id="section-basics" title="Course basics">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Title" htmlFor="field-title" full>
              <input
                id="field-title"
                value={form.title}
                onChange={(e) => patch("title", e.target.value)}
                maxLength={COURSE_UPDATE_LIMITS.title.max}
                disabled={disabled}
                className={inputCls}
              />
            </Field>
            <Field label="Subtitle" htmlFor="field-subtitle" full>
              <input
                id="field-subtitle"
                value={form.subtitle}
                onChange={(e) => patch("subtitle", e.target.value)}
                maxLength={COURSE_UPDATE_LIMITS.subtitle.max}
                disabled={disabled}
                className={inputCls}
              />
            </Field>
            <Field label="Category" htmlFor="field-category">
              <select
                id="field-category"
                value={form.category}
                onChange={(e) => patch("category", e.target.value)}
                disabled={disabled}
                className={inputCls}
              >
                <option value="">Select…</option>
                {CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label="Level" htmlFor="field-level">
              <select
                id="field-level"
                value={form.level}
                onChange={(e) => patch("level", e.target.value)}
                disabled={disabled}
                className={inputCls}
              >
                {LEVELS.map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
            </Field>
            <Field label="Language" htmlFor="field-language">
              <select
                id="field-language"
                value={form.language}
                onChange={(e) => patch("language", e.target.value)}
                disabled={disabled}
                className={inputCls}
              >
                {LANGUAGES.map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
            </Field>
            <Field label="Duration" htmlFor="field-duration">
              <input
                id="field-duration"
                value={form.duration_label}
                onChange={(e) => patch("duration_label", e.target.value)}
                placeholder="e.g. 6h 30m"
                disabled={disabled}
                className={inputCls}
              />
            </Field>
            <Field label="Course URL identifier (slug)" htmlFor="field-slug" full>
              <input
                id="field-slug"
                value={course.slug}
                readOnly
                aria-readonly="true"
                className={`${inputCls} bg-foreground/5 text-muted-foreground`}
                title="The URL identifier for this course. Not editable."
              />
              <p className="mt-1 text-xs text-muted-foreground">
                This is your course URL identifier. It can't be changed after creation.
              </p>
            </Field>
          </div>
        </Section>

        <Section id="section-description" title="Description">
          <Field label="Course description" htmlFor="field-description" full>
            <textarea
              id="field-description"
              value={form.description}
              onChange={(e) => patch("description", e.target.value)}
              rows={5}
              maxLength={COURSE_UPDATE_LIMITS.description.max}
              disabled={disabled}
              className={`${inputCls} resize-none`}
            />
          </Field>
        </Section>

        <Section id="section-instructor" title="Instructor presentation">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Instructor name" htmlFor="field-instructor-name">
              <input
                id="field-instructor-name"
                value={form.instructor_name}
                onChange={(e) => patch("instructor_name", e.target.value)}
                maxLength={COURSE_UPDATE_LIMITS.instructor_name.max}
                disabled={disabled}
                className={inputCls}
              />
            </Field>
            <Field label="Instructor title" htmlFor="field-instructor-title">
              <input
                id="field-instructor-title"
                value={form.instructor_title}
                onChange={(e) => patch("instructor_title", e.target.value)}
                maxLength={COURSE_UPDATE_LIMITS.instructor_title.max}
                disabled={disabled}
                className={inputCls}
              />
            </Field>
            <Field label="Short bio" htmlFor="field-instructor-bio" full>
              <textarea
                id="field-instructor-bio"
                value={form.instructor_bio}
                onChange={(e) => patch("instructor_bio", e.target.value)}
                rows={4}
                maxLength={COURSE_UPDATE_LIMITS.instructor_bio.max}
                disabled={disabled}
                className={`${inputCls} resize-none`}
              />
            </Field>
          </div>
        </Section>

        <Section id="section-outcomes" title="Learning outcomes">
          <StructuredListEditor
            label="What learners will achieve"
            helper="At least three concrete outcomes."
            fieldId="field-learn-outcomes"
            values={form.learn_outcomes}
            onChange={(v) => patch("learn_outcomes", v)}
            placeholder="e.g. Build a responsive layout with CSS grid"
            disabled={disabled}
            addLabel="Add outcome"
          />
        </Section>
        <Section id="section-skills" title="Skills">
          <StructuredListEditor
            label="Skills practiced"
            fieldId="field-skills"
            values={form.skills}
            onChange={(v) => patch("skills", v)}
            placeholder="e.g. TypeScript"
            disabled={disabled}
            addLabel="Add skill"
          />
        </Section>
        <Section id="section-requirements" title="Requirements">
          <StructuredListEditor
            label="Prerequisites"
            fieldId="field-requirements"
            values={form.requirements}
            onChange={(v) => patch("requirements", v)}
            placeholder="e.g. Basic HTML knowledge"
            disabled={disabled}
            addLabel="Add requirement"
          />
        </Section>
        <Section id="section-audience" title="Intended audience">
          <StructuredListEditor
            label="Who this course is for"
            fieldId="field-audience"
            values={form.audience}
            onChange={(v) => patch("audience", v)}
            placeholder="e.g. Junior frontend developers"
            disabled={disabled}
            addLabel="Add audience"
          />
        </Section>

        <Section id="section-faq" title="Frequently asked questions">
          <FaqEditor
            values={form.faq}
            onChange={(v) => patch("faq", v)}
            disabled={disabled}
            fieldId="field-faq"
          />
        </Section>

        <Section id="section-pricing" title="Pricing & delivery">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Price (USD)" htmlFor="field-price">
              <input
                id="field-price"
                type="number"
                step="0.01"
                min="0"
                value={form.priceDollars}
                onChange={(e) => patch("priceDollars", e.target.value)}
                disabled={disabled}
                className={inputCls}
              />
            </Field>
          </div>
          <p className="mt-3 rounded-2xl bg-background p-4 text-sm text-muted-foreground">
            Course submission currently requires the price to be <strong>Free ($0.00)</strong>. Paid
            checkout is not enabled in this release; keeping a price now preserves it for future
            compatibility.
          </p>
        </Section>

        <Section id="section-cover" title="Cover artwork">
          <CoverUploader
            courseId={courseId}
            isEditable={isEditable}
            coverStoragePath={course.cover_storage_path ?? null}
            legacyCoverUrl={course.cover_url ?? null}
          />
        </Section>

        <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
          <span
            className={`text-xs font-semibold ${saveStatus === "failed" ? "text-red-700" : "text-muted-foreground"}`}
            aria-live="polite"
          >
            {saveStatusLabel[saveStatus]}
          </span>
          <button
            onClick={() => save.mutate()}
            disabled={!canSaveNow}
            title={
              !isEditable
                ? "Course is locked while under review or approved"
                : !dirty
                  ? "No changes to save"
                  : "Save course changes"
            }
            className="flex min-h-11 items-center gap-2 rounded-full bg-foreground px-6 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            <Save className="h-4 w-4" /> {saveStatus === "saving" ? "Saving…" : "Save changes"}
          </button>
        </div>

        <Section id="section-curriculum" title="Curriculum">
          <div className="sr-only" aria-live="polite">
            {reorderAnnounce}
          </div>
          {reorderError && (
            <div
              role="alert"
              className="mb-3 rounded-2xl bg-red-50 px-4 py-2 text-xs font-semibold text-red-700 ring-1 ring-red-200"
            >
              {reorderError}
            </div>
          )}
          <ul className="mt-2 space-y-2">
            {[...lessons]
              .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
              .map((l, idx, arr) => (
                <LessonRow
                  key={l.id}
                  lesson={l}
                  courseId={courseId}
                  isEditable={isEditable}
                  canMoveUp={idx > 0}
                  canMoveDown={idx < arr.length - 1}
                  isReordering={reorder.isPending}
                  onMoveUp={() => moveLesson(l.id, -1)}
                  onMoveDown={() => moveLesson(l.id, 1)}
                  onDelete={() => {
                    if (!isEditable) return;
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
              if (!isEditable) return;
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
              disabled={!isEditable}
              className={inputCls}
            />
            <button
              type="submit"
              disabled={!isEditable}
              title={isEditable ? undefined : "Course is locked while under review or approved"}
              className="flex min-h-11 items-center gap-2 rounded-full bg-black px-5 py-3 text-sm font-semibold text-background disabled:opacity-50"
            >
              <Plus className="h-4 w-4" /> Add
            </button>
          </form>
        </Section>

        <div className="mt-6">
          <ReadinessPanel
            isReady={isReady}
            blockers={displayBlockers}
            lessons={lessons.map((l) => ({ id: l.id, title: l.title }))}
            loading={readinessQ.isLoading}
            onFocus={(target) => focusTarget(target)}
          />
        </div>
      </div>
    </div>
  );
}

const inputCls =
  "min-h-11 w-full rounded-2xl bg-background px-4 py-3 text-sm outline-none ring-1 ring-transparent focus:ring-foreground disabled:opacity-70 disabled:cursor-not-allowed";

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="mt-6 rounded-3xl bg-card p-6 md:p-8"
    >
      <h2 id={`${id}-title`} className="text-xl font-bold">
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Field({
  label,
  htmlFor,
  children,
  full,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <label htmlFor={htmlFor} className={`block ${full ? "md:col-span-2" : ""}`}>
      <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function LessonRow({
  lesson,
  courseId,
  isEditable,
  canMoveUp,
  canMoveDown,
  isReordering,
  onMoveUp,
  onMoveDown,
  onDelete,
}: {
  lesson: {
    id: string;
    title: string;
    position: number;
    duration_seconds: number | null;
    content: string | null;
    video_url: string | null;
    is_preview?: boolean;
    module_title?: string | null;
  };
  courseId: string;
  isEditable: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  isReordering: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
}) {
  const qc = useQueryClient();
  const upsertLessonFn = useServerFn(upsertLesson);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(lesson.title);
  const [content, setContent] = useState(lesson.content ?? "");
  const [videoUrl, setVideoUrl] = useState(lesson.video_url ?? "");
  const [dur, setDur] = useState(lesson.duration_seconds?.toString() ?? "");
  const [isPreview, setIsPreview] = useState<boolean>(lesson.is_preview ?? false);
  const [moduleTitle, setModuleTitle] = useState<string>(lesson.module_title ?? "");

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
          is_preview: isPreview,
          module_title: moduleTitle.trim() || null,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-course", courseId] });
      qc.invalidateQueries({ queryKey: ["course-readiness", courseId] });
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
            type="button"
            onClick={onMoveUp}
            disabled={!isEditable || !canMoveUp || isReordering}
            data-lesson-move-focus={lesson.id}
            aria-label={`Move ${lesson.title} up`}
            title={
              !isEditable
                ? "Locked while under review or approved"
                : !canMoveUp
                  ? "Already at the top"
                  : "Move lesson up"
            }
            className="flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={!isEditable || !canMoveDown || isReordering}
            aria-label={`Move ${lesson.title} down`}
            title={
              !isEditable
                ? "Locked while under review or approved"
                : !canMoveDown
                  ? "Already at the bottom"
                  : "Move lesson down"
            }
            className="flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            <ArrowDown className="h-4 w-4" />
          </button>
          <button
            onClick={() => setOpen((v) => !v)}
            className="min-h-11 rounded-full bg-card px-3 py-1.5 text-xs font-semibold"
          >
            {open ? "Close" : "Edit"}
          </button>
          <button
            onClick={onDelete}
            disabled={!isEditable}
            title={isEditable ? "Delete lesson" : "Locked while under review or approved"}
            aria-label={`Delete ${lesson.title}`}
            className="flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
      {open && (
        <div className="grid gap-3 border-t border-border/60 p-4 md:grid-cols-2">
          <label className="md:col-span-2">
            <span className="mb-1 block text-xs font-semibold text-muted-foreground">Title</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={!isEditable}
              className={inputCls}
            />
          </label>
          <label>
            <span className="mb-1 block text-xs font-semibold text-muted-foreground">
              Module title
            </span>
            <input
              value={moduleTitle}
              onChange={(e) => setModuleTitle(e.target.value)}
              disabled={!isEditable}
              className={inputCls}
            />
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={isPreview}
              onChange={(e) => setIsPreview(e.target.checked)}
              disabled={!isEditable}
            />
            <span className="text-xs font-semibold text-muted-foreground">Free preview lesson</span>
          </label>
          <label>
            <span className="mb-1 block text-xs font-semibold text-muted-foreground">
              Video URL
            </span>
            <input
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              disabled={!isEditable}
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
              disabled={!isEditable}
              className={inputCls}
            />
          </label>
          <label className="md:col-span-2">
            <span className="mb-1 block text-xs font-semibold text-muted-foreground">Content</span>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={5}
              disabled={!isEditable}
              className={`${inputCls} resize-none`}
            />
          </label>
          <div className="md:col-span-2 flex justify-end">
            <button
              onClick={() => save.mutate()}
              disabled={save.isPending || !isEditable}
              title={isEditable ? undefined : "Locked while under review or approved"}
              className="flex min-h-11 items-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              <Save className="h-4 w-4" /> Save lesson
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
