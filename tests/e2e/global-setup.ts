import type { FullConfig } from "@playwright/test";

// Hard guard: production Supabase project MUST be rejected.
const PRODUCTION_PROJECT_REF = "snfqvaoclktprpouubie";

/**
 * Deterministic fixture bootstrap for the Playwright E2E suite.
 *
 * Requirements per 1A-tests scope:
 *   - Run against a DEDICATED test Supabase project.
 *   - Never touch the production project (`snfqvaoclktprpouubie`).
 *   - Service-role credential stays server-side (Node global setup) only.
 *   - Never exposed through VITE_* env, page context, or browser storage.
 *   - If required test-project config is missing, FAIL with a clear error.
 *     Do not silently skip critical E2E tests.
 */
export default async function globalSetup(_config: FullConfig): Promise<void> {
  const testUrl = process.env.TEST_SUPABASE_URL;
  const testAnon = process.env.TEST_SUPABASE_PUBLISHABLE_KEY;
  const testService = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;

  const missing = [
    ["TEST_SUPABASE_URL", testUrl],
    ["TEST_SUPABASE_PUBLISHABLE_KEY", testAnon],
    ["TEST_SUPABASE_SERVICE_ROLE_KEY", testService],
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k as string);

  if (missing.length > 0) {
    throw new Error(
      [
        "E2E fixture configuration is incomplete.",
        `Missing required environment variables: ${missing.join(", ")}.`,
        "Provide a DEDICATED test Supabase project. Do NOT use the production project.",
        "Service-role credential must remain in Node global setup only; never expose it via VITE_*, page context, or browser storage.",
      ].join(" "),
    );
  }

  // Hard guard: reject the production project ref regardless of which variable it appears in.
  const forbidden = [testUrl, testAnon, testService, process.env.SUPABASE_URL].filter(
    (v): v is string => typeof v === "string",
  );
  for (const v of forbidden) {
    if (v.includes(PRODUCTION_PROJECT_REF)) {
      throw new Error(
        `E2E fixture guard: production Supabase project ref '${PRODUCTION_PROJECT_REF}' detected. ` +
          "The E2E suite is only permitted to run against a dedicated test project.",
      );
    }
  }

  // A test-namespace prefix so cleanup only touches rows created by this suite.
  process.env.PW_FIXTURE_NAMESPACE = process.env.PW_FIXTURE_NAMESPACE || `pw-${Date.now()}`;

  // NOTE: Fixture seeding (creating fixture courses/lessons under the namespace)
  // is intentionally left as a follow-up. This global setup enforces the
  // config contract and production guard, which is the P0 concern of this phase.
  // Never use a committed production migration for test fixtures.
}
