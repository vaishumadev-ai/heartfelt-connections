import { describe, it, expect } from "vitest";
import { safeNextPath, maskEmail, DEFAULT_NEXT } from "@/lib/auth-redirect";

describe("safeNextPath", () => {
  it("returns fallback for null/empty/root", () => {
    expect(safeNextPath(null)).toBe(DEFAULT_NEXT);
    expect(safeNextPath("")).toBe(DEFAULT_NEXT);
    expect(safeNextPath("/")).toBe(DEFAULT_NEXT);
  });

  it("accepts allowlisted internal paths", () => {
    expect(safeNextPath("/dashboard")).toBe("/dashboard");
    expect(safeNextPath("/learn/foo")).toBe("/learn/foo");
    expect(safeNextPath("/courses/x?y=1")).toBe("/courses/x?y=1");
  });

  it("rejects non-allowlisted internal paths", () => {
    expect(safeNextPath("/secret")).toBe(DEFAULT_NEXT);
    expect(safeNextPath("/api/public/webhook")).toBe(DEFAULT_NEXT);
  });

  it("rejects protocol-relative and absolute URLs", () => {
    expect(safeNextPath("//evil.com/x")).toBe(DEFAULT_NEXT);
    expect(safeNextPath("https://evil.com")).toBe(DEFAULT_NEXT);
    expect(safeNextPath("http://evil.com/dashboard")).toBe(DEFAULT_NEXT);
  });

  it("rejects encoded external URLs", () => {
    expect(safeNextPath("%2F%2Fevil.com")).toBe(DEFAULT_NEXT);
    expect(safeNextPath("%252F%252Fevil.com")).toBe(DEFAULT_NEXT);
    expect(safeNextPath("https%3A%2F%2Fevil.com")).toBe(DEFAULT_NEXT);
  });

  it("rejects malformed / control-char inputs", () => {
    expect(safeNextPath("/dashboard\n")).toBe(DEFAULT_NEXT);
    expect(safeNextPath("/\\evil")).toBe(DEFAULT_NEXT);
    expect(safeNextPath("%E0%A4%A")).toBe(DEFAULT_NEXT);
  });

  it("strips fragments but preserves query", () => {
    expect(safeNextPath("/dashboard#tok=1")).toBe("/dashboard");
    expect(safeNextPath("/browse?q=js")).toBe("/browse?q=js");
  });

  it("uses segment-boundary matching for allowed prefixes", () => {
    // exact match
    expect(safeNextPath("/admin")).toBe("/admin");
    // segment child under allowed prefix
    expect(safeNextPath("/admin/courses")).toBe("/admin/courses");
    expect(safeNextPath("/courses/example")).toBe("/courses/example");
    // lookalike that shares the prefix but not the segment boundary
    expect(safeNextPath("/administrator")).toBe(DEFAULT_NEXT);
    expect(safeNextPath("/administrator/panel")).toBe(DEFAULT_NEXT);
    expect(safeNextPath("/coursesX")).toBe(DEFAULT_NEXT);
  });
});

describe("maskEmail", () => {
  it("masks the local part while preserving domain", () => {
    const m = maskEmail("georgestone@example.com");
    expect(m.endsWith("@example.com")).toBe(true);
    expect(m.startsWith("ge")).toBe(true);
    expect(m).not.toContain("georgestone");
  });
  it("handles short local parts", () => {
    expect(maskEmail("a@x.io")).toMatch(/@x\.io$/);
  });
});
