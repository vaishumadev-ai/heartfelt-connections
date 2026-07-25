import { describe, it, expect } from "vitest";
import { assertFreePublishedCourse } from "@/lib/courses.functions";

/**
 * Phase 1B — pre-write enrollment guard.
 *
 * The full RLS-level enforcement (direct paid INSERT rejected by policy,
 * unpublished INSERT rejected, admin bypass allowed, etc.) is enumerated
 * in tests/e2e; execution is deferred until a dedicated test project is
 * provisioned. These pure-logic tests lock in the server-fn's fail-closed
 * behavior so no code path can silently create an enrollment for a paid
 * or unpublished course.
 */
describe("assertFreePublishedCourse", () => {
  it("rejects a missing course", () => {
    expect(() => assertFreePublishedCourse(null)).toThrow(/not available/i);
  });
  it("rejects an unpublished course", () => {
    expect(() => assertFreePublishedCourse({ is_published: false, price_cents: 0 })).toThrow(/not available/i);
  });
  it("rejects a paid course with a clear checkout message", () => {
    expect(() => assertFreePublishedCourse({ is_published: true, price_cents: 1999 })).toThrow(/Checkout is not available/i);
  });
  it("allows a free published course", () => {
    expect(() => assertFreePublishedCourse({ is_published: true, price_cents: 0 })).not.toThrow();
  });
});