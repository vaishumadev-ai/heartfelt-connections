import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  orderLessons,
  selectCurrentLesson,
  neighborIds,
  canTrackProgress,
  clampProgress,
  type Entitlement,
} from "@/lib/lesson-player-state";
import { normalizeReadinessBlockers, type CourseReadinessBlocker } from "@/lib/course-readiness";

// ============ Course update whitelist (P0C.2a) ============
//
// These constants are the authoritative commercial limits for the
// instructor-controlled fields on the `courses` table. Keep them exported
// so the UI can enforce identical bounds without drifting from the server.
export const COURSE_UPDATE_LIMITS = {
  title: { max: 120 },
  subtitle: { max: 200 },
  description: { max: 4000 },
  category: { max: 60 },
  duration_label: { max: 40 },
  level: { max: 40 },
  language: { max: 40 },
  instructor_name: { max: 120 },
  instructor_title: { max: 160 },
  instructor_bio: { max: 2000 },
  price_cents: { max: 100_000_00 },
  arrayItem: { max: 200 },
  arrayCount: { max: 25 },
  faq: {
    count: 25,
    question: 240,
    answer: 1200,
  },
} as const;

/**
 * The exact set of columns instructors may mutate via updateCourse.
 * Any key outside this list is silently dropped (or rejected below).
 */
export const COURSE_UPDATE_ALLOWED_FIELDS = [
  "title",
  "subtitle",
  "description",
  "category",
  "price_cents",
  "duration_label",
  "level",
  "language",
  "learn_outcomes",
  "skills",
  "requirements",
  "audience",
  "faq",
  "instructor_name",
  "instructor_title",
  "instructor_bio",
] as const;
export type CourseUpdateField = (typeof COURSE_UPDATE_ALLOWED_FIELDS)[number];

export const COURSE_UPDATE_FORBIDDEN_FIELDS = [
  "id",
  "slug",
  "instructor_id",
  "cover_url",
  "cover_storage_path",
  "icon_kind",
  "certificate",
  "is_published",
  "review_status",
  "review_decision_reason",
  "review_decided_by",
  "review_decided_at",
  "submitted_at",
  "rating",
  "likes",
  "students_count",
  "created_at",
  "updated_at",
] as const;

function trimStr(v: unknown, max: number, field: string): string {
  if (typeof v !== "string") throw new Error(`invalid_${field}`);
  const s = v.trim();
  if (s.length > max) throw new Error(`too_long_${field}`);
  return s;
}

function trimStrOrNull(v: unknown, max: number, field: string): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") throw new Error(`invalid_${field}`);
  const s = v.trim();
  if (s === "") return null;
  if (s.length > max) throw new Error(`too_long_${field}`);
  return s;
}

function normalizeStringArray(v: unknown, field: string): string[] {
  if (!Array.isArray(v)) throw new Error(`invalid_${field}`);
  if (v.length > COURSE_UPDATE_LIMITS.arrayCount.max) throw new Error(`too_many_${field}`);
  const out: string[] = [];
  for (const raw of v) {
    if (typeof raw !== "string") throw new Error(`invalid_${field}_item`);
    const s = raw.trim();
    if (s === "") continue;
    if (s.length > COURSE_UPDATE_LIMITS.arrayItem.max) throw new Error(`too_long_${field}_item`);
    out.push(s);
  }
  return out;
}

function normalizeFaq(v: unknown): { q: string; a: string }[] {
  if (v === null || v === undefined) return [];
  if (!Array.isArray(v)) throw new Error("invalid_faq");
  if (v.length > COURSE_UPDATE_LIMITS.faq.count) throw new Error("too_many_faq");
  const out: { q: string; a: string }[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== "object") throw new Error("invalid_faq_item");
    const r = raw as { q?: unknown; a?: unknown };
    if (typeof r.q !== "string" || typeof r.a !== "string") throw new Error("invalid_faq_item");
    const q = r.q.trim();
    const a = r.a.trim();
    if (q === "" && a === "") continue;
    if (q === "" || a === "") throw new Error("invalid_faq_item");
    if (q.length > COURSE_UPDATE_LIMITS.faq.question) throw new Error("too_long_faq_q");
    if (a.length > COURSE_UPDATE_LIMITS.faq.answer) throw new Error("too_long_faq_a");
    out.push({ q, a });
  }
  return out;
}

