import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
    const { supabase, userId } = context;
    // Load & validate course first — fail closed before any write.
    const { data: course, error: cErr } = await supabase
      .from("courses")
      .select("id, is_published, price_cents")
      .eq("id", data.courseId)
      .maybeSingle();
    if (cErr) throw new Error(cErr.message);
    assertFreePublishedCourse(course);
    // Free published course — insert; RLS policy also enforces these preconditions.
    // Idempotent: ignore duplicate-key on (user_id, course_id).
    const { error } = await supabase
      .from("enrollments")
      .insert({ user_id: userId, course_id: data.courseId });
    if (error && !/duplicate key|unique/i.test(error.message)) {
      throw new Error(error.message);
    }
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

export type LessonPlayer = {
  course: { id: string; slug: string; title: string; category: string };
  lessons: {
    id: string;
    title: string;
    position: number;
    duration_seconds: number | null;
    content: string | null;
    video_url: string | null;
  }[];
  current: {
    id: string;
    title: string;
    position: number;
    duration_seconds: number | null;
    content: string | null;
    video_url: string | null;
  };
  completedIds: string[];
  enrolled: boolean;
};

export const getLessonPlayer = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { slug: string; lessonId?: string }) => d)
  .handler(async ({ data, context }): Promise<LessonPlayer | null> => {
    const { supabase, userId } = context;
    // 1) Resolve course; allow drafts only for owner/admin.
    const { data: course, error: cErr } = await supabase
      .from("courses")
      .select("id, slug, title, category, is_published, instructor_id, price_cents")
      .eq("slug", data.slug)
      .maybeSingle();
    if (cErr) throw new Error(cErr.message);
    if (!course) return null;

    // 2) Authorize BEFORE fetching protected content.
    const isOwner = course.instructor_id === userId;
    // Role-check errors must fail closed — never silently downgrade to isAdmin=false.
    const { data: isAdminData, error: roleErr } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (roleErr) throw new Error(`Authorization check failed: ${roleErr.message}`);
    const isAdmin = !!isAdminData;

    if (!course.is_published && !isOwner && !isAdmin) return null;

    const { data: enr } = await supabase
      .from("enrollments")
      .select("id")
      .eq("user_id", userId)
      .eq("course_id", course.id)
      .maybeSingle();
    const enrolled = !!enr;
    // Entitlement decision: enrollment counts as a learner entitlement only
    // when the course is free. Paid historical enrollments grant no lesson
    // access until a payment-backed entitlement system exists.
    const entitlement = resolveLessonEntitlement({
      course: { is_published: course.is_published, price_cents: course.price_cents },
      isOwner,
      isAdmin,
      enrolled,
    });
    const fullAccess = entitlement === "full";

    // 3) Fetch content according to entitlement — never fetch-then-filter.
    let lessons: LessonPlayer["lessons"];
    if (fullAccess) {
      const { data: rows, error: lErr } = await supabase
        .from("lessons")
        .select("id, title, position, duration_seconds, content, video_url")
        .eq("course_id", course.id)
        .order("position", { ascending: true });
      if (lErr) throw new Error(lErr.message);
      lessons = rows ?? [];
    } else {
      // Public preview only — protected lessons are never returned.
      const { data: rows, error: lErr } = await supabase
        .from("lessons")
        .select("id, title, position, duration_seconds, content, video_url, is_preview")
        .eq("course_id", course.id)
        .eq("is_preview", true)
        .order("position", { ascending: true });
      if (lErr) throw new Error(lErr.message);
      lessons = (rows ?? []).map(({ is_preview: _p, ...rest }) => rest);
    }

    if (lessons.length === 0) return null;

    // If a specific lessonId was requested but is not in the returned
    // (authorized) set, fail closed rather than silently swapping to lesson 0.
    if (data.lessonId && !lessons.some((l) => l.id === data.lessonId)) {
      if (!fullAccess) {
        // Requesting a protected lesson without entitlement: deny.
        return null;
      }
    }

    const current = (data.lessonId && lessons.find((l) => l.id === data.lessonId)) || lessons[0];

    const { data: comps } = await supabase
      .from("lesson_completions")
      .select("lesson_id")
      .eq("user_id", userId)
      .eq("course_id", course.id);

    return {
      course: { id: course.id, slug: course.slug, title: course.title, category: course.category },
      lessons,
      current,
      completedIds: (comps ?? []).map((c) => c.lesson_id),
      enrolled,
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function assertActiveInstructor(supabase: any): Promise<void> {
  const { data, error } = await supabase.rpc("current_user_has_role", { _role: "instructor" });
  if (error) throw new Error(`Authorization check failed: ${error.message}`);
  if (data === true) return;
  const { data: adm, error: aErr } = await supabase.rpc("current_user_has_role", { _role: "admin" });
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
      .select("id, slug, title, subtitle, category, price_cents, is_published, updated_at, review_status")
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
        is_published: false,
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
