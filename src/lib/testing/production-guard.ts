// Pure, dependency-free guard used by fixture setup, preview launcher, and
// Playwright config. Kept small and side-effect-free so it can be unit-tested
// in Vitest without pulling in the app bundle.

export const PRODUCTION_PROJECT_REF = "snfqvaoclktprpouubie";

export type GuardInput = {
  testSupabaseUrl?: string;
  supabaseUrl?: string;
  viteSupabaseUrl?: string;
  projectId?: string;
  fixtureClientUrl?: string;
  viteProjectId?: string;
};

export type GuardResult = { ok: true; ref: string } | { ok: false; reason: string };

/** Extract the Supabase project ref (subdomain) from a URL, or null. */
export function extractProjectRef(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    // Expected: <ref>.supabase.co
    const parts = u.hostname.split(".");
    if (parts.length >= 3 && parts.slice(-2).join(".") === "supabase.co") {
      return parts[0] || null;
    }
    return null;
  } catch {
    return null;
  }
}

/** Returns true iff any input references the production project ref. */
export function referencesProduction(input: GuardInput): boolean {
  const candidates: (string | undefined)[] = [
    input.testSupabaseUrl,
    input.supabaseUrl,
    input.viteSupabaseUrl,
    input.projectId,
    input.fixtureClientUrl,
    input.viteProjectId,
  ];
  for (const v of candidates) {
    if (!v) continue;
    if (v === PRODUCTION_PROJECT_REF) return true;
    if (v.includes(PRODUCTION_PROJECT_REF)) return true;
  }
  return false;
}

/**
 * Validate that all URL/ref inputs point at a dedicated test Supabase project.
 * Requires TEST_SUPABASE_URL to be present. Rejects the production ref in any
 * slot. Additionally requires every supplied URL/ref to resolve to the SAME
 * project ref as TEST_SUPABASE_URL — a preview or fixture client pointing at
 * a different non-production project is a mismatch and is rejected.
 * Returns a discriminated result — callers decide how to fail.
 */
export function validateTestProject(input: GuardInput): GuardResult {
  if (!input.testSupabaseUrl) {
    return { ok: false, reason: "Missing TEST_SUPABASE_URL." };
  }
  if (referencesProduction(input)) {
    return {
      ok: false,
      reason: `Production Supabase project ref '${PRODUCTION_PROJECT_REF}' detected in test configuration. The E2E suite is only permitted to run against a dedicated test project.`,
    };
  }
  const ref = extractProjectRef(input.testSupabaseUrl);
  if (!ref) {
    return {
      ok: false,
      reason: `TEST_SUPABASE_URL '${input.testSupabaseUrl}' is not a recognizable *.supabase.co URL.`,
    };
  }
  // Every non-empty URL/ref MUST resolve to the same test-project ref.
  const urlSlots: [keyof GuardInput, string | undefined][] = [
    ["supabaseUrl", input.supabaseUrl],
    ["viteSupabaseUrl", input.viteSupabaseUrl],
    ["fixtureClientUrl", input.fixtureClientUrl],
  ];
  for (const [name, value] of urlSlots) {
    if (!value) continue;
    const r = extractProjectRef(value);
    if (!r) {
      return { ok: false, reason: `${name} '${value}' is not a recognizable *.supabase.co URL.` };
    }
    if (r !== ref) {
      return {
        ok: false,
        reason: `${name} project ref '${r}' does not match TEST_SUPABASE_URL ref '${ref}'.`,
      };
    }
  }
  const idSlots: [keyof GuardInput, string | undefined][] = [
    ["projectId", input.projectId],
    ["viteProjectId", input.viteProjectId],
  ];
  for (const [name, value] of idSlots) {
    if (!value) continue;
    if (value !== ref) {
      return {
        ok: false,
        reason: `${name} '${value}' does not match TEST_SUPABASE_URL ref '${ref}'.`,
      };
    }
  }
  return { ok: true, ref };
}

/** Throw-on-failure convenience for imperative call sites. */
export function assertTestProject(input: GuardInput, phase: string): { ref: string } {
  const result = validateTestProject(input);
  if (!result.ok) {
    throw new Error(`[production-guard/${phase}] ${result.reason}`);
  }
  return { ref: result.ref };
}

/**
 * Fixture namespace validator.
 *
 * Namespaces are used in SLUG PREFIX checks during teardown verification.
 * We enforce a strict format so a caller-supplied value can never smuggle
 * SQL LIKE wildcards ('%', '_'), whitespace, path characters, or empty
 * strings into cleanup queries.
 *
 * Format: pw-<lowercase alphanumerics and hyphens>, 4..64 characters total.
 */
const NAMESPACE_RE = /^pw-[a-z0-9-]{1,60}$/;

export function isValidFixtureNamespace(ns: string | undefined | null): ns is string {
  if (typeof ns !== "string") return false;
  if (ns.length === 0) return false;
  return NAMESPACE_RE.test(ns);
}

export function assertValidFixtureNamespace(ns: string | undefined | null, phase: string): string {
  if (!isValidFixtureNamespace(ns)) {
    throw new Error(
      `[production-guard/${phase}] Invalid fixture namespace '${ns ?? ""}'. Must match ${NAMESPACE_RE}.`,
    );
  }
  return ns;
}
