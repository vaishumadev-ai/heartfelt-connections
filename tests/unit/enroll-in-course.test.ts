import { describe, it, expect, vi } from "vitest";
import { enrollInCourse } from "@/lib/courses.functions";

/**
 * Phase 1B — enrollInCourse authorization unit tests.
 *
 * These call the server-fn handler directly through its exposed
 * `.__executeServer` shape (TanStack Start test surface) with a mocked
 * `context.supabase` so we can assert the pre-write validation rejects
 * paid and unpublished courses BEFORE any insert.
 *
 * The full RLS-level enforcement (direct paid INSERT rejected at the DB)
 * is enumerated in tests/e2e; execution is deferred until a test project
 * is provisioned.
 */

type CourseRow = { id: string; is_published: boolean; price_cents: number };

function makeCtx(course: CourseRow | null) {
  const insert = vi.fn().mockResolvedValue({ error: null });
  const supabase = {
    from: vi.fn((table: string) => {
      if (table === "courses") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: course, error: null }),
            }),
          }),
        };
      }
      if (table === "enrollments") {
        return { insert };
      }
      throw new Error("unexpected table " + table);
    }),
  };
  return { supabase, insert };
}

// Reach the raw handler bound by createServerFn's builder.
const runHandler = async (data: { courseId: string }, ctx: ReturnType<typeof makeCtx>) => {
  // The builder exposes internals under different names across versions;
  // fall back gracefully.
  const fn = enrollInCourse as unknown as {
    __executeServer?: (opts: { data: unknown; context: unknown }) => Promise<unknown>;
    options?: { fn?: (o: unknown) => Promise<unknown> };
  };
  if (fn.options?.fn) {
    return await fn.options.fn({ data, context: { supabase: ctx.supabase, userId: "u1" } });
  }
  if (fn.__executeServer) {
    return await fn.__executeServer({ data, context: { supabase: ctx.supabase, userId: "u1" } });
  }
  throw new Error("Cannot access server fn handler; test surface changed");
};

describe("enrollInCourse authorization", () => {
  it("rejects paid course with clear message and does NOT insert", async () => {
    const ctx = makeCtx({ id: "c1", is_published: true, price_cents: 1999 });
    await expect(runHandler({ courseId: "c1" }, ctx)).rejects.toThrow(/Checkout is not available/i);
    expect(ctx.insert).not.toHaveBeenCalled();
  });

  it("rejects unpublished course and does NOT insert", async () => {
    const ctx = makeCtx({ id: "c1", is_published: false, price_cents: 0 });
    await expect(runHandler({ courseId: "c1" }, ctx)).rejects.toThrow(/not available/i);
    expect(ctx.insert).not.toHaveBeenCalled();
  });

  it("rejects missing course and does NOT insert", async () => {
    const ctx = makeCtx(null);
    await expect(runHandler({ courseId: "c1" }, ctx)).rejects.toThrow(/not available/i);
    expect(ctx.insert).not.toHaveBeenCalled();
  });

  it("allows free published course and inserts once", async () => {
    const ctx = makeCtx({ id: "c1", is_published: true, price_cents: 0 });
    await expect(runHandler({ courseId: "c1" }, ctx)).resolves.toEqual({ ok: true });
    expect(ctx.insert).toHaveBeenCalledTimes(1);
  });
});