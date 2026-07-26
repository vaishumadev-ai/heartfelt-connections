import { describe, it, expect } from "vitest";
import { reorderLessonsInputSchema } from "@/lib/courses.functions";

const CID = "11111111-1111-4111-8111-111111111111";
const L1 = "22222222-2222-4222-8222-222222222222";
const L2 = "33333333-3333-4333-8333-333333333333";

describe("reorderLessons strict input schema (RPC never fires when invalid)", () => {
  it("accepts a valid payload with UUIDs and unique ids", () => {
    const r = reorderLessonsInputSchema.safeParse({
      courseId: CID,
      lessonIds: [L1, L2],
    });
    expect(r.success).toBe(true);
  });

  it("rejects non-UUID course id", () => {
    const r = reorderLessonsInputSchema.safeParse({
      courseId: "not-a-uuid",
      lessonIds: [L1],
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toBe("invalid_course_id");
  });

  it("rejects non-UUID lesson ids", () => {
    const r = reorderLessonsInputSchema.safeParse({
      courseId: CID,
      lessonIds: [L1, "nope"],
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toBe("invalid_lesson_id");
  });

  it("rejects empty lesson-id list", () => {
    const r = reorderLessonsInputSchema.safeParse({ courseId: CID, lessonIds: [] });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toBe("lesson_ids_required");
  });

  it("rejects duplicate lesson ids", () => {
    const r = reorderLessonsInputSchema.safeParse({
      courseId: CID,
      lessonIds: [L1, L1],
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toBe("duplicate_lesson_ids");
  });

  it("rejects unknown top-level fields (strict schema)", () => {
    const r = reorderLessonsInputSchema.safeParse({
      courseId: CID,
      lessonIds: [L1],
      injected: "x",
    });
    expect(r.success).toBe(false);
  });

  it("rejects null / string / non-object payloads", () => {
    expect(reorderLessonsInputSchema.safeParse(null).success).toBe(false);
    expect(reorderLessonsInputSchema.safeParse("hi").success).toBe(false);
    expect(reorderLessonsInputSchema.safeParse([]).success).toBe(false);
  });
});
