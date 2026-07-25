import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  orderLessons,
  selectCurrentLesson,
  neighborIds,
  canTrackProgress,
  clampProgress,
  type Entitlement,
} from "@/lib/lesson-player-state";

function isNewKey(v: string) {
  return v.startsWith("sb_publishable_") || v.startsWith("sb_secret_");
}
function pubClient() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY!;
  return createClient<Database>(url, key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        if (isNewKey(key) && h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization");
        h.set("apikey", key);
        return fetch(input, { ...init, headers: h });
      },
    },
  });
}

export type CourseCard = {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  category: string;
  icon_kind: string | null;
  price_cents: number;
  duration_label: string | null;
  rating: number;
  likes: number;
};

export const listCourses = createServerFn({ method: "GET" }).handler(
  async (): Promise<CourseCard[]> => {
    const supabase = pubClient();
    const { data, error } = await supabase
      .from("courses")
      .select(
        "id, slug, title, subtitle, category, icon_kind, price_cents, duration_label, rating, likes",
      )
      .eq("is_published", true)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  },
);

export type CourseDetail = CourseCard & {
  description: string | null;
  cover_url: string | null;
  level: string;
  language: string;
  learn_outcomes: string[];
  skills: string[];
  requirements: string[];
  audience: string[];
  faq: { q: string; a: string }[];
  students_count: number;
  instructor_name: string | null;
  instructor_title: string | null;
  instructor_bio: string | null;
  certificate: boolean;
  lessons: {
    id: string;
    title: string;
    position: number;
    duration_seconds: number | null;
    is_preview: boolean;
    module_title: string | null;
  }[];
  related: CourseCard[];
  reviews_count: number;
  rating_breakdown: { stars: number; count: number }[];
};

export const getCourseBySlug = createServerFn({ method: "GET" })
  .inputValidator((d: { slug: string }) => d)
  .handler(async ({ data }): Promise<CourseDetail | null> => {
    const supabase = pubClient();
    const { data: course, error } = await supabase
      .from("courses")
      .select(
        "id, slug, title, subtitle, category, icon_kind, price_cents, duration_label, rating, likes, description, cover_url, level, language, learn_outcomes, skills, requirements, audience, faq, students_count, instructor_name, instructor_title, instructor_bio, certificate",
      )
      .eq("slug", data.slug)
      .eq("is_published", true)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!course) return null;
    // Use SECURITY DEFINER RPC that returns only safe curriculum metadata
    // (id, title, position, duration_seconds, is_preview, module_title) —
    // never content or video_url.
    const { data: curriculum, error: curErr } = await supabase.rpc("get_course_curriculum", {
      _slug: data.slug,
    });
    if (curErr) throw new Error(curErr.message);
    const lessons = (curriculum ?? []).map((r) => ({
      id: r.lesson_id,
      title: r.lesson_title,
      position: r.lesson_position,
      duration_seconds: r.duration_seconds,
      is_preview: r.is_preview,
      module_title: r.module_title,
    }));
    const { data: related } = await supabase
      .from("courses")
      .select(
        "id, slug, title, subtitle, category, icon_kind, price_cents, duration_label, rating, likes",
      )
      .eq("category", course.category)
      .eq("is_published", true)
      .neq("id", course.id)
      .limit(3);
    const { data: reviews } = await supabase
      .from("reviews")
      .select("rating")
      .eq("course_id", course.id);
    const counts = [5, 4, 3, 2, 1].map((stars) => ({
      stars,
      count: (reviews ?? []).filter((r) => r.rating === stars).length,
    }));
    return {
      ...course,
      faq: (course.faq as { q: string; a: string }[]) ?? [],
      lessons,
      related: related ?? [],
      reviews_count: reviews?.length ?? 0,
      rating_breakdown: counts,
    };
  });

