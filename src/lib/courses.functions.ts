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