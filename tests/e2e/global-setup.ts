import { promises as fs } from "node:fs";
import path from "node:path";
import type { FullConfig } from "@playwright/test";
import { assertTestProject, assertValidFixtureNamespace } from "@/lib/testing/production-guard";
import { createFixtures, destroyFixturesByIds, isValidUuid } from "./fixtures";
import {
  readFixtureState,
  writeFixtureStateAtomic,
  STATE_VERSION,
  type FixtureState,
} from "./fixture-state";

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
      viteProjectId: process.env.VITE_SUPABASE_PROJECT_ID,
    },
    "globalSetup",
  );

  console.log(`[e2e/global-setup] Using dedicated test project ref: ${ref}`);

  // 1. If a stale state file exists, we require it to be structurally valid
  //    AND scoped to the currently-configured test project. Valid stale state
  //    is cleaned up (exact-ID delete + verify) before we start a new run.
  //    Malformed stale state stops the run — we refuse to overwrite it.
  const existing = await readFixtureState(FIXTURE_STATE_PATH, ref).catch((err: Error) => {
    throw new Error(
      `[e2e/global-setup] refusing to start with malformed state file: ${err.message}`,
    );
  });
  if (existing) {
    console.log(
      `[e2e/global-setup] Cleaning up stale fixture state (namespace=${existing.namespace}).`,
    );
    await destroyFixturesByIds({
      namespace: existing.namespace,
      courseIds: [existing.freeCourseId, existing.paidCourseId],
      expectedSlugs: [existing.freeSlug, existing.paidSlug],
    });
    await fs.rm(FIXTURE_STATE_PATH, { force: true });
  }

  // 2. Predetermine namespace, slugs, and UUIDs BEFORE any DB write so a
  //    partial-failure cleanup only ever targets these exact ids.
  const rawNs = process.env.PW_FIXTURE_NAMESPACE || `pw-${Date.now().toString(36)}`;
  const namespace = assertValidFixtureNamespace(rawNs, "globalSetup");
  process.env.PW_FIXTURE_NAMESPACE = namespace;
  const freeCourseId = crypto.randomUUID();
  const paidCourseId = crypto.randomUUID();
  const freeSlug = `${namespace}-free`;
  const paidSlug = `${namespace}-paid`;
  if (!isValidUuid(freeCourseId) || !isValidUuid(paidCourseId)) {
    throw new Error("[e2e/global-setup] crypto.randomUUID() produced an invalid UUID.");
  }

  // 3. Atomically publish a "creating" state before the first insert.
  const now = new Date().toISOString();
  const creating: FixtureState = {
    stateVersion: STATE_VERSION,
    status: "creating",
    testProjectRef: ref,
    namespace,
    freeSlug,
    paidSlug,
    freeCourseId,
    paidCourseId,
    createdAt: now,
    updatedAt: now,
  };
  await writeFixtureStateAtomic(FIXTURE_STATE_PATH, creating, { overwrite: false });

  // 4. Seed fixtures with the predetermined ids. On any failure, run exact-ID
  //    cleanup + verify and preserve the "creating" state so the operator can
  //    inspect it. Only after cleanup verifies do we remove the state file.
  try {
    await createFixtures({
      namespace,
      freeCourseId,
      paidCourseId,
      freeSlug,
      paidSlug,
    });
  } catch (err) {
    try {
      await destroyFixturesByIds({
        namespace,
        courseIds: [freeCourseId, paidCourseId],
        expectedSlugs: [freeSlug, paidSlug],
      });
      await fs.rm(FIXTURE_STATE_PATH, { force: true });
    } catch (cleanupErr) {
      const cause = (cleanupErr as Error).message;
      throw new Error(
        `[e2e/global-setup] fixture creation failed and cleanup also failed; state file preserved for inspection. cause: ${cause}. original: ${(err as Error).message}`,
      );
    }
    throw err;
  }

  // 5. Atomically transition state to "ready".
  const ready: FixtureState = { ...creating, status: "ready", updatedAt: new Date().toISOString() };
  await writeFixtureStateAtomic(FIXTURE_STATE_PATH, ready, { overwrite: true });

  process.env.PW_KNOWN_SLUG = freeSlug;
  process.env.PW_PAID_SLUG = paidSlug;

  console.log(
    `[e2e/global-setup] Seeded fixtures: namespace=${namespace} free=${freeSlug} paid=${paidSlug}`,
  );
}
