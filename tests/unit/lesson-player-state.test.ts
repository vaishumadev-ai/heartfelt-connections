import { describe, it, expect } from "vitest";
import {
  orderLessons,
  selectCurrentLesson,
  neighborIds,
  clampProgress,
  canTrackProgress,
} from "@/lib/lesson-player-state";

const L = (id: string, position: number) => ({ id, position });

describe("orderLessons", () => {
  it("sorts by position, then id as stable tiebreaker", () => {
    const rows = [L("b", 2), L("a", 1), L("c", 2)];
    expect(orderLessons(rows).map((l) => l.id)).toEqual(["a", "b", "c"]);
  });
});

describe("selectCurrentLesson", () => {
  const lessons = [L("a", 1), L("b", 2), L("c", 3), L("d", 4)];

  it("returns empty when no lessons", () => {
    expect(selectCurrentLesson({ lessons: [] }).kind).toBe("empty");
  });

  it("honors explicit requestedLessonId even if complete", () => {
    const r = selectCurrentLesson({
      lessons,
      requestedLessonId: "b",
      completedIds: ["b"],
    });
    expect(r).toMatchObject({ kind: "selected", reason: "explicit" });
    if (r.kind === "selected") expect(r.lesson.id).toBe("b");
  });

  it("returns requested-invalid for unknown id (no silent swap)", () => {
    const r = selectCurrentLesson({ lessons, requestedLessonId: "zzz" });
    expect(r.kind).toBe("requested-invalid");
  });

  it("resumes on lastLessonId when incomplete", () => {
    const r = selectCurrentLesson({ lessons, lastLessonId: "c", completedIds: ["a"] });
    expect(r).toMatchObject({ kind: "selected", reason: "resume-last" });
    if (r.kind === "selected") expect(r.lesson.id).toBe("c");
  });

  it("advances to next incomplete after a completed last lesson", () => {
    const r = selectCurrentLesson({ lessons, lastLessonId: "b", completedIds: ["a", "b"] });
    expect(r).toMatchObject({ kind: "selected", reason: "resume-next-after-last" });
    if (r.kind === "selected") expect(r.lesson.id).toBe("c");
  });

  it("wraps to first incomplete when last is complete and tail is complete", () => {
    const r = selectCurrentLesson({
      lessons,
      lastLessonId: "d",
      completedIds: ["b", "c", "d"],
    });
    expect(r).toMatchObject({ kind: "selected", reason: "first-incomplete" });
    if (r.kind === "selected") expect(r.lesson.id).toBe("a");
  });

  it("all-complete with valid stored last lesson resumes at that last lesson", () => {
    const r = selectCurrentLesson({
      lessons,
      lastLessonId: "c",
      completedIds: ["a", "b", "c", "d"],
    });
    expect(r).toMatchObject({ kind: "selected", reason: "all-complete" });
    if (r.kind === "selected") expect(r.lesson.id).toBe("c");
  });

  it("all-complete with null last lesson lands on the final canonical lesson, never lesson one", () => {
    const r = selectCurrentLesson({
      lessons,
      completedIds: ["a", "b", "c", "d"],
    });
    expect(r).toMatchObject({ kind: "selected", reason: "all-complete" });
    if (r.kind === "selected") expect(r.lesson.id).toBe("d");
  });

  it("all-complete with stale (unknown) last lesson lands on the final canonical lesson", () => {
    const r = selectCurrentLesson({
      lessons,
      lastLessonId: "gone",
      completedIds: ["a", "b", "c", "d"],
    });
    expect(r).toMatchObject({ kind: "selected", reason: "all-complete" });
    if (r.kind === "selected") expect(r.lesson.id).toBe("d");
  });

  it("all-complete with explicit requested lesson still wins", () => {
    const r = selectCurrentLesson({
      lessons,
      requestedLessonId: "b",
      lastLessonId: "d",
      completedIds: ["a", "b", "c", "d"],
    });
    expect(r).toMatchObject({ kind: "selected", reason: "explicit" });
    if (r.kind === "selected") expect(r.lesson.id).toBe("b");
  });

  it("falls back to first incomplete when lastLessonId is stale/unknown", () => {
    const r = selectCurrentLesson({ lessons, lastLessonId: "gone", completedIds: ["a"] });
    expect(r).toMatchObject({ kind: "selected", reason: "first-incomplete" });
    if (r.kind === "selected") expect(r.lesson.id).toBe("b");
  });

  it("picks first incomplete when no lastLessonId", () => {
    const r = selectCurrentLesson({ lessons, completedIds: ["a"] });
    expect(r).toMatchObject({ kind: "selected", reason: "first-incomplete" });
    if (r.kind === "selected") expect(r.lesson.id).toBe("b");
  });
});

describe("neighborIds", () => {
  const lessons = [L("a", 1), L("b", 2), L("c", 3)];
  it("first lesson has no prev", () => {
    expect(neighborIds(lessons, "a")).toEqual({ prevId: null, nextId: "b" });
  });
  it("middle lesson has both", () => {
    expect(neighborIds(lessons, "b")).toEqual({ prevId: "a", nextId: "c" });
  });
  it("last lesson has no next", () => {
    expect(neighborIds(lessons, "c")).toEqual({ prevId: "b", nextId: null });
  });
  it("unknown lesson returns nulls", () => {
    expect(neighborIds(lessons, "zzz")).toEqual({ prevId: null, nextId: null });
  });
});

describe("clampProgress", () => {
  it("rounds and clamps a database value in range", () => {
    expect(clampProgress(42.4)).toBe(42);
    expect(clampProgress(42.6)).toBe(43);
  });
  it("clamps values above 100", () => expect(clampProgress(999)).toBe(100));
  it("clamps negative values to 0", () => expect(clampProgress(-10)).toBe(0));
  it("treats null/undefined/NaN as 0", () => {
    expect(clampProgress(null)).toBe(0);
    expect(clampProgress(undefined)).toBe(0);
    expect(clampProgress(Number.NaN)).toBe(0);
  });
});

describe("canTrackProgress", () => {
  it("true only for free published enrolled full-access viewer", () => {
    expect(
      canTrackProgress({
        entitlement: "full",
        isEnrolled: true,
        priceCents: 0,
        isPublished: true,
      }),
    ).toBe(true);
  });
  it("false for owner/admin inspection (no enrollment)", () => {
    expect(
      canTrackProgress({
        entitlement: "full",
        isEnrolled: false,
        priceCents: 0,
        isPublished: true,
      }),
    ).toBe(false);
  });
  it("false for historical paid enrollment", () => {
    expect(
      canTrackProgress({
        entitlement: "preview",
        isEnrolled: true,
        priceCents: 4999,
        isPublished: true,
      }),
    ).toBe(false);
  });
  it("false for preview viewer", () => {
    expect(
      canTrackProgress({
        entitlement: "preview",
        isEnrolled: false,
        priceCents: 0,
        isPublished: true,
      }),
    ).toBe(false);
  });
});
