import { describe, it, expect } from "vitest";
import {
  normalizeReadinessBlockers,
  normalizeReadinessResult,
  groupReadinessBlockers,
  knownReadinessCodes,
  READINESS_GROUPS,
} from "@/lib/course-readiness";

// The exhaustive list of codes emitted by evaluate_course_readiness in the
// P0C.1 corrections migration. Keep in lockstep with the migration source.
const SERVER_CODES = [
  "title_too_short",
  "slug_invalid",
  "subtitle_too_short",
  "description_too_short",
  "category_missing",
  "level_missing",
  "language_missing",
  "duration_missing",
  "cover_missing",
  "cover_object_missing",
  "instructor_name_missing",
  "instructor_title_missing",
  "instructor_bio_too_short",
  "learning_outcomes_insufficient",
  "skills_missing",
  "requirements_missing",
  "audience_missing",
  "not_free",
  "certificate_unavailable",
  "no_lessons",
  "lesson_module_missing",
  "lesson_position_invalid",
  "lesson_content_thin",
  "lesson_video_object_missing",
  "duplicate_lesson_position",
  "no_preview_lesson",
];

describe("course-readiness mapper", () => {
  it("maps every P0C.1 server blocker code to curated copy and a group", () => {
    const mapped = knownReadinessCodes();
    for (const code of SERVER_CODES) {
      expect(mapped, `mapper is missing ${code}`).toContain(code);
    }
    for (const code of SERVER_CODES) {
      const [b] = normalizeReadinessBlockers([{ code }]);
      expect(b.known).toBe(true);
      expect(b.message).toBeTruthy();
      expect(READINESS_GROUPS).toContain(b.group);
      expect(b.target).toMatch(/^(field-|section-)/);
    }
  });

  it("preserves lesson_id for lesson-scoped blockers", () => {
    const [b] = normalizeReadinessBlockers([
      { code: "lesson_module_missing", lesson_id: "abc" },
    ]);
    expect(b.lesson_id).toBe("abc");
  });

  it("blank / non-string lesson_id normalises to null", () => {
    const rows = normalizeReadinessBlockers([
      { code: "lesson_module_missing", lesson_id: "   " },
      { code: "lesson_content_thin", lesson_id: 42 },
    ]);
    expect(rows.map((r) => r.lesson_id)).toEqual([null, null]);
  });

  it("unknown codes remain blocking with neutral copy", () => {
    const [b] = normalizeReadinessBlockers([{ code: "someone_added_a_new_rule" }]);
    expect(b.known).toBe(false);
    expect(b.message.toLowerCase()).toContain("not ready");
    expect(b.group).toBe("basics");
  });

  it("rejects malformed payloads fail-closed", () => {
    expect(normalizeReadinessBlockers(null)).toEqual([]);
    expect(normalizeReadinessBlockers("nope")).toEqual([]);
    expect(normalizeReadinessBlockers(["not-an-object"])).toEqual([]);
    expect(normalizeReadinessBlockers([{}])).toEqual([]);
    expect(normalizeReadinessBlockers([{ code: "" }])).toEqual([]);
    expect(normalizeReadinessBlockers([{ code: 12 }])).toEqual([]);
  });

  it("normalizeReadinessResult fails closed on malformed row", () => {
    const r = normalizeReadinessResult(null);
    expect(r.is_ready).toBe(false);
    expect(r.blockers.length).toBe(1);
    expect(r.blockers[0].known).toBe(false);
  });

  it("normalizeReadinessResult accepts TABLE-shaped arrays", () => {
    const r = normalizeReadinessResult([{ is_ready: true, blockers: [] }]);
    expect(r.is_ready).toBe(true);
    expect(r.blockers).toEqual([]);
  });

  it("is_ready is only true with no blockers", () => {
    const r = normalizeReadinessResult({
      is_ready: true,
      blockers: [{ code: "title_too_short" }],
    });
    expect(r.is_ready).toBe(false);
  });

  it("groups blockers into canonical order", () => {
    const grouped = groupReadinessBlockers(
      normalizeReadinessBlockers([
        { code: "not_free" },
        { code: "title_too_short" },
        { code: "no_lessons" },
      ]),
    );
    expect(grouped.map((g) => g.group)).toEqual(["basics", "curriculum", "pricing"]);
  });

  it("never surfaces raw detail strings", () => {
    const [b] = normalizeReadinessBlockers([
      { code: "title_too_short", detail: "column 'title' has length 3" },
    ]);
    expect(b.message).not.toContain("column");
  });
});