export const enrollInCourse = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { courseId: string }) => d)
  .handler(async ({ data, context }) => {
    // All free enrollments go through the guarded RPC, which uses a
    // course-scoped advisory lock, re-checks publish/price, and inserts
    // as auth.uid(). This closes the direct-INSERT race that could beat
    // unpublish_for_edit and any client-side pre-check drift.
    const { error } = await context.supabase.rpc("enroll_free_course", {
      _course_id: data.courseId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Pure helper (exported for unit tests). Throws on any disallowed enrollment.
export function assertFreePublishedCourse(
  course: { is_published: boolean; price_cents: number } | null,
) {
  if (!course || !course.is_published) {
    throw new Error("Course is not available for enrollment.");
  }
  if ((course.price_cents ?? 0) > 0) {
    throw new Error("Checkout is not available yet for paid courses.");
  }
}

export const listMyEnrollments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("enrollments")
      .select(
        "progress, enrolled_at, course:courses(id, slug, title, subtitle, category, icon_kind, price_cents, duration_label, rating, likes, is_published)",
      )
      .eq("user_id", userId)
      .order("enrolled_at", { ascending: false });
    if (error) throw new Error(error.message);
    // Historical paid enrollments (pre-payments) grant no learner access;
    // hide them from active-entitlement lists. They remain in the DB for audit.
    return (data ?? []).filter((row) => {
      const c = row.course as { price_cents?: number; is_published?: boolean } | null;
      return !!c && c.is_published === true && (c.price_cents ?? 0) === 0;
    });
  });

export type PlayerCourseDTO = {
  id: string;
  slug: string;
  title: string;
  category: string;
};

export type PlayerLessonDTO = {
  id: string;
  title: string;
  position: number;
  duration_seconds: number | null;
  is_preview: boolean;
  content: string | null;
  video_url: string | null;
};

export type PlayerBase = {
  course: PlayerCourseDTO;
  entitlement: Entitlement;
  isEnrolled: boolean;
  canTrackProgress: boolean;
  progress: number | null;
  courseComplete: boolean;
  canSelfEnroll: boolean;
  completedLessonIds: string[];
};

export type LessonPlayerResult =
  | { state: "course_not_found_or_hidden" }
  | (PlayerBase & { state: "empty_curriculum" })
  | (PlayerBase & { state: "no_preview_available" })
  | (PlayerBase & { state: "requested_lesson_unavailable" })
  | (PlayerBase & { state: "protected_lesson_requested" })
  | (PlayerBase & {
      state: "ready";
      lessons: PlayerLessonDTO[];
      current: PlayerLessonDTO;
      prevId: string | null;
      nextId: string | null;
    });

// Retained temporary alias for any external import; the new discriminated
// result is the canonical shape.
export type LessonPlayer = LessonPlayerResult;

export const getLessonPlayer = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { slug: string; lessonId?: string }) => d)
  .handler(async ({ data, context }): Promise<LessonPlayerResult> => {
    const { supabase, userId } = context;

    // 1) Resolve course. Unpublished courses are indistinguishable from
    //    missing courses to non-owner/non-admin viewers.
    const { data: course, error: cErr } = await supabase
      .from("courses")
      .select("id, slug, title, category, is_published, instructor_id, price_cents")
      .eq("slug", data.slug)
      .maybeSingle();
    if (cErr) throw new Error(cErr.message);
    if (!course) return { state: "course_not_found_or_hidden" };

    // Fail-closed role checks. instructor_id match alone MUST NOT grant
    // full access after the instructor role has been revoked; require the
    // active instructor role (unless admin).
    const [{ data: isAdminData, error: roleErrA }, { data: isInstructorData, error: roleErrI }] =
      await Promise.all([
        supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
        supabase.rpc("has_role", { _user_id: userId, _role: "instructor" }),
      ]);
    if (roleErrA) throw new Error(`Authorization check failed: ${roleErrA.message}`);
    if (roleErrI) throw new Error(`Authorization check failed: ${roleErrI.message}`);
    const isAdmin = !!isAdminData;
    const isActiveInstructor = !!isInstructorData;
    const isOwner = course.instructor_id === userId && isActiveInstructor;

    if (!course.is_published && !isOwner && !isAdmin) {
      return { state: "course_not_found_or_hidden" };
    }

    const { data: enr, error: enrErr } = await supabase
      .from("enrollments")
      .select("id, last_lesson_id, progress")
      .eq("user_id", userId)
      .eq("course_id", course.id)
      .maybeSingle();
    if (enrErr) throw new Error(enrErr.message);
    const isEnrolled = !!enr;

    const entitlement = resolveLessonEntitlement({
      course: { is_published: course.is_published, price_cents: course.price_cents },
      isOwner,
      isAdmin,
      enrolled: isEnrolled,
    });
    const trackable = canTrackProgress({
      entitlement,
      isEnrolled,
      priceCents: course.price_cents,
      isPublished: course.is_published,
    });

    // Self-enroll CTA: only true for the narrow published/free/unenrolled/
    // non-owner/non-admin case. Not derived from `!isEnrolled` alone.
    const canSelfEnroll =
      course.is_published === true &&
      (course.price_cents ?? 0) === 0 &&
      !isEnrolled &&
      !isOwner &&
      !isAdmin;

    const courseDTO: PlayerCourseDTO = {
      id: course.id,
      slug: course.slug,
      title: course.title,
      category: course.category,
    };

    // Completions are only surfaced for a viewer with active trackable
    // progress. Owner/admin inspection and historical paid enrollments
    // never expose lesson completions or progress.
    let completedLessonIds: string[] = [];
    let progress: number | null = null;
    if (trackable) {
      const { data: comps, error: compErr } = await supabase
        .from("lesson_completions")
        .select("lesson_id")
        .eq("user_id", userId)
        .eq("course_id", course.id);
      if (compErr) throw new Error(compErr.message);
      completedLessonIds = (comps ?? []).map((c) => c.lesson_id);
      // Authoritative progress is enrollments.progress (maintained by the
      // complete_lesson RPC). Clamp to [0,100] defensively; do NOT
      // recompute from completedLessonIds.length.
      progress = clampProgress((enr as { progress?: number | null } | null)?.progress ?? 0);
    }

    const buildBase = (): PlayerBase => ({
      course: courseDTO,
      entitlement,
      isEnrolled,
      canTrackProgress: trackable,
      progress,
      courseComplete: trackable && progress === 100,
      canSelfEnroll,
      completedLessonIds,
    });

    // 2) Curriculum metadata via safe RPC — never leaks content/video_url.
    //    Empty rows here means either the RPC filters unpublished for
    //    non-elevated viewers, or the course truly has no lessons.
    const { data: curriculumRows, error: curErr } = await supabase.rpc("get_course_curriculum", {
      _slug: data.slug,
    });
    if (curErr) throw new Error(curErr.message);

    let curriculum = (curriculumRows ?? []).map((r) => ({
      id: r.lesson_id,
      position: r.lesson_position,
      is_preview: r.is_preview,
    }));
    curriculum = orderLessons(curriculum);

    // For owner/admin viewing an unpublished draft, the curriculum RPC
    // filters by is_published; fall back to a direct authorized read of
    // safe metadata columns (RLS admits owners via the "Active instructors
    // manage own lessons" and admin policies).
    if (curriculum.length === 0 && (isOwner || isAdmin)) {
      const { data: rows, error: fallErr } = await supabase
        .from("lessons")
        .select("id, position, is_preview")
        .eq("course_id", course.id);
      if (fallErr) throw new Error(fallErr.message);
      curriculum = orderLessons(
        (rows ?? []).map((r) => ({ id: r.id, position: r.position, is_preview: r.is_preview })),
      );
    }

    if (curriculum.length === 0) {
      return { ...buildBase(), state: "empty_curriculum" };
    }

    const fullAccess = entitlement === "full";

    // 3) Fetch content by entitlement. Never fetch protected content for a
    //    preview viewer, then filter after.
    let lessons: PlayerLessonDTO[] = [];
    if (fullAccess) {
      const { data: rows, error: lErr } = await supabase
        .from("lessons")
        .select("id, title, position, duration_seconds, is_preview, content, video_url")
        .eq("course_id", course.id);
      if (lErr) throw new Error(lErr.message);
      lessons = orderLessons(rows ?? []) as PlayerLessonDTO[];
    } else if (entitlement === "preview") {
      const { data: rows, error: lErr } = await supabase
        .from("lessons")
        .select("id, title, position, duration_seconds, is_preview, content, video_url")
        .eq("course_id", course.id)
        .eq("is_preview", true);
      if (lErr) throw new Error(lErr.message);
      lessons = orderLessons(rows ?? []) as PlayerLessonDTO[];
      if (lessons.length === 0) {
        return { ...buildBase(), state: "no_preview_available" };
      }
    } else {
      // entitlement === 'none' means unpublished-and-stranger, which was
      // already handled as course_not_found_or_hidden above. Belt-and-braces:
      return { state: "course_not_found_or_hidden" };
    }

    // Requested-lesson classification uses the safe curriculum metadata to
    // distinguish "unknown/cross-course id" from "known but protected".
    if (data.lessonId) {
      const inAuthorized = lessons.some((l) => l.id === data.lessonId);
      if (!inAuthorized) {
        const inCurriculum = curriculum.some((l) => l.id === data.lessonId);
        if (!inCurriculum) {
          return { ...buildBase(), state: "requested_lesson_unavailable" };
        }
        // Known lesson id, but not authorized for this viewer.
        return { ...buildBase(), state: "protected_lesson_requested" };
      }
    }

    // Selection uses canonically ordered authorized lessons.
    const lastLessonId: string | null = enr
      ? ((enr as { last_lesson_id?: string | null }).last_lesson_id ?? null)
      : null;
    const selection = selectCurrentLesson({
      lessons,
      requestedLessonId: data.lessonId,
      lastLessonId,
      completedIds: completedLessonIds,
    });
    if (selection.kind !== "selected") {
      // "empty" is impossible here (guarded above); "requested-invalid" is
      // impossible because we handled it via the curriculum classifier.
      return { ...buildBase(), state: "requested_lesson_unavailable" };
    }

    const current = selection.lesson;
    const { prevId, nextId } = neighborIds(lessons, current.id);

    return {
      ...buildBase(),
      state: "ready",
      lessons,
      current,
      prevId,
      nextId,
    };
  });

