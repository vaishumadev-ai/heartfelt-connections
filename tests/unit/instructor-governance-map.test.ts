import { describe, it, expect } from "vitest";
import { mapInstructorGovernanceError } from "@/lib/courses.functions";

describe("mapInstructorGovernanceError", () => {
  const cases: Array<{ input: unknown; expected: string; label: string }> = [
    {
      label: "unauthenticated",
      input: new Error("Not authenticated"),
      expected: "Please sign in and try again.",
    },
    {
      label: "admin required",
      input: new Error("Admin only"),
      expected: "You don't have permission to perform this action.",
    },
    {
      label: "forbidden 42501",
      input: new Error("permission denied 42501"),
      expected: "You don't have permission to perform this action.",
    },
    {
      label: "missing application",
      input: new Error("Application not found"),
      expected: "This application could not be found.",
    },
    {
      label: "not pending",
      input: new Error("Application not pending"),
      expected: "This application is no longer pending.",
    },
    {
      label: "reason required",
      input: new Error("Reason required"),
      expected: "A reason is required.",
    },
    {
      label: "unknown",
      input: new Error("boom"),
      expected: "Something went wrong. Please try again in a moment.",
    },
    {
      label: "non-error",
      input: "some string",
      expected: "Something went wrong. Please try again in a moment.",
    },
  ];

  for (const c of cases) {
    it(`maps ${c.label}`, () => {
      expect(mapInstructorGovernanceError(c.input)).toBe(c.expected);
    });
  }

  it("never returns raw SQLSTATE, function, or policy names", () => {
    const raw = new Error(
      "42501: permission denied for function public.approve_instructor_application; policy 'Admins only'",
    );
    const out = mapInstructorGovernanceError(raw);
    expect(out).not.toMatch(/42501/);
    expect(out).not.toMatch(/public\./);
    expect(out).not.toMatch(/policy/i);
    expect(out).not.toMatch(/approve_instructor_application/);
  });
});
