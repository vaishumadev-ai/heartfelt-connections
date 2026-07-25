import { promises as fs } from "node:fs";
import path from "node:path";
import { destroyFixturesByIds } from "./fixtures";
import { assertValidFixtureNamespace } from "@/lib/testing/production-guard";

const FIXTURE_STATE_PATH = path.resolve(process.cwd(), ".e2e-fixture-state.json");

export default async function globalTeardown(): Promise<void> {
  let state: {
    namespace: string;
    freeSlug: string;
    paidSlug: string;
    freeCourseId: string;
    paidCourseId: string;
  } | null = null;
  try {
    const raw = await fs.readFile(FIXTURE_STATE_PATH, "utf8");
    state = JSON.parse(raw);
  } catch {
    // no state file — nothing to clean up
  }
  if (!state || !state.namespace || !state.freeCourseId || !state.paidCourseId) {
    console.log("[e2e/global-teardown] No fixture namespace found; skipping cleanup.");
    return;
  }
  const namespace = assertValidFixtureNamespace(state.namespace, "globalTeardown");
  const { deletedCourses } = await destroyFixturesByIds({
    namespace,
    courseIds: [state.freeCourseId, state.paidCourseId],
    expectedSlugs: [state.freeSlug, state.paidSlug],
  });

  console.log(`[e2e/global-teardown] Cleaned up namespace=${namespace} courses=${deletedCourses}`);
  // Only remove the state file after verified cleanup succeeds.
  await fs.rm(FIXTURE_STATE_PATH, { force: true });
}