// Pure entitlement resolver (exported for unit tests).
// "full"  = complete content access (owner, admin, or free-enrolled)
// "preview" = preview-only lessons
// "none"  = no access at all (unpublished draft to a stranger)
export type LessonEntitlement = "full" | "preview" | "none";
export function resolveLessonEntitlement(input: {
  course: { is_published: boolean; price_cents: number };
  isOwner: boolean;
  isAdmin: boolean;
  enrolled: boolean;
}): LessonEntitlement {
  const { course, isOwner, isAdmin, enrolled } = input;
  if (isOwner || isAdmin) return "full";
  if (!course.is_published) return "none";
  // Paid enrollments grant NO learner access until verified payments exist.
  if (enrolled && (course.price_cents ?? 0) === 0) return "full";
  return "preview";
}

export const markLessonComplete = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { lessonId: string; courseId: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    // Delegate to the SECURITY DEFINER RPC that atomically:
    //   - verifies auth.uid()
    //   - verifies course is published
    //   - verifies lesson.course_id = _course_id (rejects cross-course pairs)
    //   - verifies a real enrollment exists for the authenticated user
    //   - inserts completion and recomputes progress
    // Any failure raises and the client sees no mutation.
    const { data: progress, error } = await supabase.rpc("complete_lesson", {
      _course_id: data.courseId,
      _lesson_id: data.lessonId,
    });
    if (error) throw new Error(error.message);
    return { progress: (progress as number) ?? 0 };
  });

