// Pure environment sanitizer used by scripts/test-preview.ts. Kept dependency-
// free and side-effect-free so it can be unit-tested without spawning any
// child process. Never reads process.env directly.
//
// The sanitizer enforces two invariants before we hand the environment to the
// bundler / preview server:
//   1. No SERVICE_ROLE / SERVICE_KEY value may enter the client bundle. VITE_*
//      variables end up in the browser, so we reject them if either their
//      NAME indicates a service-role role, or their VALUE is equal to one of
//      the known service-role keys.
//   2. TEST_SUPABASE_SERVICE_ROLE_KEY and SUPABASE_SERVICE_ROLE_KEY are
//      stripped from the child env — fixture setup keeps them in the parent
//      (Playwright globalSetup) process only.

export type SanitizerInput = {
  parentEnv: Record<string, string | undefined>;
  overlay: Record<string, string>;
  /** Known service-role key values whose exact string must never appear in a VITE_* slot. */
  serviceRoleValues: string[];
};

export type SanitizerResult =
  | { ok: true; env: Record<string, string> }
  | { ok: false; reason: string };

const SERVICE_ROLE_NAME_RE = /SERVICE[_-]?ROLE|SERVICE[_-]?KEY/i;
const STRIP_KEYS = ["SUPABASE_SERVICE_ROLE_KEY", "TEST_SUPABASE_SERVICE_ROLE_KEY"] as const;

/**
 * Validate and sanitize environment variables destined for the child preview /
 * build process. Returns a discriminated result so callers can decide how to
 * fail (throw, exit, etc.) without this module knowing about process.exit.
 *
 * Rules:
 *   - Reject if any VITE_* variable name matches SERVICE_ROLE or SERVICE_KEY.
 *   - Reject if any VITE_* variable value equals a known service-role key
 *     value (guards against copy-paste mistakes into a VITE_ slot).
 *   - Strip SUPABASE_SERVICE_ROLE_KEY and TEST_SUPABASE_SERVICE_ROLE_KEY.
 *   - Apply the overlay last so callers cannot smuggle service-role values
 *     back in through it — the overlay itself is checked with the same rules.
 *   - Never include the offending value or key material in the reason string.
 */
export function sanitizeChildEnv(input: SanitizerInput): SanitizerResult {
  const merged: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.parentEnv)) {
    if (typeof v === "string") merged[k] = v;
  }
  for (const [k, v] of Object.entries(input.overlay)) merged[k] = v;

  const serviceValues = new Set(
    input.serviceRoleValues.filter((v) => typeof v === "string" && v.length > 0),
  );

  for (const [k, v] of Object.entries(merged)) {
    if (!k.startsWith("VITE_")) continue;
    if (SERVICE_ROLE_NAME_RE.test(k)) {
      return {
        ok: false,
        reason: `VITE_* variable name '${k}' indicates a service-role secret and cannot ship to the browser bundle.`,
      };
    }
    if (typeof v === "string" && serviceValues.has(v)) {
      return {
        ok: false,
        reason: `VITE_* variable '${k}' value equals a known SERVICE_ROLE key. Refusing to bundle service-role material into the browser.`,
      };
    }
  }

  for (const k of STRIP_KEYS) delete merged[k];
  return { ok: true, env: merged };
}

export const __test__ = { SERVICE_ROLE_NAME_RE, STRIP_KEYS };