/**
 * Pure input normaliser for updateCourse. Exported for unit tests. Rejects
 * unknown keys, malformed types, and out-of-bounds values. Returns the
 * exact `Partial<CourseRow>` that will be sent to the database.
 */
export function normalizeUpdateCoursePayload(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") throw new Error("invalid_payload");
  const src = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const L = COURSE_UPDATE_LIMITS;
  for (const key of Object.keys(src)) {
    if (key === "courseId") continue;
    if ((COURSE_UPDATE_FORBIDDEN_FIELDS as readonly string[]).includes(key)) {
      throw new Error(`forbidden_field_${key}`);
    }
    if (!(COURSE_UPDATE_ALLOWED_FIELDS as readonly string[]).includes(key)) {
      throw new Error(`unknown_field_${key}`);
    }
  }
  if ("title" in src) out.title = trimStr(src.title, L.title.max, "title");
  if ("subtitle" in src) out.subtitle = trimStrOrNull(src.subtitle, L.subtitle.max, "subtitle");
  if ("description" in src)
    out.description = trimStrOrNull(src.description, L.description.max, "description");
  if ("category" in src) out.category = trimStr(src.category, L.category.max, "category");
  if ("duration_label" in src)
    out.duration_label = trimStrOrNull(src.duration_label, L.duration_label.max, "duration_label");
  if ("level" in src) out.level = trimStr(src.level, L.level.max, "level");
  if ("language" in src) out.language = trimStr(src.language, L.language.max, "language");
  if ("instructor_name" in src)
    out.instructor_name = trimStrOrNull(
      src.instructor_name,
      L.instructor_name.max,
      "instructor_name",
    );
  if ("instructor_title" in src)
    out.instructor_title = trimStrOrNull(
      src.instructor_title,
      L.instructor_title.max,
      "instructor_title",
    );
  if ("instructor_bio" in src)
    out.instructor_bio = trimStrOrNull(src.instructor_bio, L.instructor_bio.max, "instructor_bio");
  if ("price_cents" in src) {
    const raw = src.price_cents;
    const n = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > L.price_cents.max) {
      throw new Error("invalid_price_cents");
    }
    out.price_cents = n;
  }
  for (const k of ["learn_outcomes", "skills", "requirements", "audience"] as const) {
    if (k in src) out[k] = normalizeStringArray(src[k], k);
  }
  if ("faq" in src) out.faq = normalizeFaq(src.faq);
  return out;
}

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
  /**
   * Boolean-only signal indicating the lesson has a private video attached.
   * The DTO NEVER exposes `video_storage_path`, `video_url`, or any signed
   * or permanent Storage URL. Signed playback URLs are minted on demand via
   * `getLessonVideoUrl` and live only in short-lived component state.
   */
  has_video: boolean;
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

/**
 * Map a raw lesson row (containing the server-only `video_storage_path`) to
 * the player-safe DTO. `has_video` is the ONLY signal about video presence
 * that leaves the server; the storage path itself never crosses the RPC
 * boundary.
 */
