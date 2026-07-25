import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { isCourseEditable, mapCourseGovernanceError } from "@/lib/courses.functions";

describe("isCourseEditable — truth table", () => {
  const cases: Array<[
    { is_published?: boolean | null; review_status?: string | null },
    boolean,
    string,
  ]> = [
    [{ is_published: false, review_status: "draft" }, true, "draft + unpublished"],
    [{ is_published: false, review_status: "rejected" }, true, "rejected + unpublished"],
    [{ is_published: false, review_status: "pending_review" }, false, "pending_review + unpublished"],
    [{ is_published: false, review_status: "approved" }, false, "approved + unpublished (inconsistent)"],
    [{ is_published: true, review_status: "draft" }, false, "draft + published (inconsistent)"],
    [{ is_published: true, review_status: "rejected" }, false, "rejected + published (inconsistent)"],
    [{ is_published: true, review_status: "approved" }, false, "approved + published"],
    [{ is_published: null, review_status: "draft" }, false, "null published"],
    [{ is_published: false, review_status: null }, false, "null status"],
    [{ is_published: false, review_status: "unknown" }, false, "unknown status"],
    [{}, false, "empty"],
  ];
  for (const [input, expected, label] of cases) {
    it(`${label} → ${expected}`, () => {
      expect(isCourseEditable(input)).toBe(expected);
    });
  }
});

describe("mapCourseGovernanceError — stable copy, no raw leakage", () => {
  it("maps auth errors", () => {
    expect(mapCourseGovernanceError(new Error("Not authenticated"))).toMatch(/permission/i);
    expect(mapCourseGovernanceError(new Error("Admin only"))).toMatch(/permission/i);
    expect(mapCourseGovernanceError(new Error("42501: forbidden"))).toMatch(/permission/i);
  });
  it("maps not-found", () => {
    expect(mapCourseGovernanceError(new Error("Course not found"))).toMatch(/not found/i);
  });
  it("maps invalid state", () => {
    expect(mapCourseGovernanceError(new Error("Course not in published/approved state")))
      .toMatch(/not in a state/i);
  });
  it("maps learner-history blocks", () => {
    expect(mapCourseGovernanceError(new Error("Course has learner reviews")))
      .toMatch(/learner history/i);
    expect(mapCourseGovernanceError(new Error("Course has learner enrollments")))
      .toMatch(/learner history/i);
  });
  it("falls back to generic copy — never leaks raw Postgres text", () => {
    const out = mapCourseGovernanceError(new Error('duplicate key value violates unique constraint "reviews_pkey"'));
    expect(out).not.toMatch(/duplicate key/i);
    expect(out).not.toMatch(/pkey/i);
    expect(out).toMatch(/try again/i);
  });
});

describe("migration contract — no current_user bypass in enforcement fns", () => {
  const file = "supabase/migrations/20260726000000_phase2b_qa_closure.sql";
  const sql = fs.existsSync(file)
    ? fs.readFileSync(path.resolve(file), "utf8")
    : (() => {
        // Locate any migration whose body redefines the four enforcement
        // functions and assert the bypass is absent from every body.
        const dir = "supabase/migrations";
        const latest = fs.readdirSync(dir).sort().reverse();
        for (const f of latest) {
          const body = fs.readFileSync(path.join(dir, f), "utf8");
          if (
            body.includes("enforce_course_delete") &&
            body.includes("enforce_lesson_delete") &&
            body.includes("enforce_course_content_lock") &&
            body.includes("enforce_lesson_content_lock")
          ) {
            return body;
          }
        }
        throw new Error("no phase-2b closure migration located");
      })();

  const fns = [
    "enforce_course_delete",
    "enforce_lesson_delete",
    "enforce_course_content_lock",
    "enforce_lesson_content_lock",
  ] as const;

  for (const fn of fns) {
    it(`${fn} body contains no current_user IN (...) early return`, () => {
      const re = new RegExp(
        `FUNCTION\\s+public\\.${fn}\\s*\\(\\s*\\)[\\s\\S]*?\\$function\\$([\\s\\S]*?)\\$function\\$`,
      );
      const m = sql.match(re);
      expect(m, `${fn} definition not found in migration`).toBeTruthy();
      const body = m![1];
      expect(body.toLowerCase()).not.toMatch(/current_user\s+in\s*\(/);
    });
  }

  it("unpublish_for_edit body checks for learner reviews", () => {
    expect(sql).toMatch(/unpublish_for_edit/);
    // The definition in this migration must reject when reviews exist.
    const re = /FUNCTION\s+public\.unpublish_for_edit[\s\S]*?\$function\$([\s\S]*?)\$function\$/;
    const m = sql.match(re);
    expect(m).toBeTruthy();
    expect(m![1]).toMatch(/reviews/i);
  });

  it("get_admin_course.can_unpublish requires zero reviews", () => {
    const re = /FUNCTION\s+public\.get_admin_course\b[\s\S]*?\$function\$([\s\S]*?)\$function\$/;
    const m = sql.match(re);
    expect(m).toBeTruthy();
    expect(m![1]).toMatch(/public\.reviews/);
  });
});
