import { describe, expect, it } from "vitest";
import {
  PRODUCTION_PROJECT_REF,
  assertTestProject,
  extractProjectRef,
  referencesProduction,
  validateTestProject,
  isValidFixtureNamespace,
  assertValidFixtureNamespace,
} from "@/lib/testing/production-guard";

const TEST_URL = "https://test-abcdef.supabase.co";
const OTHER_TEST_URL = "https://other-testref.supabase.co";
const PROD_URL = `https://${PRODUCTION_PROJECT_REF}.supabase.co`;

describe("production-guard", () => {
  describe("extractProjectRef", () => {
    it("extracts ref from *.supabase.co URLs", () => {
      expect(extractProjectRef(TEST_URL)).toBe("test-abcdef");
      expect(extractProjectRef(PROD_URL)).toBe(PRODUCTION_PROJECT_REF);
    });
    it("returns null for non-supabase or malformed URLs", () => {
      expect(extractProjectRef(undefined)).toBeNull();
      expect(extractProjectRef("")).toBeNull();
      expect(extractProjectRef("not-a-url")).toBeNull();
      expect(extractProjectRef("https://example.com")).toBeNull();
    });
  });

  describe("referencesProduction", () => {
    it("returns true when any slot contains the production ref", () => {
      expect(referencesProduction({ testSupabaseUrl: PROD_URL })).toBe(true);
      expect(referencesProduction({ supabaseUrl: PROD_URL })).toBe(true);
      expect(referencesProduction({ viteSupabaseUrl: PROD_URL })).toBe(true);
      expect(referencesProduction({ projectId: PRODUCTION_PROJECT_REF })).toBe(true);
      expect(referencesProduction({ fixtureClientUrl: PROD_URL })).toBe(true);
    });
    it("returns false for dedicated test inputs", () => {
      expect(
        referencesProduction({
          testSupabaseUrl: TEST_URL,
          supabaseUrl: TEST_URL,
          viteSupabaseUrl: TEST_URL,
          projectId: "test-abcdef",
          fixtureClientUrl: TEST_URL,
        }),
      ).toBe(false);
    });
  });

  describe("validateTestProject", () => {
    it("accepts a dedicated test project", () => {
      const r = validateTestProject({
        testSupabaseUrl: TEST_URL,
        supabaseUrl: TEST_URL,
        viteSupabaseUrl: TEST_URL,
        projectId: "test-abcdef",
      });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.ref).toBe("test-abcdef");
    });
    it("rejects preview URL pointing at a different non-production project", () => {
      const r = validateTestProject({ testSupabaseUrl: TEST_URL, supabaseUrl: OTHER_TEST_URL });
      expect(r.ok).toBe(false);
    });
    it("rejects fixture client pointing at a different test project", () => {
      const r = validateTestProject({ testSupabaseUrl: TEST_URL, fixtureClientUrl: OTHER_TEST_URL });
      expect(r.ok).toBe(false);
    });
    it("rejects projectId that does not match the test URL ref", () => {
      const r = validateTestProject({ testSupabaseUrl: TEST_URL, projectId: "some-other" });
      expect(r.ok).toBe(false);
    });
    it("rejects invalid supabase URL in supabaseUrl slot", () => {
      const r = validateTestProject({ testSupabaseUrl: TEST_URL, supabaseUrl: "https://example.com" });
      expect(r.ok).toBe(false);
    });
    it("rejects the production URL in TEST_SUPABASE_URL", () => {
      const r = validateTestProject({ testSupabaseUrl: PROD_URL });
      expect(r.ok).toBe(false);
    });
    it("rejects the production URL when passed to the preview server", () => {
      const r = validateTestProject({ testSupabaseUrl: TEST_URL, supabaseUrl: PROD_URL });
      expect(r.ok).toBe(false);
    });
    it("rejects the production URL when passed as VITE_SUPABASE_URL", () => {
      const r = validateTestProject({ testSupabaseUrl: TEST_URL, viteSupabaseUrl: PROD_URL });
      expect(r.ok).toBe(false);
    });
    it("rejects the production ref as project ID", () => {
      const r = validateTestProject({
        testSupabaseUrl: TEST_URL,
        projectId: PRODUCTION_PROJECT_REF,
      });
      expect(r.ok).toBe(false);
    });
    it("rejects a production fixture client URL", () => {
      const r = validateTestProject({ testSupabaseUrl: TEST_URL, fixtureClientUrl: PROD_URL });
      expect(r.ok).toBe(false);
    });
    it("rejects when TEST_SUPABASE_URL is missing", () => {
      const r = validateTestProject({});
      expect(r.ok).toBe(false);
    });
  });

  describe("assertTestProject", () => {
    it("throws with a phase-tagged message when invalid", () => {
      expect(() => assertTestProject({ testSupabaseUrl: PROD_URL }, "build")).toThrow(
        /\[production-guard\/build\]/,
      );
    });
    it("returns ref when valid", () => {
      expect(assertTestProject({ testSupabaseUrl: TEST_URL }, "preview").ref).toBe("test-abcdef");
    });
  });

  describe("fixture namespace validator", () => {
    it("accepts a valid generated namespace", () => {
      expect(isValidFixtureNamespace("pw-20260725abcd-1a2b")).toBe(true);
      expect(isValidFixtureNamespace("pw-abcd")).toBe(true);
    });
    it("rejects empty and undefined", () => {
      expect(isValidFixtureNamespace("")).toBe(false);
      expect(isValidFixtureNamespace(undefined)).toBe(false);
      expect(isValidFixtureNamespace(null)).toBe(false);
    });
    it("rejects LIKE wildcards", () => {
      expect(isValidFixtureNamespace("pw-%")).toBe(false);
      expect(isValidFixtureNamespace("pw-abc%def")).toBe(false);
      expect(isValidFixtureNamespace("pw-abc_def")).toBe(false);
    });
    it("rejects whitespace, path characters and uppercase", () => {
      expect(isValidFixtureNamespace("pw- abc")).toBe(false);
      expect(isValidFixtureNamespace("pw-a/b")).toBe(false);
      expect(isValidFixtureNamespace("pw-a\\b")).toBe(false);
      expect(isValidFixtureNamespace("pw-ABC")).toBe(false);
    });
    it("rejects missing pw- prefix (category-wide value)", () => {
      expect(isValidFixtureNamespace("fixtures")).toBe(false);
      expect(isValidFixtureNamespace("all")).toBe(false);
    });
    it("assertValidFixtureNamespace throws phase-tagged", () => {
      expect(() => assertValidFixtureNamespace("pw-%", "teardown")).toThrow(
        /\[production-guard\/teardown\]/,
      );
    });
  });
});