export const setLastLesson = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { courseId: string; lessonId: string }) => d)
  .handler(async ({ data, context }) => {
    // set_last_lesson RPC atomically requires:
    //   auth.uid, published free course, active enrollment, lesson in course.
    // Any other combination raises SQLSTATE 42501; progress is never touched.
    const { error } = await context.supabase.rpc("set_last_lesson", {
      _course_id: data.courseId,
      _lesson_id: data.lessonId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============ Instructor Studio ============

function slugify(s: string) {
  return (
    s
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 60) || `course-${Date.now()}`
  );
}

export const getMyRoles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => r.role as string);
  });

// Fail-closed role assertion for Studio server fns.
// Throws if the RPC errors or the caller lacks the role.
// Exported for unit tests.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function assertActiveInstructor(supabase: any): Promise<void> {
  const { data, error } = await supabase.rpc("current_user_has_role", { _role: "instructor" });
  if (error) throw new Error(`Authorization check failed: ${error.message}`);
  if (data === true) return;
  const { data: adm, error: aErr } = await supabase.rpc("current_user_has_role", {
    _role: "admin",
  });
  if (aErr) throw new Error(`Authorization check failed: ${aErr.message}`);
  if (adm !== true) throw new Error("Instructor role required");
}

export type MyApplication = {
  id: string;
  status: "pending" | "approved" | "rejected" | "withdrawn";
  application_reason: string | null;
  decision_reason: string | null;
  created_at: string;
  updated_at: string;
};

