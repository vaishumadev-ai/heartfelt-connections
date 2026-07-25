import { promises as fs } from "node:fs";
import { isValidFixtureNamespace } from "@/lib/testing/production-guard";
import { isValidUuid } from "./fixtures";

export const STATE_VERSION = 1 as const;

export type FixtureState = {
  stateVersion: typeof STATE_VERSION;
  status: "creating" | "ready";
  testProjectRef: string;
  namespace: string;
  freeSlug: string;
  paidSlug: string;
  freeCourseId: string;
  paidCourseId: string;
  createdAt: string;
  updatedAt: string;
};

/** Pure validator — surface actionable errors instead of a boolean. */
export function validateFixtureState(v: unknown, expectedProjectRef?: string): FixtureState {
  if (!v || typeof v !== "object") throw new Error("state is not an object");
  const s = v as Record<string, unknown>;
  if (s.stateVersion !== STATE_VERSION)
    throw new Error(`unsupported stateVersion '${String(s.stateVersion)}'`);
  if (s.status !== "creating" && s.status !== "ready")
    throw new Error(`invalid status '${String(s.status)}'`);
  if (typeof s.testProjectRef !== "string" || s.testProjectRef.length === 0)
    throw new Error("testProjectRef missing");
  if (expectedProjectRef && s.testProjectRef !== expectedProjectRef) {
    throw new Error(
      `testProjectRef '${s.testProjectRef}' does not match current TEST_SUPABASE_URL ref '${expectedProjectRef}'`,
    );
  }
  if (typeof s.namespace !== "string" || !isValidFixtureNamespace(s.namespace))
    throw new Error(`invalid namespace '${String(s.namespace)}'`);
  if (!isValidUuid(s.freeCourseId)) throw new Error("freeCourseId is not a valid UUID");
  if (!isValidUuid(s.paidCourseId)) throw new Error("paidCourseId is not a valid UUID");
  if (typeof s.freeSlug !== "string" || !s.freeSlug.startsWith(`${s.namespace}-`)) {
    throw new Error(
      `freeSlug '${String(s.freeSlug)}' does not start with namespace '${s.namespace}-'`,
    );
  }
  if (typeof s.paidSlug !== "string" || !s.paidSlug.startsWith(`${s.namespace}-`)) {
    throw new Error(
      `paidSlug '${String(s.paidSlug)}' does not start with namespace '${s.namespace}-'`,
    );
  }
  return s as unknown as FixtureState;
}

/**
 * Read and validate the fixture state file. Returns null iff ENOENT.
 * Every other failure (invalid JSON, schema mismatch, project-ref mismatch,
 * invalid UUID) throws with an actionable message. The caller is expected to
 * refuse to run rather than silently overwrite malformed state.
 */
export async function readFixtureState(
  path: string,
  expectedProjectRef?: string,
): Promise<FixtureState | null> {
  let raw: string;
  try {
    raw = await fs.readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(`could not read state file at ${path}: ${(err as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`state file at ${path} is not valid JSON: ${(err as Error).message}`);
  }
  return validateFixtureState(parsed, expectedProjectRef);
}

/**
 * Atomically write the fixture state to disk. When overwrite=false, refuse to
 * clobber an existing file — the caller is responsible for cleaning stale
 * state via readFixtureState + destroyFixturesByIds first.
 */
export async function writeFixtureStateAtomic(
  path: string,
  state: FixtureState,
  opts: { overwrite: boolean },
): Promise<void> {
  if (!opts.overwrite) {
    try {
      await fs.access(path);
      throw new Error(
        `[fixture-state] refusing to overwrite existing state file at ${path}. Investigate and remove it manually if it is truly stale.`,
      );
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2));
  await fs.rename(tmp, path);
}
