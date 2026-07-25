import { promises as fs } from "node:fs";
import path from "node:path";
import type { FullConfig } from "@playwright/test";
import { assertTestProject } from "@/lib/testing/production-guard";
import { createFixtures } from "./fixtures";

export const FIXTURE_STATE_PATH = path.resolve(process.cwd(), ".e2e-fixture-state.json");

/**
 * Deterministic fixture bootstrap for the Playwright E2E suite.
 *
 * Contract:
 *   - Runs only against a dedicated test Supabase project.
 *   - Verifies the production ref never appears in any env slot.
 *   - Seeds one free + one paid published course with modules, lessons
 *     (both preview and protected), outcomes, skills, FAQ, instructor,
 *     and related-course data (both fixture courses share category).
 *   - Writes the created slugs to a state file so workers can read them
 *     without inheriting service-role env.
 *   - Fails hard on any error. No silent skipping.
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
      `E2E fixture configuration is incomplete. Missing: ${missing.join(", ")}. ` +
        "Provide a DEDICATED test Supabase project.",
    );
  }

  const { ref } = assertTestProject(
    {
      testSupabaseUrl: testUrl,
      supabaseUrl: process.env.SUPABASE_URL,
      viteSupabaseUrl: process.env.VITE_SUPABASE_URL,
      projectId: process.env.SUPABASE_PROJECT_ID,
    },
    "globalSetup",
  );
  // eslint-disable-next-line no-console
  console.log(`[e2e/global-setup] Using dedicated test project ref: ${ref}`);

  const namespace = process.env.PW_FIXTURE_NAMESPACE || `pw-${Date.now().toString(36)}`;
  process.env.PW_FIXTURE_NAMESPACE = namespace;

  const created = await createFixtures();

  const state = {
    namespace: created.namespace,
    freeSlug: created.freeSlug,
    paidSlug: created.paidSlug,
    freeCourseId: created.freeCourseId,
    paidCourseId: created.paidCourseId,
    createdAt: new Date().toISOString(),
  };
  await fs.writeFile(FIXTURE_STATE_PATH, JSON.stringify(state, null, 2));

  // Expose slugs to workers without inheriting the service-role key.
  process.env.PW_KNOWN_SLUG = created.freeSlug;
  process.env.PW_PAID_SLUG = created.paidSlug;

  // eslint-disable-next-line no-console
  console.log(
    `[e2e/global-setup] Seeded fixtures: namespace=${created.namespace} free=${created.freeSlug} paid=${created.paidSlug}`,
  );
}
