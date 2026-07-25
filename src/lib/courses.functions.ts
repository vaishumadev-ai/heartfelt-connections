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

export const listCourses = createServerFn({ method: "GET" }).handler(async (): Promise<CourseCard[]> => {
  const supabase = pubClient();
  const { data, error } = await supabase
    .from("courses")
    .select("id, slug, title, subtitle, category, icon_kind, price_cents, duration_label, rating, likes")
    .eq("is_published", true)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
});

export type CourseDetail = CourseCard & {
  description: string | null;
  cover_url: string | null;
  lessons: { id: string; title: string; position: number; duration_seconds: number | null }[];
};

export const getCourseBySlug = createServerFn({ method: "GET" })
  .inputValidator((d: { slug: string }) => d)
  .handler(async ({ data }): Promise<CourseDetail | null> => {
    const supabase = pubClient();
    const { data: course, error } = await supabase
      .from("courses")
      .select("id, slug, title, subtitle, category, icon_kind, price_cents, duration_label, rating, likes, description, cover_url")
      .eq("slug", data.slug)
      .eq("is_published", true)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!course) return null;
    const { data: lessons } = await supabase
      .from("lessons")
      .select("id, title, position, duration_seconds")
      .eq("course_id", course.id)
      .order("position", { ascending: true });
    return { ...course, lessons: lessons ?? [] };
  });

export const enrollInCourse = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { courseId: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("enrollments")
      .upsert({ user_id: userId, course_id: data.courseId }, { onConflict: "user_id,course_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listMyEnrollments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("enrollments")
      .select("progress, enrolled_at, course:courses(id, slug, title, subtitle, category, icon_kind, price_cents, duration_label, rating, likes)")
      .eq("user_id", userId)
      .order("enrolled_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export type LessonPlayer = {
  course: { id: string; slug: string; title: string; category: string };
  lessons: { id: string; title: string; position: number; duration_seconds: number | null; content: string | null; video_url: string | null }[];
  current: { id: string; title: string; position: number; duration_seconds: number | null; content: string | null; video_url: string | null };
  completedIds: string[];
  enrolled: boolean;
};

export const getLessonPlayer = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { slug: string; lessonId?: string }) => d)
  .handler(async ({ data, context }): Promise<LessonPlayer | null> => {
    const { supabase, userId } = context;
    const { data: course, error: cErr } = await supabase
      .from("courses")
      .select("id, slug, title, category")
      .eq("slug", data.slug)
      .eq("is_published", true)
      .maybeSingle();
    if (cErr) throw new Error(cErr.message);
    if (!course) return null;
    const { data: lessons, error: lErr } = await supabase
      .from("lessons")
      .select("id, title, position, duration_seconds, content, video_url")
      .eq("course_id", course.id)
      .order("position", { ascending: true });
    if (lErr) throw new Error(lErr.message);
    if (!lessons || lessons.length === 0) return null;
    const current = (data.lessonId && lessons.find((l) => l.id === data.lessonId)) || lessons[0];
    const { data: enr } = await supabase
      .from("enrollments")
      .select("id")
      .eq("user_id", userId)
      .eq("course_id", course.id)
      .maybeSingle();
    const { data: comps } = await supabase
      .from("lesson_completions")
      .select("lesson_id")
      .eq("user_id", userId)
      .eq("course_id", course.id);
    return {
      course,
      lessons,
      current,
      completedIds: (comps ?? []).map((c) => c.lesson_id),
      enrolled: !!enr,
    };
  });

export const markLessonComplete = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { lessonId: string; courseId: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Upsert completion
    const { error } = await supabase
      .from("lesson_completions")
      .upsert({ user_id: userId, course_id: data.courseId, lesson_id: data.lessonId }, { onConflict: "user_id,lesson_id" });
    if (error) throw new Error(error.message);
    // Recompute progress
    const [{ count: total }, { count: done }] = await Promise.all([
      supabase.from("lessons").select("id", { count: "exact", head: true }).eq("course_id", data.courseId),
      supabase.from("lesson_completions").select("id", { count: "exact", head: true }).eq("course_id", data.courseId).eq("user_id", userId),
    ]);
    const progress = total && total > 0 ? Math.round(((done ?? 0) / total) * 100) : 0;
    await supabase
      .from("enrollments")
      .update({ progress, last_lesson_id: data.lessonId })
      .eq("user_id", userId)
      .eq("course_id", data.courseId);
    return { progress };
  });

// ============ Instructor Studio ============

function slugify(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60) || `course-${Date.now()}`;
}

export const getMyRoles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => r.role as string);
  });

export const becomeInstructor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: userId, role: "instructor" }, { onConflict: "user_id,role" });
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
    const { data, error } = await supabase
      .from("courses")
      .select("id, slug, title, subtitle, category, price_cents, is_published, updated_at")
      .eq("instructor_id", userId)
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createCourse = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { title: string; category: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
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
  .inputValidator((d: {
    courseId: string;
    title?: string;
    subtitle?: string | null;
    description?: string | null;
    category?: string;
    price_cents?: number;
    duration_label?: string | null;
    icon_kind?: string | null;
    is_published?: boolean;
  }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { courseId, ...rest } = data;
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
  .inputValidator((d: {
    lessonId?: string;
    courseId: string;
    title: string;
    position: number;
    duration_seconds?: number | null;
    content?: string | null;
    video_url?: string | null;
  }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
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
    const { data: owned } = await supabase
      .from("courses")
      .select("id")
      .eq("id", data.courseId)
      .eq("instructor_id", userId)
      .maybeSingle();
    if (!owned) throw new Error("Not authorized");
    const { error } = await supabase.from("lessons").delete().eq("id", data.lessonId);
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
    const { data: rows, error } = await supabase
      .from("reviews")
      .select("id, user_id, rating, body, created_at, author:profiles(display_name, avatar_url)")
      .eq("course_id", data.courseId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (rows ?? []) as unknown as ReviewItem[];
  });

async function recomputeCourseRating(courseId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: rows } = await supabaseAdmin
    .from("reviews")
    .select("rating")
    .eq("course_id", courseId);
  const list = rows ?? [];
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
    const { supabase, userId } = context;
    // Delete previous review from this user for the course, then insert (portable "upsert")
    await supabase.from("reviews").delete().eq("user_id", userId).eq("course_id", data.courseId);
    const { error } = await supabase.from("reviews").insert({
      user_id: userId,
      course_id: data.courseId,
      rating: data.rating,
      body: data.body,
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