function mapPlayerLessonRow(row: {
  id: string;
  title: string;
  position: number;
  duration_seconds: number | null;
  is_preview: boolean;
  content: string | null;
  video_storage_path?: string | null;
}): PlayerLessonDTO {
  return {
    id: row.id,
    title: row.title,
    position: row.position,
    duration_seconds: row.duration_seconds,
    is_preview: row.is_preview,
    content: row.content,
    has_video: typeof row.video_storage_path === "string" && row.video_storage_path.length > 0,
  };
}

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
        .select("id, title, position, duration_seconds, is_preview, content, video_storage_path")
        .eq("course_id", course.id);
      if (lErr) throw new Error(lErr.message);
      lessons = orderLessons(rows ?? []).map(mapPlayerLessonRow);
    } else if (entitlement === "preview") {
      const { data: rows, error: lErr } = await supabase
        .from("lessons")
        .select("id, title, position, duration_seconds, is_preview, content, video_storage_path")
        .eq("course_id", course.id)
        .eq("is_preview", true);
      if (lErr) throw new Error(lErr.message);
      lessons = orderLessons(rows ?? []).map(mapPlayerLessonRow);
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

// ============ Secure lesson video URL (P0C.3 Checkpoint 3) ============
//
// Mint a short-lived signed URL for the caller-authenticated lesson video.
// The function reuses the exact entitlement matrix used by `getLessonPlayer`
// so playback authorization can never drift from list authorization.
//
// Never returns `video_storage_path`, `video_url`, or a permanent URL. On any
// failure (missing course, missing lesson, wrong course, entitlement=none,
// preview-viewer requesting a non-preview lesson, revoked instructor, role
// lookup failure, enrollment lookup failure, storage sign failure) the caller
// receives a stable, leak-free error message and NO URL.
export const LESSON_VIDEO_URL_TTL_SECONDS = 300;
const LESSON_VIDEO_UNAVAILABLE = "Lesson video unavailable";

export const getLessonVideoUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => {
    const schema = z.object({
      slug: z
        .string()
        .trim()
        .min(1)
        .max(200)
        .regex(/^[a-zA-Z0-9-]+$/),
      lessonId: z.string().uuid(),
    });
    return schema.parse(d);
  })
  .handler(
    async ({
      data,
      context,
    }): Promise<{ signedUrl: string; expiresAt: number }> => {
      const { supabase, userId } = context;

      // 1) Resolve course. Any failure is indistinguishable from "not found".
      const { data: course, error: cErr } = await supabase
        .from("courses")
        .select("id, is_published, instructor_id, price_cents")
        .eq("slug", data.slug)
        .maybeSingle();
      if (cErr || !course) throw new Error(LESSON_VIDEO_UNAVAILABLE);

      // 2) Fail-closed role checks. instructor_id match alone is not enough
      //    — the instructor role must still be active.
      const [
        { data: isAdminData, error: roleErrA },
        { data: isInstructorData, error: roleErrI },
      ] = await Promise.all([
        supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
        supabase.rpc("has_role", { _user_id: userId, _role: "instructor" }),
      ]);
      if (roleErrA || roleErrI) throw new Error(LESSON_VIDEO_UNAVAILABLE);
      const isAdmin = !!isAdminData;
      const isActiveInstructor = !!isInstructorData;
      const isOwner = course.instructor_id === userId && isActiveInstructor;

      // 3) Enrollment lookup (any DB failure fails closed).
      const { data: enr, error: enrErr } = await supabase
        .from("enrollments")
        .select("id")
        .eq("user_id", userId)
        .eq("course_id", course.id)
        .maybeSingle();
      if (enrErr) throw new Error(LESSON_VIDEO_UNAVAILABLE);
      const isEnrolled = !!enr;

      const entitlement = resolveLessonEntitlement({
        course: {
          is_published: course.is_published,
          price_cents: course.price_cents,
        },
        isOwner,
        isAdmin,
        enrolled: isEnrolled,
      });
      if (entitlement === "none") throw new Error(LESSON_VIDEO_UNAVAILABLE);

      // 4) Lesson must belong to this course.
      const { data: lesson, error: lErr } = await supabase
        .from("lessons")
        .select("id, course_id, is_preview, video_storage_path")
        .eq("id", data.lessonId)
        .eq("course_id", course.id)
        .maybeSingle();
      if (lErr || !lesson) throw new Error(LESSON_VIDEO_UNAVAILABLE);

      // Preview viewers only receive playback for preview lessons.
      if (entitlement === "preview" && !lesson.is_preview) {
        throw new Error(LESSON_VIDEO_UNAVAILABLE);
      }

      if (
        !lesson.video_storage_path ||
        typeof lesson.video_storage_path !== "string" ||
        lesson.video_storage_path.length === 0
      ) {
        throw new Error(LESSON_VIDEO_UNAVAILABLE);
      }

      const { data: signed, error: signErr } = await supabase.storage
        .from("course-videos")
        .createSignedUrl(lesson.video_storage_path, LESSON_VIDEO_URL_TTL_SECONDS);
      if (signErr || !signed?.signedUrl) {
        throw new Error(LESSON_VIDEO_UNAVAILABLE);
      }

      return {
        signedUrl: signed.signedUrl,
        expiresAt: Date.now() + LESSON_VIDEO_URL_TTL_SECONDS * 1000,
      };
    },
  );

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
// Admins do NOT satisfy this gate — Studio server fns are ownership-
// scoped and are for active instructors only. Admin governance work
// runs through admin-scoped RPCs.
// Exported for unit tests.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function assertActiveInstructor(supabase: any): Promise<void> {
  const { data, error } = await supabase.rpc("current_user_has_role", { _role: "instructor" });
  if (error) throw new Error(`Authorization check failed: ${error.message}`);
  if (data !== true) throw new Error("Instructor role required");
}

