/* @vitest-environment jsdom */
import { describe, it, expect, vi } from "vitest";

// The redirect route uses createFileRoute(...)({ beforeLoad: () => throw redirect(...) }).
// We verify the redirect target by capturing what `redirect()` returned and re-thrown.

const redirectSpy = vi.fn((opts: unknown) => ({ __redirect: opts }));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: { beforeLoad: () => unknown }) => config,
  redirect: (opts: unknown) => redirectSpy(opts),
}));

describe("Redirect route /courses/", () => {
  it("throws a redirect to /browse", async () => {
    const mod = await import("@/routes/courses.index");
    const route = mod.Route as unknown as { beforeLoad: () => unknown };
    expect(() => route.beforeLoad()).toThrow();
    expect(redirectSpy).toHaveBeenCalledWith({ to: "/browse" });
  });
});