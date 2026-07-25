import { describe, it, expect } from "vitest";
import { assertActiveInstructor } from "@/lib/courses.functions";

/**
 * Phase 1C — Studio role assertion (fail-closed).
 *
 * These lock in the client-side guard used by every Studio server fn.
 * Complementary RLS + column revocation + SECURITY DEFINER RPCs enforce
 * the same rules at the database layer; the DB-level matrix is enumerated
 * as deferred integration tests below.
 */

function stub(seq: Array<{ data: unknown; error: { message: string } | null }>) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args });
    return seq.shift() ?? { data: null, error: null };
  };
  return { rpc, calls };
}

describe("assertActiveInstructor", () => {
  it("passes when the caller has the instructor role", async () => {
    const s = stub([{ data: true, error: null }]);
    await expect(assertActiveInstructor(s)).resolves.toBeUndefined();
    expect(s.calls[0]).toEqual({ fn: "current_user_has_role", args: { _role: "instructor" } });
  });

  it("denies an admin who is not also an instructor (Studio is instructor-only)", async () => {
    const s = stub([{ data: false, error: null }]);
    await expect(assertActiveInstructor(s)).rejects.toThrow(/instructor role required/i);
    // Never consults the admin role — Studio gate is strictly instructor.
    expect(s.calls.length).toBe(1);
  });

  it("denies a plain authenticated user", async () => {
    const s = stub([{ data: false, error: null }]);
    await expect(assertActiveInstructor(s)).rejects.toThrow(/instructor role required/i);
  });

  it("fails CLOSED when the instructor role query errors", async () => {
    const s = stub([{ data: null, error: { message: "boom" } }]);
    await expect(assertActiveInstructor(s)).rejects.toThrow(/authorization check failed/i);
  });

  it("does not treat non-boolean truthy values as authorization", async () => {
    // Any non-`true` value must be treated as "no", never coerced.
    const s = stub([{ data: "yes" as unknown as boolean, error: null }]);
    await expect(assertActiveInstructor(s)).rejects.toThrow(/instructor role required/i);
  });
});

/**
 * Deferred DB integration tests (require a live Postgres with Phase 1C
 * migration applied — parked with the Phase 1A E2E gate):
 *   - non-instructor cannot listMyCourses / getMyCourse / createCourse
 *   - revoked instructor loses read/write access to previously owned drafts
 *     and lessons (RLS-level, immediate)
 *   - instructor cannot spoof another instructor's course via instructor_id
 *     (RLS WITH CHECK rejects)
 *   - applyForInstructor is idempotent (second call returns existing pending)
 *   - approveInstructorApplication rejects when status != pending
 *   - approveInstructorApplication is admin-only
 *   - final-admin protection: DELETE / UPDATE of the last admin row throws
 *   - instructor cannot flip is_published (column-level GRANT revoked)
 *   - deleteLesson requires matching lesson_id + course_id in DELETE predicate
 *   - unenrolled user INSERT into reviews rejected by RLS
 *   - free-enrolled learner INSERT into reviews accepted
 *   - historical paid-enrolled learner INSERT into reviews rejected
 *   - submit_review_verified is an atomic upsert (failed replacement
 *     preserves previous row — never delete-first-then-insert)
 *   - audit_events is append-only for authenticated (no INSERT/UPDATE/DELETE)
 */
