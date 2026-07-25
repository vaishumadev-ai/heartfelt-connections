import { promises as fs } from "node:fs";
import path from "node:path";
import { destroyFixtures } from "./fixtures";

const FIXTURE_STATE_PATH = path.resolve(process.cwd(), ".e2e-fixture-state.json");

export default async function globalTeardown(): Promise<void> {
  let namespace = process.env.PW_FIXTURE_NAMESPACE || "";
  try {
    const raw = await fs.readFile(FIXTURE_STATE_PATH, "utf8");
    const parsed = JSON.parse(raw) as { namespace?: string };
    if (parsed.namespace) namespace = parsed.namespace;
  } catch {
    // no state file — nothing to clean up
  }
  if (!namespace) {
    console.log("[e2e/global-teardown] No fixture namespace found; skipping cleanup.");
    return;
  }
  const { deletedCourses } = await destroyFixtures(namespace);

  console.log(`[e2e/global-teardown] Cleaned up namespace=${namespace} courses=${deletedCourses}`);
  await fs.rm(FIXTURE_STATE_PATH, { force: true });
}
