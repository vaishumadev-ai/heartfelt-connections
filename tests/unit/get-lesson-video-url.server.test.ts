/* @vitest-environment jsdom */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    middleware: () => ({
      inputValidator: (fn: any) => ({
        handler: (h: any) => Object.assign(h, { __validate: fn }),
      }),
      handler: (h: any) => h,
    }),
    inputValidator: (fn: any) => ({
      handler: (h: any) => Object.assign(h, { __validate: fn }),
    }),
    handler: (h: any) => h,
  }),
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: {},
}));
// Absolutely never use the service-role admin client for signing.
vi.mock("@/integrations/supabase/client.server", () => {
  throw new Error("service-role client must not be imported by getLessonVideoUrl");
});

import { getLessonVideoUrl } from "@/lib/courses.functions";

// ---------- Supabase mock ----------
type Result<T = any> = { data: T; error: any };
function makeSupabase(spec: {
  course?: Result;
  isAdmin?: Result;
  isInstructor?: Result;
  enrollment?: Result;
  lesson?: Result;
  sign?: Result<{ signedUrl?: string } | null>;
}) {
  const storageCall = { bucket: null as string | null, path: null as string | null, ttl: 0 };
  const supabase = {
    _storageCall: storageCall,
    from(table: string) {
      const q: any = {
        _eq: {} as Record<string, unknown>,
        select() {
          return q;
        },
        eq(col: string, val: unknown) {
          q._eq[col] = val;
          return q;
        },
        maybeSingle() {
          if (table === "courses")
            return Promise.resolve(spec.course ?? { data: null, error: null });
          if (table === "enrollments")
            return Promise.resolve(spec.enrollment ?? { data: null, error: null });
          if (table === "lessons")
            return Promise.resolve(spec.lesson ?? { data: null, error: null });
          return Promise.resolve({ data: null, error: null });
        },
      };
      return q;
    },
    rpc(name: string, args: any) {
      if (name === "has_role") {
        if (args._role === "admin")
          return Promise.resolve(spec.isAdmin ?? { data: false, error: null });
        if (args._role === "instructor")
          return Promise.resolve(spec.isInstructor ?? { data: false, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    storage: {
      from(bucket: string) {
        storageCall.bucket = bucket;
        return {
          createSignedUrl: (p: string, ttl: number) => {
            storageCall.path = p;
            storageCall.ttl = ttl;
            return Promise.resolve(spec.sign ?? { data: { signedUrl: "https://s/x" }, error: null });
          },
        };
      },
    },
  };
  return supabase as any;
}

const call = (
  supabase: any,
  input: { slug: string; lessonId: string },
  userId = "user-1",
) => (getLessonVideoUrl as any)({ data: input, context: { supabase, userId } });

const VALID_LESSON = "11111111-1111-1111-1111-111111111111";
const publishedFreeCourse = (owner = "other") => ({
  data: { id: "c1", is_published: true, instructor_id: owner, price_cents: 0 },
  error: null,
});
const paidCourse = (owner = "other") => ({
  data: { id: "c1", is_published: true, instructor_id: owner, price_cents: 4999 },
  error: null,
});
const draftCourse = (owner = "other") => ({
  data: { id: "c1", is_published: false, instructor_id: owner, price_cents: 0 },
  error: null,
});

beforeEach(() => vi.clearAllMocks());

describe("getLessonVideoUrl — input validation", () => {
  const validate = (getLessonVideoUrl as any).__validate as (v: unknown) => unknown;
  it("rejects non-uuid lesson id", () => {
    expect(() => validate({ slug: "abc", lessonId: "not-a-uuid" })).toThrow();
  });
  it("rejects empty slug", () => {
    expect(() => validate({ slug: "", lessonId: VALID_LESSON })).toThrow();
  });
  it("rejects unsafe slug characters", () => {
    expect(() => validate({ slug: "../etc", lessonId: VALID_LESSON })).toThrow();
  });
  it("accepts valid input", () => {
    expect(() => validate({ slug: "good-slug", lessonId: VALID_LESSON })).not.toThrow();
  });
});

describe("getLessonVideoUrl — entitlement matrix", () => {
  const lessonPreviewWithVideo = {
    data: { id: VALID_LESSON, course_id: "c1", is_preview: true, video_storage_path: "c1/v.mp4" },
    error: null,
  };
  const lessonProtectedWithVideo = {
    data: { id: VALID_LESSON, course_id: "c1", is_preview: false, video_storage_path: "c1/v.mp4" },
    error: null,
  };

  it("free enrolled learner on published course receives a signed URL for a protected lesson", async () => {
    const supabase = makeSupabase({
      course: publishedFreeCourse(),
      enrollment: { data: { id: "e1" }, error: null },
      lesson: lessonProtectedWithVideo,
    });
    const res = await call(supabase, { slug: "s", lessonId: VALID_LESSON });
    expect(res.signedUrl).toBe("https://s/x");
    expect(typeof res.expiresAt).toBe("number");
    expect(res.expiresAt).toBeGreaterThan(Date.now());
    // Never leaks storage_path or expiresIn secret.
    expect(Object.keys(res).sort()).toEqual(["expiresAt", "signedUrl"]);
    // Signs from course-videos with 300s TTL.
    expect(supabase._storageCall.bucket).toBe("course-videos");
    expect(supabase._storageCall.ttl).toBe(300);
  });

  it("admin gets full access even on unpublished draft", async () => {
    const supabase = makeSupabase({
      course: draftCourse(),
      isAdmin: { data: true, error: null },
      lesson: lessonProtectedWithVideo,
    });
    const res = await call(supabase, { slug: "s", lessonId: VALID_LESSON });
    expect(res.signedUrl).toBe("https://s/x");
  });

  it("active instructor owner of a draft gets a signed URL", async () => {
    const supabase = makeSupabase({
      course: draftCourse("user-1"),
      isInstructor: { data: true, error: null },
      lesson: lessonProtectedWithVideo,
    });
    const res = await call(supabase, { slug: "s", lessonId: VALID_LESSON });
    expect(res.signedUrl).toBe("https://s/x");
  });

  it("revoked instructor owner (instructor_id matches, role missing) is denied", async () => {
    const supabase = makeSupabase({
      course: draftCourse("user-1"),
      isInstructor: { data: false, error: null },
      lesson: lessonProtectedWithVideo,
    });
    await expect(call(supabase, { slug: "s", lessonId: VALID_LESSON })).rejects.toThrow(
      /Lesson video unavailable/,
    );
  });

  it("authenticated visitor of published course may play a preview lesson", async () => {
    const supabase = makeSupabase({
      course: publishedFreeCourse(),
      lesson: lessonPreviewWithVideo,
    });
    const res = await call(supabase, { slug: "s", lessonId: VALID_LESSON });
    expect(res.signedUrl).toBe("https://s/x");
  });

  it("unenrolled visitor requesting a NON-preview protected lesson is denied", async () => {
    const supabase = makeSupabase({
      course: publishedFreeCourse(),
      lesson: lessonProtectedWithVideo,
    });
    await expect(call(supabase, { slug: "s", lessonId: VALID_LESSON })).rejects.toThrow(
      /Lesson video unavailable/,
    );
  });

  it("paid published course + non-owner/non-admin → protected lesson denied (payments not shipped)", async () => {
    const supabase = makeSupabase({
      course: paidCourse(),
      enrollment: { data: { id: "e1" }, error: null }, // historical paid enrollment
      lesson: lessonProtectedWithVideo,
    });
    await expect(call(supabase, { slug: "s", lessonId: VALID_LESSON })).rejects.toThrow(
      /Lesson video unavailable/,
    );
  });

  it("historical paid enrollment can still play a preview lesson (that is public)", async () => {
    const supabase = makeSupabase({
      course: paidCourse(),
      enrollment: { data: { id: "e1" }, error: null },
      lesson: lessonPreviewWithVideo,
    });
    const res = await call(supabase, { slug: "s", lessonId: VALID_LESSON });
    expect(res.signedUrl).toBe("https://s/x");
  });

  it("draft course + stranger → denied", async () => {
    const supabase = makeSupabase({
      course: draftCourse(),
      lesson: lessonPreviewWithVideo,
    });
    await expect(call(supabase, { slug: "s", lessonId: VALID_LESSON })).rejects.toThrow(
      /Lesson video unavailable/,
    );
  });

  it("course/lesson mismatch (lesson row missing) is denied", async () => {
    const supabase = makeSupabase({
      course: publishedFreeCourse(),
      enrollment: { data: { id: "e1" }, error: null },
      lesson: { data: null, error: null },
    });
    await expect(call(supabase, { slug: "s", lessonId: VALID_LESSON })).rejects.toThrow(
      /Lesson video unavailable/,
    );
  });

  it("lesson without a video_storage_path is denied", async () => {
    const supabase = makeSupabase({
      course: publishedFreeCourse(),
      enrollment: { data: { id: "e1" }, error: null },
      lesson: {
        data: { id: VALID_LESSON, course_id: "c1", is_preview: true, video_storage_path: null },
        error: null,
      },
    });
    await expect(call(supabase, { slug: "s", lessonId: VALID_LESSON })).rejects.toThrow(
      /Lesson video unavailable/,
    );
  });
});

describe("getLessonVideoUrl — fail-closed lookup errors", () => {
  const goodLesson = {
    data: { id: VALID_LESSON, course_id: "c1", is_preview: true, video_storage_path: "c1/v.mp4" },
    error: null,
  };

  it("course lookup error", async () => {
    const supabase = makeSupabase({ course: { data: null, error: { message: "boom" } } });
    await expect(call(supabase, { slug: "s", lessonId: VALID_LESSON })).rejects.toThrow(
      /Lesson video unavailable/,
    );
  });
  it("role check error", async () => {
    const supabase = makeSupabase({
      course: publishedFreeCourse(),
      isAdmin: { data: null, error: { message: "role fail" } },
      lesson: goodLesson,
    });
    await expect(call(supabase, { slug: "s", lessonId: VALID_LESSON })).rejects.toThrow(
      /Lesson video unavailable/,
    );
  });
  it("enrollment lookup error", async () => {
    const supabase = makeSupabase({
      course: publishedFreeCourse(),
      enrollment: { data: null, error: { message: "conn reset" } },
      lesson: goodLesson,
    });
    await expect(call(supabase, { slug: "s", lessonId: VALID_LESSON })).rejects.toThrow(
      /Lesson video unavailable/,
    );
  });
  it("lesson lookup error", async () => {
    const supabase = makeSupabase({
      course: publishedFreeCourse(),
      enrollment: { data: { id: "e1" }, error: null },
      lesson: { data: null, error: { message: "boom" } },
    });
    await expect(call(supabase, { slug: "s", lessonId: VALID_LESSON })).rejects.toThrow(
      /Lesson video unavailable/,
    );
  });
  it("storage sign error", async () => {
    const supabase = makeSupabase({
      course: publishedFreeCourse(),
      enrollment: { data: { id: "e1" }, error: null },
      lesson: goodLesson,
      sign: { data: null, error: { message: "storage down" } },
    });
    await expect(call(supabase, { slug: "s", lessonId: VALID_LESSON })).rejects.toThrow(
      /Lesson video unavailable/,
    );
  });
});

describe("getLessonVideoUrl — leak-shape guardrails", () => {
  it("thrown errors NEVER include storage path, bucket, or supabase details", async () => {
    const supabase = makeSupabase({
      course: publishedFreeCourse(),
      // Unenrolled + protected (non-preview) lesson → denied.
      lesson: {
        data: {
          id: VALID_LESSON,
          course_id: "c1",
          is_preview: false,
          video_storage_path: "c1/secret.mp4",
        },
        error: null,
      },
    });
    try {
      await call(supabase, { slug: "s", lessonId: VALID_LESSON });
      throw new Error("should have thrown");
    } catch (e: any) {
      const msg = String(e?.message ?? "");
      expect(msg).toBe("Lesson video unavailable");
      expect(msg).not.toMatch(/secret\.mp4|course-videos|storage/i);
    }
  });
});