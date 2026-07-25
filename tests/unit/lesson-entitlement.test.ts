import { describe, it, expect } from "vitest";
import { resolveLessonEntitlement } from "@/lib/courses.functions";

/**
 * Phase 1B correction — lesson-entitlement decisions.
 *
 * These pure-logic tests lock in the fail-closed access matrix used by
 * getLessonPlayer. RLS enforces the same rules at the database layer; the
 * enumerated DB-level scenarios are planned/deferred for the Playwright
 * Phase 1B security matrix.
 */
const freePub = { is_published: true, price_cents: 0 };
const paidPub = { is_published: true, price_cents: 4999 };
const draft = { is_published: false, price_cents: 0 };

describe("resolveLessonEntitlement", () => {
  it("owner of a draft gets full access", () => {
    expect(
      resolveLessonEntitlement({ course: draft, isOwner: true, isAdmin: false, enrolled: false }),
    ).toBe("full");
  });

  it("admin gets full access on any course", () => {
    expect(
      resolveLessonEntitlement({ course: paidPub, isOwner: false, isAdmin: true, enrolled: false }),
    ).toBe("full");
    expect(
      resolveLessonEntitlement({ course: draft, isOwner: false, isAdmin: true, enrolled: false }),
    ).toBe("full");
  });

  it("free-course enrolled learner gets full access", () => {
    expect(
      resolveLessonEntitlement({ course: freePub, isOwner: false, isAdmin: false, enrolled: true }),
    ).toBe("full");
  });

  it("historical paid enrollment does NOT grant full access (preview only)", () => {
    expect(
      resolveLessonEntitlement({ course: paidPub, isOwner: false, isAdmin: false, enrolled: true }),
    ).toBe("preview");
  });

  it("unenrolled visitor to a published course gets preview only", () => {
    expect(
      resolveLessonEntitlement({
        course: freePub,
        isOwner: false,
        isAdmin: false,
        enrolled: false,
      }),
    ).toBe("preview");
    expect(
      resolveLessonEntitlement({
        course: paidPub,
        isOwner: false,
        isAdmin: false,
        enrolled: false,
      }),
    ).toBe("preview");
  });

  it("stranger to a draft course gets no access", () => {
    expect(
      resolveLessonEntitlement({ course: draft, isOwner: false, isAdmin: false, enrolled: false }),
    ).toBe("none");
    // Even a paid-enrolled learner on a draft gets none (not published).
    expect(
      resolveLessonEntitlement({ course: draft, isOwner: false, isAdmin: false, enrolled: true }),
    ).toBe("none");
  });
});

/**
 * Deferred database integration tests (not unit-testable in-process; require
 * a live Postgres with the migration applied). Tracked for the parked E2E
 * environment / Phase 1B DB integration matrix:
 *   - complete_lesson rejects paid-course learner progress (SQLSTATE 42501)
 *   - complete_lesson rejects cross-course completion
 *     (lesson.course_id != _course_id)
 *   - complete_lesson caps progress at 100
 *   - getLessonPlayer fails closed when has_role infrastructure errors
 */
