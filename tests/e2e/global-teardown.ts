import { promises as fs } from "node:fs";
import path from "node:path";
import { destroyFixturesByIds } from "./fixtures";
import { assertTestProject, assertValidFixtureNamespace } from "@/lib/testing/production-guard";
import { readFixtureState } from "./fixture-state";

const FIXTURE_STATE_PATH = path.resolve(process.cwd(), ".e2e-fixture-state.json");

export default async function globalTeardown(): Promise<void> {
  // Only ENOENT means "nothing to clean up". Anything else — invalid JSON,
  // missing fields, wrong stateVersion, invalid namespace/UUIDs, project-ref
  // mismatch — is a hard failure. We refuse to guess intent from a broken
  // state file.
  const { ref } = assertTestProject(
    {
      testSupabaseUrl: process.env.TEST_SUPABASE_URL,
      supabaseUrl: process.env.SUPABASE_URL,
      viteSupabaseUrl: process.env.VITE_SUPABASE_URL,
      projectId: process.env.SUPABASE_PROJECT_ID,
      viteProjectId: process.env.VITE_SUPABASE_PROJECT_ID,
    },
    "globalTeardown",
  );
  const state = await readFixtureState(FIXTURE_STATE_PATH, ref);
  if (!state) {
    console.log("[e2e/global-teardown] No fixture state file found; skipping cleanup.");
    return;
  }
  const namespace = assertValidFixtureNamespace(state.namespace, "globalTeardown");
  const { deletedCourses } = await destroyFixturesByIds({
    namespace,
    courseIds: [state.freeCourseId, state.paidCourseId],
    expectedSlugs: [state.freeSlug, state.paidSlug],
  });

  console.log(`[e2e/global-teardown] Cleaned up namespace=${namespace} courses=${deletedCourses}`);
  // Only remove the state file after destroyFixturesByIds ran its post-delete
  // verification and returned successfully.
  await fs.rm(FIXTURE_STATE_PATH, { force: true });
}
