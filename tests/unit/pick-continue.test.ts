import { describe, it, expect } from "vitest";
import { pickContinue, type LearnerEnrollmentDTO } from "@/lib/learner.functions";

function e(
  id: string,
  progress: number,
  last_activity_at: string,
): LearnerEnrollmentDTO {
  return {
    id,
    course_id: `c-${id}`,
    progress,
    last_lesson_id: null,
    last_activity_at,
    course: {
      id: `c-${id}`,
      slug: `s-${id}`,
      title: `T ${id}`,
      subtitle: null,
      category: "cat",
      icon_kind: null,
      duration_label: null,
    },
  };
}

describe("pickContinue", () => {
  it("returns null for empty list", () => {
    expect(pickContinue([])).toBeNull();
  });

  it("prefers in-progress (0 < progress < 100) with most recent activity", () => {
    const rows = [
      e("a", 100, "2026-07-20T00:00:00Z"),
      e("b", 40, "2026-07-19T00:00:00Z"),
      e("c", 0, "2026-07-25T00:00:00Z"),
      e("d", 60, "2026-07-21T00:00:00Z"),
    ];
    const pick = pickContinue(rows);
    expect(pick?.reason).toBe("in_progress");
    expect(pick?.enrollment.id).toBe("d");
  });

  it("falls back to most recent when nothing is in progress", () => {
    const rows = [
      e("a", 100, "2026-07-20T00:00:00Z"),
      e("b", 0, "2026-07-24T00:00:00Z"),
      e("c", 100, "2026-07-23T00:00:00Z"),
    ];
    const pick = pickContinue(rows);
    expect(pick?.reason).toBe("recent");
    expect(pick?.enrollment.id).toBe("b");
  });
});