/* @vitest-environment jsdom */
/* eslint-disable @typescript-eslint/no-explicit-any, no-constant-binary-expression */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Prevent real server-fn / auth middleware wiring.
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    middleware: () => ({
      inputValidator: () => ({
        handler: (fn: unknown) => fn,
      }),
      handler: (fn: unknown) => fn,
    }),
    inputValidator: () => ({
      handler: (fn: unknown) => fn,
    }),
    handler: (fn: unknown) => fn,
  }),
}));

vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: {},
}));

// Fail hard if any test imports the service-role admin client.
vi.mock("@/integrations/supabase/client.server", () => {
  throw new Error("service-role client must not be constructed by getLessonPlayer");
});

import { getLessonPlayer } from "@/lib/courses.functions";

// ------- Supabase mock builder -------

type QueryResult = { data: unknown; error: unknown };

function makeSupabase(spec: {
  course?: QueryResult;
  enrollment?: QueryResult;
  isAdmin?: QueryResult;
  isInstructor?: QueryResult;
  completions?: QueryResult;
  curriculumRpc?: QueryResult;
  lessonsAuthorized?: QueryResult;
  lessonsPreview?: QueryResult;
  lessonsFallback?: QueryResult;
}) {
  const previewFilter = { called: false };
  const supabase = {
    _previewFilter: previewFilter,
    from(table: string) {
      const q: any = {
        _eq: {} as Record<string, unknown>,
        _cols: undefined as string | undefined,
        select(cols?: string) {
          q._cols = cols;
          return q;
        },
        eq(col: string, val: unknown) {
          q._eq[col] = val;
          if (table === "lessons" && col === "is_preview" && val === true) {
            previewFilter.called = true;
          }
          return q;
        },
        maybeSingle() {
          if (table === "courses")
            return Promise.resolve(spec.course ?? { data: null, error: null });
          if (table === "enrollments")
            return Promise.resolve(spec.enrollment ?? { data: null, error: null });
          return Promise.resolve({ data: null, error: null });
        },
        then(resolve: (v: QueryResult) => unknown) {
          if (table === "lesson_completions")
            return Promise.resolve(spec.completions ?? { data: [], error: null }).then(resolve);
          if (table === "lessons") {
            if (previewFilter.called)
              return Promise.resolve(spec.lessonsPreview ?? { data: [], error: null }).then(
                resolve,
              );
            // Fallback path (owner/admin draft) selects id, position, is_preview
            // WITHOUT title — distinguish by inspecting the requested cols.
            const cols = typeof q._cols === "string" ? q._cols : "";
            const isFallback = cols.length > 0 && !cols.includes("title");
            if (isFallback)
              return Promise.resolve(spec.lessonsFallback ?? { data: [], error: null }).then(
                resolve,
              );
            return Promise.resolve(spec.lessonsAuthorized ?? { data: [], error: null }).then(
              resolve,
            );
          }
          return Promise.resolve({ data: [], error: null }).then(resolve);
        },
      };
      return q;
    },
    rpc(name: string, args: Record<string, unknown>) {
      if (name === "has_role") {
        if (args._role === "admin")
          return Promise.resolve(spec.isAdmin ?? { data: false, error: null });
        if (args._role === "instructor")
          return Promise.resolve(spec.isInstructor ?? { data: false, error: null });
      }
      if (name === "get_course_curriculum") {
        return Promise.resolve(spec.curriculumRpc ?? { data: [], error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  };
  return supabase as any;
}

const call = (supabase: any, input: { slug: string; lessonId?: string }, userId = "user-1") =>
  (getLessonPlayer as any)({ data: input, context: { supabase, userId } });

beforeEach(() => vi.clearAllMocks());

describe("getLessonPlayer — fail-closed database errors", () => {
  it("throws when the enrollment lookup errors", async () => {
    const supabase = makeSupabase({
      course: {
        data: {
          id: "c1",
          slug: "s",
          title: "t",
          category: "d",
          is_published: true,
          instructor_id: "other",
          price_cents: 0,
        },
        error: null,
      },
      isAdmin: { data: false, error: null },
      isInstructor: { data: false, error: null },
      enrollment: { data: null, error: { message: "conn reset" } },
    });
    await expect(call(supabase, { slug: "s" })).rejects.toThrow(/conn reset/);
  });

  it("throws when the admin role check errors", async () => {
    const supabase = makeSupabase({
      course: {
        data: {
          id: "c1",
          slug: "s",
          title: "t",
          category: "d",
          is_published: true,
          instructor_id: "other",
          price_cents: 0,
        },
        error: null,
      },
      isAdmin: { data: null, error: { message: "role fail" } },
      isInstructor: { data: false, error: null },
    });
    await expect(call(supabase, { slug: "s" })).rejects.toThrow(/Authorization check failed/);
  });

  it("throws when the instructor role check errors (active-owner verification)", async () => {
    const supabase = makeSupabase({
      course: {
        data: {
          id: "c1",
          slug: "s",
          title: "t",
          category: "d",
          is_published: true,
          instructor_id: "user-1",
          price_cents: 0,
        },
        error: null,
      },
      isAdmin: { data: false, error: null },
      isInstructor: { data: null, error: { message: "role fail" } },
    });
    await expect(call(supabase, { slug: "s" })).rejects.toThrow(/Authorization check failed/);
  });
});

describe("getLessonPlayer — authoritative progress", () => {
  it("returns enrollment.progress unchanged (clamped) for trackable learners", async () => {
    const supabase = makeSupabase({
      course: {
        data: {
          id: "c1",
          slug: "s",
          title: "t",
          category: "d",
          is_published: true,
          instructor_id: "other",
          price_cents: 0,
        },
        error: null,
      },
      isAdmin: { data: false, error: null },
      isInstructor: { data: false, error: null },
      enrollment: { data: { id: "e1", last_lesson_id: null, progress: 42 }, error: null },
      completions: { data: [], error: null },
      curriculumRpc: {
        data: [
          {
            lesson_id: "l1",
            lesson_title: "L1",
            lesson_position: 1,
            duration_seconds: 300,
            is_preview: true,
            module_title: null,
          },
          {
            lesson_id: "l2",
            lesson_title: "L2",
            lesson_position: 2,
            duration_seconds: 300,
            is_preview: false,
            module_title: null,
          },
        ],
        error: null,
      },
      lessonsAuthorized: {
        data: [
          {
            id: "l1",
            title: "L1",
            position: 1,
            duration_seconds: 300,
            is_preview: true,
            content: "c",
            video_url: null,
          },
          {
            id: "l2",
            title: "L2",
            position: 2,
            duration_seconds: 300,
            is_preview: false,
            content: "c",
            video_url: null,
          },
        ],
        error: null,
      },
    });
    const res: any = await call(supabase, { slug: "s" });
    expect(res.state).toBe("ready");
    expect(res.progress).toBe(42);
    expect(res.canTrackProgress).toBe(true);
    expect(res.courseComplete).toBe(false);
  });

  it("clamps enrollment.progress above 100", async () => {
    const supabase = makeSupabase({
      course: {
        data: {
          id: "c1",
          slug: "s",
          title: "t",
          category: "d",
          is_published: true,
          instructor_id: "other",
          price_cents: 0,
        },
        error: null,
      },
      isAdmin: { data: false, error: null },
      isInstructor: { data: false, error: null },
      enrollment: { data: { id: "e1", last_lesson_id: null, progress: 999 }, error: null },
      completions: { data: [], error: null },
      curriculumRpc: {
        data: [
          {
            lesson_id: "l1",
            lesson_title: "L1",
            lesson_position: 1,
            duration_seconds: 300,
            is_preview: true,
            module_title: null,
          },
        ],
        error: null,
      },
      lessonsAuthorized: {
        data: [
          {
            id: "l1",
            title: "L1",
            position: 1,
            duration_seconds: 300,
            is_preview: true,
            content: "c",
            video_url: null,
          },
        ],
        error: null,
      },
    });
    const res: any = await call(supabase, { slug: "s" });
    expect(res.progress).toBe(100);
    expect(res.courseComplete).toBe(true);
  });

  it("returns progress=null for preview (untrackable) viewers", async () => {
    const supabase = makeSupabase({
      course: {
        data: {
          id: "c1",
          slug: "s",
          title: "t",
          category: "d",
          is_published: true,
          instructor_id: "other",
          price_cents: 0,
        },
        error: null,
      },
      isAdmin: { data: false, error: null },
      isInstructor: { data: false, error: null },
      enrollment: { data: null, error: null },
      curriculumRpc: {
        data: [
          {
            lesson_id: "l1",
            lesson_title: "L1",
            lesson_position: 1,
            duration_seconds: 300,
            is_preview: true,
            module_title: null,
          },
        ],
        error: null,
      },
      lessonsPreview: {
        data: [
          {
            id: "l1",
            title: "L1",
            position: 1,
            duration_seconds: 300,
            is_preview: true,
            content: "c",
            video_url: null,
          },
        ],
        error: null,
      },
    });
    const res: any = await call(supabase, { slug: "s" });
    expect(res.progress).toBeNull();
    expect(res.canTrackProgress).toBe(false);
  });
});

describe("getLessonPlayer — canSelfEnroll matrix + preview filter", () => {
  it("preview query filters is_preview=true for preview viewers", async () => {
    const supabase = makeSupabase({
      course: {
        data: {
          id: "c1",
          slug: "s",
          title: "t",
          category: "d",
          is_published: true,
          instructor_id: "other",
          price_cents: 0,
        },
        error: null,
      },
      isAdmin: { data: false, error: null },
      isInstructor: { data: false, error: null },
      enrollment: { data: null, error: null },
      curriculumRpc: {
        data: [
          {
            lesson_id: "l1",
            lesson_title: "L1",
            lesson_position: 1,
            duration_seconds: 300,
            is_preview: true,
            module_title: null,
          },
          {
            lesson_id: "l2",
            lesson_title: "L2",
            lesson_position: 2,
            duration_seconds: 300,
            is_preview: false,
            module_title: null,
          },
        ],
        error: null,
      },
      lessonsPreview: {
        data: [
          {
            id: "l1",
            title: "L1",
            position: 1,
            duration_seconds: 300,
            is_preview: true,
            content: "c",
            video_url: null,
          },
        ],
        error: null,
      },
    });
    const res: any = await call(supabase, { slug: "s" });
    expect(res.state).toBe("ready");
    expect(supabase._previewFilter.called).toBe(true);
    expect(res.canSelfEnroll).toBe(true); // free published, not enrolled, not owner/admin
  });

  it("canSelfEnroll=false for paid published courses", async () => {
    const supabase = makeSupabase({
      course: {
        data: {
          id: "c1",
          slug: "s",
          title: "t",
          category: "d",
          is_published: true,
          instructor_id: "other",
          price_cents: 4999,
        },
        error: null,
      },
      isAdmin: { data: false, error: null },
      isInstructor: { data: false, error: null },
      enrollment: { data: null, error: null },
      curriculumRpc: {
        data: [
          {
            lesson_id: "l1",
            lesson_title: "L1",
            lesson_position: 1,
            duration_seconds: 300,
            is_preview: true,
            module_title: null,
          },
        ],
        error: null,
      },
      lessonsPreview: {
        data: [
          {
            id: "l1",
            title: "L1",
            position: 1,
            duration_seconds: 300,
            is_preview: true,
            content: "c",
            video_url: null,
          },
        ],
        error: null,
      },
    });
    const res: any = await call(supabase, { slug: "s" });
    expect(res.canSelfEnroll).toBe(false);
  });

  it("canSelfEnroll=false for admin viewer of a free course", async () => {
    const supabase = makeSupabase({
      course: {
        data: {
          id: "c1",
          slug: "s",
          title: "t",
          category: "d",
          is_published: true,
          instructor_id: "other",
          price_cents: 0,
        },
        error: null,
      },
      isAdmin: { data: true, error: null },
      isInstructor: { data: false, error: null },
      enrollment: { data: null, error: null },
      curriculumRpc: {
        data: [
          {
            lesson_id: "l1",
            lesson_title: "L1",
            lesson_position: 1,
            duration_seconds: 300,
            is_preview: false,
            module_title: null,
          },
        ],
        error: null,
      },
      lessonsAuthorized: {
        data: [
          {
            id: "l1",
            title: "L1",
            position: 1,
            duration_seconds: 300,
            is_preview: false,
            content: "c",
            video_url: null,
          },
        ],
        error: null,
      },
    });
    const res: any = await call(supabase, { slug: "s" });
    expect(res.canSelfEnroll).toBe(false);
    expect(res.entitlement).toBe("full");
    expect(res.canTrackProgress).toBe(false);
    expect(res.progress).toBeNull();
  });

  it("instructor_id match WITHOUT active instructor role does NOT grant full access", async () => {
    const supabase = makeSupabase({
      // instructor_id matches user-1, but role is revoked (isInstructor=false).
      course: {
        data: {
          id: "c1",
          slug: "s",
          title: "t",
          category: "d",
          is_published: true,
          instructor_id: "user-1",
          price_cents: 0,
        },
        error: null,
      },
      isAdmin: { data: false, error: null },
      isInstructor: { data: false, error: null },
      enrollment: { data: null, error: null },
      curriculumRpc: {
        data: [
          {
            lesson_id: "l1",
            lesson_title: "L1",
            lesson_position: 1,
            duration_seconds: 300,
            is_preview: true,
            module_title: null,
          },
        ],
        error: null,
      },
      lessonsPreview: {
        data: [
          {
            id: "l1",
            title: "L1",
            position: 1,
            duration_seconds: 300,
            is_preview: true,
            content: "c",
            video_url: null,
          },
        ],
        error: null,
      },
    });
    const res: any = await call(supabase, { slug: "s" });
    expect(res.entitlement).toBe("preview");
  });
});
