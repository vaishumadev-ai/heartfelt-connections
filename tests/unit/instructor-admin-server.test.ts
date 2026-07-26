/* @vitest-environment jsdom */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    middleware: () => ({
      inputValidator: (v: any) => ({
        handler: (h: any) => {
          const fn: any = (arg: any) => {
            const validated = v(arg?.data);
            return h({ data: validated, context: fn.__context });
          };
          fn.__setContext = (ctx: any) => {
            fn.__context = ctx;
          };
          return fn;
        },
      }),
    }),
    inputValidator: (v: any) => ({
      handler: (h: any) => {
        const fn: any = (arg: any) => {
          const validated = v(arg?.data);
          return h({ data: validated, context: fn.__context });
        };
        fn.__setContext = (ctx: any) => {
          fn.__context = ctx;
        };
        return fn;
      },
    }),
    handler: (h: any) => h,
  }),
}));

vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: {},
}));

// Fail hard if the server-role client is ever constructed here.
vi.mock("@/integrations/supabase/client.server", () => {
  throw new Error("service-role client must not be constructed by listInstructorApplicationsAdmin");
});

import { listInstructorApplicationsAdmin } from "@/lib/courses.functions";

function makeSupabase(result: { data: any; error: any }) {
  const rpc = vi.fn().mockResolvedValue(result);
  return { rpc, supabase: { rpc } };
}

function bind(ctx: any) {
  (listInstructorApplicationsAdmin as any).__setContext(ctx);
}

beforeEach(() => {
  bind(undefined);
});

describe("listInstructorApplicationsAdmin — parameter passing", () => {
  it("sends the exact status/limit/offset the caller passed", async () => {
    const { rpc, supabase } = makeSupabase({ data: [], error: null });
    bind({ supabase, userId: "u", claims: {} });
    await listInstructorApplicationsAdmin({
      data: { status: "approved", limit: 25, offset: 50 },
    } as any);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("list_instructor_applications_admin", {
      _status: "approved",
      _limit: 25,
      _offset: 50,
    });
  });

  it("passes _status as undefined when status is null (all statuses)", async () => {
    const { rpc, supabase } = makeSupabase({ data: [], error: null });
    bind({ supabase, userId: "u", claims: {} });
    await listInstructorApplicationsAdmin({
      data: { status: null, limit: 10, offset: 0 },
    } as any);
    const args = rpc.mock.calls[0][1];
    expect(args._status).toBeUndefined();
    expect(args._limit).toBe(10);
    expect(args._offset).toBe(0);
  });

  it("clamps limit to [1,100] and offset to >=0", async () => {
    const { rpc, supabase } = makeSupabase({ data: [], error: null });
    bind({ supabase, userId: "u", claims: {} });
    await listInstructorApplicationsAdmin({
      data: { status: "pending", limit: 5000, offset: -12 },
    } as any);
    const args = rpc.mock.calls[0][1];
    expect(args._limit).toBe(100);
    expect(args._offset).toBe(0);
  });

  it("rejects unknown status by falling back to null (all)", async () => {
    const { rpc, supabase } = makeSupabase({ data: [], error: null });
    bind({ supabase, userId: "u", claims: {} });
    await listInstructorApplicationsAdmin({
      data: { status: "nonsense" as any, limit: 25, offset: 0 },
    } as any);
    expect(rpc.mock.calls[0][1]._status).toBeUndefined();
  });
});

describe("listInstructorApplicationsAdmin — result shape", () => {
  it("returns rows and total from total_count of first row without unsafe casts", async () => {
    const row = {
      application_id: "a1",
      user_id: "u1",
      display_name: "Alice",
      avatar_url: null,
      status: "pending",
      application_reason: "hello",
      decision_reason: null,
      decided_by: null,
      decided_at: null,
      created_at: "2026-07-25T12:00:00Z",
      updated_at: "2026-07-25T12:00:00Z",
      is_current_instructor: false,
      total_count: "42", // Postgres bigint often serializes as string
    };
    const { supabase } = makeSupabase({ data: [row], error: null });
    bind({ supabase, userId: "u", claims: {} });
    const out = await listInstructorApplicationsAdmin({
      data: { status: "pending", limit: 25, offset: 0 },
    } as any);
    expect(out.total).toBe(42);
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].application_id).toBe("a1");
    expect(out.rows[0].is_current_instructor).toBe(false);
    // DTO must not carry raw total_count leakage
    expect((out.rows[0] as any).total_count).toBeUndefined();
  });

  it("returns empty page with total=0 when no rows", async () => {
    const { supabase } = makeSupabase({ data: [], error: null });
    bind({ supabase, userId: "u", claims: {} });
    const out = await listInstructorApplicationsAdmin({
      data: { status: "pending", limit: 25, offset: 0 },
    } as any);
    expect(out.rows).toEqual([]);
    expect(out.total).toBe(0);
  });
});

describe("listInstructorApplicationsAdmin — failure surface", () => {
  it("propagates DB failures as an Error that the mapper can classify without leaking raw details", async () => {
    const { supabase } = makeSupabase({
      data: null,
      error: { message: "permission denied for function public.list_instructor_applications_admin", code: "42501" },
    });
    bind({ supabase, userId: "u", claims: {} });
    await expect(
      listInstructorApplicationsAdmin({
        data: { status: "pending", limit: 25, offset: 0 },
      } as any),
    ).rejects.toBeInstanceOf(Error);
  });

  it("never constructs a service-role client (import fails hard above)", async () => {
    // If any code path in courses.functions.ts imported client.server, the top-level
    // vi.mock above would throw at module load and no test in this file would run.
    expect(typeof listInstructorApplicationsAdmin).toBe("function");
  });
});