// Fail-closed editability pre-check. Returns true only when the DB helper
// returns exactly true. Any RPC failure or non-true value denies editing.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function assertCourseEditable(supabase: any, courseId: string): Promise<void> {
  const { data, error } = await supabase.rpc("course_is_editable", { _course_id: courseId });
  if (error) throw new Error(`Editability check failed: ${error.message}`);
  if (data !== true) throw new Error("Course locked: not in an editable state");
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

export type AdminInstructorApplication = {
  application_id: string;
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  status: "pending" | "approved" | "rejected" | "withdrawn";
  application_reason: string | null;
  decision_reason: string | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
  is_current_instructor: boolean;
};

export type AdminInstructorApplicationsPage = {
  rows: AdminInstructorApplication[];
  total: number;
};

const ADMIN_APP_STATUSES = ["pending", "approved", "rejected", "withdrawn"] as const;
export type AdminApplicationStatus = (typeof ADMIN_APP_STATUSES)[number];

export const listInstructorApplicationsAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (
      d: { status?: AdminApplicationStatus | null; limit?: number; offset?: number } | undefined,
    ) => {
      const raw = d ?? {};
      const status = raw.status && ADMIN_APP_STATUSES.includes(raw.status) ? raw.status : null;
      const rawLimit = Number.isFinite(raw.limit as number) ? Number(raw.limit) : 25;
      const rawOffset = Number.isFinite(raw.offset as number) ? Number(raw.offset) : 0;
      const limit = Math.min(Math.max(Math.trunc(rawLimit), 1), 100);
      const offset = Math.max(Math.trunc(rawOffset), 0);
      return { status, limit, offset };
    },
  )
  .handler(async ({ data, context }): Promise<AdminInstructorApplicationsPage> => {
    const { error, data: rows } = await context.supabase.rpc("list_instructor_applications_admin", {
      _status: data.status ?? undefined,
      _limit: data.limit,
      _offset: data.offset,
    });
    if (error) throw new Error(error.message);
    const list = (rows ?? []) as Array<{
      application_id: string;
      user_id: string;
      display_name: string | null;
      avatar_url: string | null;
      status: AdminApplicationStatus;
      application_reason: string | null;
      decision_reason: string | null;
      decided_by: string | null;
      decided_at: string | null;
      created_at: string;
      updated_at: string;
      is_current_instructor: boolean;
      total_count: number | string;
    }>;
    const total = list.length > 0 ? Number(list[0].total_count ?? 0) : 0;
    return {
      rows: list.map((r) => ({
        application_id: r.application_id,
        user_id: r.user_id,
        display_name: r.display_name,
        avatar_url: r.avatar_url,
        status: r.status,
        application_reason: r.application_reason,
        decision_reason: r.decision_reason,
        decided_by: r.decided_by,
        decided_at: r.decided_at,
        created_at: r.created_at,
        updated_at: r.updated_at,
        is_current_instructor: !!r.is_current_instructor,
      })),
      total: Number.isFinite(total) ? total : 0,
    };
  });

/**
 * Stable, admin-safe copy for instructor governance mutations and reads.
 * Raw Postgres/Supabase messages are never rendered to the UI.
 */
export function mapInstructorGovernanceError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  const s = raw.toLowerCase();
  if (s.includes("reason required")) {
    return "A reason is required.";
  }
  if (s.includes("not authenticated") || s.includes("unauthorized") || s.includes("28000")) {
    return "Please sign in and try again.";
  }
  if (s.includes("admin only") || s.includes("forbidden") || s.includes("42501")) {
    return "You don't have permission to perform this action.";
  }
  if (s.includes("application not found") || s.includes("42704")) {
    return "This application could not be found.";
  }
  if (
    s.includes("application not pending") ||
    s.includes("only pending applications") ||
    s.includes("22023")
  ) {
    return "This application is no longer pending.";
  }
  return "Something went wrong. Please try again in a moment.";
}

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
      .select(
        "id, title, position, duration_seconds, content, video_url, video_storage_path, is_preview, module_title",
      )
      .eq("course_id", course.id)
      .order("position", { ascending: true });
    return { course, lessons: lessons ?? [] };
  });

