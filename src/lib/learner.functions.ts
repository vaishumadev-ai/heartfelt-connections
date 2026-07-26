import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ---------- DTOs shared with UI ------------------------------------------
export type LearnerEnrollmentDTO = {
  id: string;
  course_id: string;
  progress: number;
  last_lesson_id: string | null;
  last_activity_at: string;
  course: {
    id: string;
    slug: string;
    title: string;
    subtitle: string | null;
    category: string;
    icon_kind: string | null;
    duration_label: string | null;
  };
};

export type LearnerNoteDTO = {
  id: string;
  course_id: string;
  lesson_id: string;
  body: string;
  updated_at: string;
  created_at: string;
};

export type LearnerBookmarkDTO = {
  id: string;
  course_id: string;
  lesson_id: string;
  created_at: string;
};

export type LearnerDashboardDTO = {
  enrollments: LearnerEnrollmentDTO[];
  libraryHasMore: boolean;
  notes: LearnerNoteDTO[];
  bookmarks: LearnerBookmarkDTO[];
};

// ---------- getLearnerDashboard ------------------------------------------
export const getLearnerDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<LearnerDashboardDTO> => {
    const { supabase } = context;
    const { data, error } = await supabase.rpc("get_learner_dashboard", { _limit: 24 });
    if (error) throw new Error(error.message);
    const payload = (data ?? {}) as Partial<LearnerDashboardDTO> & {
      enrollments?: Array<Record<string, unknown>>;
    };

    // The RPC returns row_to_json(courses) inline. Normalize into the DTO the
    // UI expects, projecting only safe columns.
    const enrollments: LearnerEnrollmentDTO[] = (payload.enrollments ?? []).map((row) => {
      const c = (row.course ?? {}) as Record<string, unknown>;
      return {
        id: String(row.id),
        course_id: String(row.course_id),
        progress: Number(row.progress ?? 0),
        last_lesson_id: (row.last_lesson_id as string | null) ?? null,
        last_activity_at: String(row.last_activity_at),
        course: {
          id: String(c.id),
          slug: String(c.slug),
          title: String(c.title),
          subtitle: (c.subtitle as string | null) ?? null,
          category: String(c.category ?? ""),
          icon_kind: (c.icon_kind as string | null) ?? null,
          duration_label: (c.duration_label as string | null) ?? null,
        },
      };
    });

    return {
      enrollments,
      libraryHasMore: Boolean(payload.libraryHasMore),
      notes: (payload.notes ?? []) as LearnerNoteDTO[],
      bookmarks: (payload.bookmarks ?? []) as LearnerBookmarkDTO[],
    };
  });

// ---------- Personal-data RPCs -------------------------------------------
const noteInput = z.object({
  courseId: z.string().uuid(),
  lessonId: z.string().uuid(),
  body: z.string().trim().min(1).max(4000),
});

export const saveLessonNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => noteInput.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("save_lesson_note", {
      _course_id: data.courseId,
      _lesson_id: data.lessonId,
      _body: data.body,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const deleteLessonNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ lessonId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("delete_lesson_note", {
      _lesson_id: data.lessonId,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const addLessonBookmark = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ courseId: z.string().uuid(), lessonId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("add_lesson_bookmark", {
      _course_id: data.courseId,
      _lesson_id: data.lessonId,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const removeLessonBookmark = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ lessonId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("remove_lesson_bookmark", {
      _lesson_id: data.lessonId,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

// ---------- Continue Learning selection (pure) --------------------------
export type ContinuePick = {
  enrollment: LearnerEnrollmentDTO;
  reason: "in_progress" | "recent";
} | null;

/**
 * Continue Learning rule:
 *  1. Highest last_activity_at with progress in (0, 100).
 *  2. Otherwise the most recently active enrollment (progress 0 or 100).
 *  3. null when no active enrollments exist.
 */
export function pickContinue(enrollments: LearnerEnrollmentDTO[]): ContinuePick {
  if (enrollments.length === 0) return null;
  const sorted = [...enrollments].sort(
    (a, b) => Date.parse(b.last_activity_at) - Date.parse(a.last_activity_at),
  );
  const inProgress = sorted.find((e) => e.progress > 0 && e.progress < 100);
  if (inProgress) return { enrollment: inProgress, reason: "in_progress" };
  return { enrollment: sorted[0], reason: "recent" };
}