export const getMyInstructorApplication = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MyApplication | null> => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("instructor_applications")
      .select("id, status, application_reason, decision_reason, created_at, updated_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as MyApplication | null) ?? null;
  });

export const applyForInstructor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { reason?: string | null } | undefined) => d ?? {})
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase.rpc("apply_for_instructor", {
      _reason: data?.reason ?? undefined,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const withdrawInstructorApplication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { applicationId: string }) => d)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("withdraw_instructor_application", {
      _application_id: data.applicationId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const approveInstructorApplication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { applicationId: string; reason?: string | null }) => d)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("approve_instructor_application", {
      _application_id: data.applicationId,
      _reason: data.reason ?? undefined,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const rejectInstructorApplication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { applicationId: string; reason: string }) => {
    if (!d.reason?.trim()) throw new Error("Reason required");
    return { applicationId: d.applicationId, reason: d.reason.trim() };
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("reject_instructor_application", {
      _application_id: data.applicationId,
      _reason: data.reason,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const revokeInstructorRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string; reason: string }) => {
    if (!d.reason?.trim()) throw new Error("Reason required");
    return { userId: d.userId, reason: d.reason.trim() };
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("revoke_instructor_role", {
      _user_id: data.userId,
      _reason: data.reason,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export type MyCourse = {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  category: string;
  price_cents: number;
  is_published: boolean;
  updated_at: string;
};

export const listMyCourses = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MyCourse[]> => {
    const { supabase, userId } = context;
    await assertActiveInstructor(supabase);
    const { data, error } = await supabase
      .from("courses")
      .select(
        "id, slug, title, subtitle, category, price_cents, is_published, updated_at, review_status",
      )
      .eq("instructor_id", userId)
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as MyCourse[];
  });

export const createCourse = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { title: string; category: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertActiveInstructor(supabase);
    const base = slugify(data.title);
    const slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
    const { data: row, error } = await supabase
      .from("courses")
      .insert({
        title: data.title,
        category: data.category,
        slug,
        instructor_id: userId,
        price_cents: 0,
      })
      .select("id, slug")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const getMyCourse = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { courseId: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertActiveInstructor(supabase);
    const { data: course, error } = await supabase
      .from("courses")
      .select("*")
      .eq("id", data.courseId)
      .eq("instructor_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!course) return null;
    const { data: lessons } = await supabase
      .from("lessons")
      .select("id, title, position, duration_seconds, content, video_url")
      .eq("course_id", course.id)
      .order("position", { ascending: true });
    return { course, lessons: lessons ?? [] };
  });

export const updateCourse = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      courseId: string;
      title?: string;
      subtitle?: string | null;
      description?: string | null;
      category?: string;
      price_cents?: number;
      duration_label?: string | null;
      icon_kind?: string | null;
    }) => d,
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertActiveInstructor(supabase);
    const { courseId, ...rest } = data;
    // is_published is column-level revoked; never accept it here even if a
    // caller supplies it. Instructors publish only via submit_course_for_review
    // → admin approve_course.
    const { error } = await supabase
      .from("courses")
      .update(rest)
      .eq("id", courseId)
      .eq("instructor_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteCourse = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { courseId: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertActiveInstructor(supabase);
    const { error } = await supabase
      .from("courses")
      .delete()
      .eq("id", data.courseId)
      .eq("instructor_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const upsertLesson = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      lessonId?: string;
      courseId: string;
      title: string;
      position: number;
      duration_seconds?: number | null;
      content?: string | null;
      video_url?: string | null;
    }) => d,
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertActiveInstructor(supabase);
    // Verify course ownership
    const { data: owned } = await supabase
      .from("courses")
      .select("id")
      .eq("id", data.courseId)
      .eq("instructor_id", userId)
      .maybeSingle();
    if (!owned) throw new Error("Not authorized");
    if (data.lessonId) {
      const { error } = await supabase
        .from("lessons")
        .update({
          title: data.title,
          position: data.position,
          duration_seconds: data.duration_seconds ?? null,
          content: data.content ?? null,
          video_url: data.video_url ?? null,
        })
        .eq("id", data.lessonId)
        .eq("course_id", data.courseId);
      if (error) throw new Error(error.message);
      return { id: data.lessonId };
    }
    const { data: row, error } = await supabase
      .from("lessons")
      .insert({
        course_id: data.courseId,
        title: data.title,
        position: data.position,
        duration_seconds: data.duration_seconds ?? null,
        content: data.content ?? null,
        video_url: data.video_url ?? null,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteLesson = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { lessonId: string; courseId: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertActiveInstructor(supabase);
    const { data: owned } = await supabase
      .from("courses")
      .select("id")
      .eq("id", data.courseId)
      .eq("instructor_id", userId)
      .maybeSingle();
    if (!owned) throw new Error("Not authorized");
    // Add course_id to DELETE predicate — defense-in-depth against a guessed
    // lessonId from another course.
    const { error } = await supabase
      .from("lessons")
      .delete()
      .eq("id", data.lessonId)
      .eq("course_id", data.courseId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const submitCourseForReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { courseId: string }) => d)
  .handler(async ({ data, context }) => {
    await assertActiveInstructor(context.supabase);
    const { error } = await context.supabase.rpc("submit_course_for_review", {
      _course_id: data.courseId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const approveCourse = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { courseId: string; reason?: string | null }) => d)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("approve_course", {
      _course_id: data.courseId,
      _reason: data.reason ?? undefined,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const rejectCourse = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { courseId: string; reason: string }) => {
    if (!d.reason?.trim()) throw new Error("Reason required");
    return { courseId: d.courseId, reason: d.reason.trim() };
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("reject_course", {
      _course_id: data.courseId,
      _reason: data.reason,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============ Reviews ============

export type ReviewItem = {
  id: string;
  user_id: string;
  rating: number;
  body: string | null;
  created_at: string;
  author: { display_name: string | null; avatar_url: string | null } | null;
};

export const listCourseReviews = createServerFn({ method: "GET" })
  .inputValidator((d: { courseId: string }) => d)
  .handler(async ({ data }): Promise<ReviewItem[]> => {
    const supabase = pubClient();
    // Public read policy already restricts to eligible authors, but we also
    // filter server-side to guarantee ineligible historical rows are hidden
    // from every consumer of this endpoint (defense-in-depth).
    const { data: course } = await supabase
      .from("courses")
      .select("is_published, price_cents")
      .eq("id", data.courseId)
      .maybeSingle();
    if (!course || !course.is_published || (course.price_cents ?? 0) !== 0) {
      return [];
    }
    const { data: rows, error } = await supabase
      .from("reviews")
      .select("id, user_id, rating, body, created_at")
      .eq("course_id", data.courseId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const list = rows ?? [];
    if (list.length === 0) return [];
    // Only surface reviews whose author has a matching free-published
    // enrollment. Historical paid enrollments confer no review rights.
    const authorIds = Array.from(new Set(list.map((r) => r.user_id)));
    const { data: enrolls } = await supabase
      .from("enrollments")
      .select("user_id")
      .eq("course_id", data.courseId)
      .in("user_id", authorIds);
    const eligible = new Set((enrolls ?? []).map((e) => e.user_id));
    const gated = list.filter((r) => eligible.has(r.user_id));
    if (gated.length === 0) return [];
    const userIds = Array.from(new Set(gated.map((r) => r.user_id)));
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, display_name, avatar_url")
      .in("id", userIds);
    const byId = new Map((profs ?? []).map((p) => [p.id, p]));
    return gated.map((r) => ({
      ...r,
      author: byId.get(r.user_id)
        ? {
            display_name: byId.get(r.user_id)!.display_name,
            avatar_url: byId.get(r.user_id)!.avatar_url,
          }
        : null,
    })) as ReviewItem[];
  });

async function recomputeCourseRating(courseId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // Only aggregate ratings from eligible reviewers (free published enrollment).
  const { data: rows } = await supabaseAdmin
    .from("reviews")
    .select("rating, user_id")
    .eq("course_id", courseId);
  const { data: enrolls } = await supabaseAdmin
    .from("enrollments")
    .select("user_id")
    .eq("course_id", courseId);
  const eligible = new Set((enrolls ?? []).map((e) => e.user_id));
  const list = (rows ?? []).filter((r) => eligible.has(r.user_id as string));
  const avg = list.length
    ? Math.round((list.reduce((s, r) => s + (r.rating as number), 0) / list.length) * 10) / 10
    : 0;
  await supabaseAdmin.from("courses").update({ rating: avg }).eq("id", courseId);
  return avg;
}

export const submitReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { courseId: string; rating: number; body?: string | null }) => {
    const rating = Math.round(Number(d.rating));
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      throw new Error("Rating must be between 1 and 5");
    }
    const body = (d.body ?? "").trim().slice(0, 2000) || null;
    if (!d.courseId) throw new Error("Missing courseId");
    return { courseId: d.courseId, rating, body };
  })
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    // Atomic verified upsert. If it fails, the previous review is preserved
    // (no delete-first-then-insert).
    const { error } = await supabase.rpc("submit_review_verified", {
      _course_id: data.courseId,
      _rating: data.rating,
      _body: data.body ?? "",
    });
    if (error) throw new Error(error.message);
    const rating = await recomputeCourseRating(data.courseId);
    return { ok: true, rating };
  });

export const deleteMyReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { courseId: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("reviews")
      .delete()
      .eq("user_id", userId)
      .eq("course_id", data.courseId);
    if (error) throw new Error(error.message);
    await recomputeCourseRating(data.courseId);
    return { ok: true };
  });

// ============ Admin surface ============

export type AdminCourseRow = {
  id: string;
  slug: string;
  title: string;
  category: string;
  instructor_id: string | null;
  instructor_name: string | null;
  is_published: boolean;
  review_status: "draft" | "pending_review" | "approved" | "rejected";
  enrollments_count: number;
  completions_count: number;
  reviews_count: number;
  updated_at: string;
};

async function assertAdmin(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
): Promise<void> {
  const { data, error } = await supabase.rpc("current_user_has_role", { _role: "admin" });
  if (error) throw new Error(`Authorization check failed: ${error.message}`);
  if (data !== true) throw new Error("Admin only");
}

export const listAdminCourses = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminCourseRow[]> => {
    await assertAdmin(context.supabase);
    const { data, error } = await context.supabase.rpc("list_admin_courses");
    if (error) throw new Error(error.message);
    return (data ?? []) as AdminCourseRow[];
  });

export type AdminCourseDetail = AdminCourseRow & {
  subtitle: string | null;
  description: string | null;
  review_decision_reason: string | null;
  price_cents: number;
  can_unpublish: boolean;
};

export const getAdminCourse = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { courseId: string }) => d)
  .handler(async ({ data, context }): Promise<AdminCourseDetail | null> => {
    await assertAdmin(context.supabase);
    const { data: rows, error } = await context.supabase.rpc("get_admin_course", {
      _course_id: data.courseId,
    });
    if (error) throw new Error(error.message);
    const row = Array.isArray(rows) ? rows[0] : rows;
    return (row as AdminCourseDetail | undefined) ?? null;
  });

export const unpublishForEdit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { courseId: string; reason: string }) => {
    const reason = (d.reason ?? "").trim();
    if (!reason) throw new Error("Reason required");
    if (reason.length > 1000) throw new Error("Reason too long");
    if (!d.courseId) throw new Error("Missing courseId");
    return { courseId: d.courseId, reason };
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("unpublish_for_edit", {
      _course_id: data.courseId,
      _reason: data.reason,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