export type UpdateCourseInput = {
  courseId: string;
  title?: string;
  subtitle?: string | null;
  description?: string | null;
  category?: string;
  price_cents?: number;
  duration_label?: string | null;
  level?: string;
  language?: string;
  learn_outcomes?: string[];
  skills?: string[];
  requirements?: string[];
  audience?: string[];
  faq?: { q: string; a: string }[];
  instructor_name?: string | null;
  instructor_title?: string | null;
  instructor_bio?: string | null;
};

export const updateCourse = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: UpdateCourseInput) => {
    if (!d || typeof d !== "object" || typeof d.courseId !== "string" || d.courseId === "") {
      throw new Error("invalid_payload");
    }
    const patch = normalizeUpdateCoursePayload(d);
    return { courseId: d.courseId, patch };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertActiveInstructor(supabase);
    await assertCourseEditable(supabase, data.courseId);
    if (Object.keys(data.patch).length === 0) return { ok: true };
    // is_published, review_*, cover_*, slug, instructor_id, certificate,
    // rating, likes, students_count are column-level revoked or excluded
    // here. Instructors publish only via submit_course_for_review → admin.
    const { error } = await supabase
      .from("courses")
      // Typed columns are enforced by normalizeUpdateCoursePayload; supabase's
      // deep union rejects Record<string, unknown> at compile time.
      .update(data.patch as never)
      .eq("id", data.courseId)
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
    await assertCourseEditable(supabase, data.courseId);
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
    (raw: {
      lessonId?: string;
      courseId: string;
      title: string;
      position: number;
      duration_seconds?: number | null;
      content?: string | null;
      is_preview?: boolean;
      module_title?: string | null;
    }) => {
      // Legacy external video URL is closed off. Reject it explicitly so a
      // stale client can never smuggle it in.
      if (raw && typeof raw === "object" && "video_url" in (raw as Record<string, unknown>)) {
        throw new Error("video_url is no longer accepted; use the video uploader.");
      }
      return raw;
    },
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertActiveInstructor(supabase);
    await assertCourseEditable(supabase, data.courseId);
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
          is_preview: data.is_preview ?? false,
          module_title: data.module_title ?? null,
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
        is_preview: data.is_preview ?? false,
        module_title: data.module_title ?? null,
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
    await assertCourseEditable(supabase, data.courseId);
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

/**
 * Reorder the full lesson set of a course. The client must send EVERY lesson
 * id belonging to the course, in the desired order. The server RPC enforces
 * ownership, editability, no duplicates, no nulls, and that the input set
 * exactly matches the persisted set — no partial reorders are permitted.
 */
// Exported for unit tests: strict input schema for reorderLessons. Keeping
// it named ensures tests exercise the exact validator the server function
// runs before any RPC is issued.
export const reorderLessonsInputSchema = z
  .object({
    courseId: z.string().uuid("invalid_course_id"),
    lessonIds: z
      .array(z.string().uuid("invalid_lesson_id"))
      .min(1, "lesson_ids_required")
      .refine((ids) => new Set(ids).size === ids.length, {
        message: "duplicate_lesson_ids",
      }),
  })
  .strict();

export const reorderLessons = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => {
    // Strict schema: rejects unknown fields, non-UUID ids, empty arrays,
    // duplicates, and anything not matching the exact shape — before any
    // RPC or database call is ever issued.
    const parsed = reorderLessonsInputSchema.safeParse(d);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw new Error(first?.message ?? "invalid_reorder_input");
    }
    return parsed.data;
  })
  .handler(async ({ data, context }) => {
    await assertActiveInstructor(context.supabase);
    const { error } = await context.supabase.rpc("reorder_lessons", {
      _course_id: data.courseId,
      _lesson_ids: data.lessonIds,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export type SubmitCourseResult =
  | { ok: true }
  | { ok: false; code: "course_not_ready"; blockers: CourseReadinessBlocker[] }
  | { ok: false; code: "readiness_refetch_failed"; blockers: [] };

export const submitCourseForReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { courseId: string }) => d)
  .handler(async ({ data, context }): Promise<SubmitCourseResult> => {
    await assertActiveInstructor(context.supabase);
    const { error } = await context.supabase.rpc("submit_course_for_review", {
      _course_id: data.courseId,
    });
    if (!error) return { ok: true };
    if (error.message === "course_not_ready") {
      // Refetch authoritative readiness exactly once. If that fails, return
      // a stable typed result so the UI never leaks raw messages.
      const { data: readiness, error: readErr } = await context.supabase.rpc(
        "evaluate_course_readiness",
        { _course_id: data.courseId },
      );
      if (readErr) {
        return { ok: false, code: "readiness_refetch_failed", blockers: [] };
      }
      const first = Array.isArray(readiness) ? readiness[0] : readiness;
      const blockers = normalizeReadinessBlockers(
        (first as { blockers?: unknown } | null)?.blockers,
      );
      return { ok: false, code: "course_not_ready", blockers };
    }
    // Any other DB failure surfaces as stable governance copy at call sites.
    throw new Error(error.message);
  });

export const getCourseReadiness = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { courseId: string }) => d)
  .handler(async ({ data, context }) => {
    await assertActiveInstructor(context.supabase);
    const { data: rows, error } = await context.supabase.rpc("evaluate_course_readiness", {
      _course_id: data.courseId,
    });
    if (error) throw new Error(error.message);
    const first = Array.isArray(rows) ? rows[0] : rows;
    const raw = (first as { is_ready?: unknown; blockers?: unknown } | null) ?? {};
    const blockers = normalizeReadinessBlockers(raw.blockers);
    const isReady = raw.is_ready === true && blockers.length === 0;
    return { is_ready: isReady, blockers };
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

export type AdminLessonMeta = {
  id: string;
  title: string;
  position: number;
  duration_seconds: number | null;
  module_title: string | null;
  is_preview: boolean;
};

export type AdminCourseDetailWithLessons = AdminCourseDetail & {
  lessons: AdminLessonMeta[];
};

/**
 * Pure editability rule. Fail-closed: any state that isn't the exact
 * `draft` or `rejected` string with `is_published === false` locks the
 * course. Exported for unit tests and UI gating.
 */
export function isCourseEditable(input: {
  is_published?: boolean | null;
  review_status?: string | null;
}): boolean {
  if (input.is_published !== false) return false;
  return input.review_status === "draft" || input.review_status === "rejected";
}

/**
 * Stable, learner/admin-safe error copy. Raw Supabase / Postgres
 * error messages are never surfaced to end users.
 */
export function mapCourseGovernanceError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  const s = raw.toLowerCase();
  if (
    s.includes("not authenticated") ||
    s.includes("unauthorized") ||
    s.includes("admin only") ||
    s.includes("42501") ||
    s.includes("28000")
  ) {
    return "You don't have permission to perform this action.";
  }
  if (s.includes("course not found") || s.includes("42704")) {
    return "Course not found.";
  }
  if (
    s.includes("not in published/approved state") ||
    s.includes("not in a submittable state") ||
    s.includes("not pending") ||
    s.includes("22023")
  ) {
    return "This course is not in a state that allows this action.";
  }
  if (
    s.includes("learner enrollments") ||
    s.includes("learner completions") ||
    s.includes("learner reviews") ||
    s.includes("learner history")
  ) {
    return "Learner history prevents editing this course.";
  }
  return "Something went wrong. Please try again in a moment.";
}

export const getAdminCourse = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { courseId: string }) => d)
  .handler(async ({ data, context }): Promise<AdminCourseDetailWithLessons | null> => {
    await assertAdmin(context.supabase);
    const { data: rows, error } = await context.supabase.rpc("get_admin_course", {
      _course_id: data.courseId,
    });
    if (error) throw new Error(error.message);
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row) return null;
    const { data: lessons, error: lErr } = await context.supabase.rpc("get_admin_course_lessons", {
      _course_id: data.courseId,
    });
    if (lErr) throw new Error(lErr.message);
    return {
      ...(row as AdminCourseDetail),
      lessons: (lessons ?? []) as AdminLessonMeta[],
    };
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
