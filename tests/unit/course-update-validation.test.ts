import { describe, it, expect } from "vitest";
import {
  normalizeUpdateCoursePayload,
  COURSE_UPDATE_ALLOWED_FIELDS,
  COURSE_UPDATE_FORBIDDEN_FIELDS,
  COURSE_UPDATE_LIMITS,
} from "@/lib/courses.functions";

describe("normalizeUpdateCoursePayload — whitelist", () => {
  it("accepts every allowed field", () => {
    const payload = {
      title: "  Hello  ",
      subtitle: "  short  ",
      description: "a description",
      category: "Development",
      price_cents: 0,
      duration_label: "3h",
      level: "Beginner",
      language: "English",
      learn_outcomes: [" a ", "b"],
      skills: ["ts"],
      requirements: ["html"],
      audience: ["devs"],
      faq: [{ q: "  q ", a: " a  " }],
      instructor_name: "Ana",
      instructor_title: "Engineer",
      instructor_bio: "A short bio",
    };
    const out = normalizeUpdateCoursePayload(payload);
    expect(out.title).toBe("Hello");
    expect(out.learn_outcomes).toEqual(["a", "b"]);
    expect(out.faq).toEqual([{ q: "q", a: "a" }]);
    // Sanity: exactly the whitelisted keys.
    for (const k of Object.keys(out)) {
      expect(COURSE_UPDATE_ALLOWED_FIELDS as readonly string[]).toContain(k);
    }
  });

  it.each(COURSE_UPDATE_FORBIDDEN_FIELDS as readonly string[])(
    "rejects forbidden field %s",
    (field) => {
      expect(() =>
        normalizeUpdateCoursePayload({ [field]: "x" }),
      ).toThrow(new RegExp(`forbidden_field_${field}`));
    },
  );

  it("rejects unknown fields fail-closed", () => {
    expect(() => normalizeUpdateCoursePayload({ arbitraryKey: 1 })).toThrow(/unknown_field/);
  });

  it("rejects malformed payload types", () => {
    expect(() => normalizeUpdateCoursePayload(null)).toThrow(/invalid_payload/);
    expect(() => normalizeUpdateCoursePayload("nope")).toThrow(/invalid_payload/);
  });

  it("price_cents must be a non-negative integer within limit", () => {
    expect(() => normalizeUpdateCoursePayload({ price_cents: -1 })).toThrow(/invalid_price_cents/);
    expect(() => normalizeUpdateCoursePayload({ price_cents: 1.5 })).toThrow(
      /invalid_price_cents/,
    );
    expect(() =>
      normalizeUpdateCoursePayload({ price_cents: COURSE_UPDATE_LIMITS.price_cents.max + 1 }),
    ).toThrow(/invalid_price_cents/);
    expect(normalizeUpdateCoursePayload({ price_cents: 0 }).price_cents).toBe(0);
  });

  it("string arrays reject non-strings and drop empty items", () => {
    expect(normalizeUpdateCoursePayload({ skills: ["a", "", "  b  "] }).skills).toEqual([
      "a",
      "b",
    ]);
    expect(() => normalizeUpdateCoursePayload({ skills: [1 as unknown as string] })).toThrow(
      /invalid_skills_item/,
    );
  });

  it("string arrays enforce count boundary", () => {
    const many = Array.from({ length: COURSE_UPDATE_LIMITS.arrayCount.max + 1 }, (_, i) => `s${i}`);
    expect(() => normalizeUpdateCoursePayload({ skills: many })).toThrow(/too_many_skills/);
  });

  it("faq rejects half-empty pairs", () => {
    expect(() =>
      normalizeUpdateCoursePayload({ faq: [{ q: "only q", a: "" }] }),
    ).toThrow(/invalid_faq_item/);
  });

  it("faq drops fully-empty pairs and preserves order", () => {
    const out = normalizeUpdateCoursePayload({
      faq: [
        { q: "", a: "" },
        { q: "a", a: "b" },
        { q: "c", a: "d" },
      ],
    });
    expect(out.faq).toEqual([
      { q: "a", a: "b" },
      { q: "c", a: "d" },
    ]);
  });

  it("faq enforces question/answer length", () => {
    const longQ = "x".repeat(COURSE_UPDATE_LIMITS.faq.question + 1);
    expect(() => normalizeUpdateCoursePayload({ faq: [{ q: longQ, a: "a" }] })).toThrow(
      /too_long_faq_q/,
    );
  });

  it("title too long fails", () => {
    const t = "x".repeat(COURSE_UPDATE_LIMITS.title.max + 1);
    expect(() => normalizeUpdateCoursePayload({ title: t })).toThrow(/too_long_title/);
  });

  it("nullable string columns accept empty → null", () => {
    const out = normalizeUpdateCoursePayload({ subtitle: "", instructor_bio: "  " });
    expect(out.subtitle).toBeNull();
    expect(out.instructor_bio).toBeNull();
  });
});