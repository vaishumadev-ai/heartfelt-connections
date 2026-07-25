#!/usr/bin/env bun
/**
 * Test-only preview launcher.
 *
 * Maps TEST_SUPABASE_* env into SUPABASE_* / VITE_SUPABASE_* so that
 * `bun run build && bun run preview` uses the dedicated test project
 * regardless of what the committed `.env` contains.
 *
 *   - Never maps the service-role key into any VITE_* variable.
 *   - Writes a temporary `.env.local` so Vite's env loader picks up the
 *     test project (Vite loads `.env.local` last, overriding `.env`).
 *   - Restores/removes the `.env.local` on exit.
 *   - Verifies the production project ref is not present before build.
 *   - Prints only the resolved test project ref — never keys.
 */
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { assertTestProject, extractProjectRef } from "../src/lib/testing/production-guard";

const TEST_URL = process.env.TEST_SUPABASE_URL;
const TEST_ANON = process.env.TEST_SUPABASE_PUBLISHABLE_KEY;

if (!TEST_URL || !TEST_ANON) {
  console.error(
    "[test-preview] Missing TEST_SUPABASE_URL or TEST_SUPABASE_PUBLISHABLE_KEY; refusing to start preview.",
  );
  process.exit(2);
}

const ref = extractProjectRef(TEST_URL);
if (!ref) {
  console.error(`[test-preview] TEST_SUPABASE_URL is not a valid *.supabase.co URL.`);
  process.exit(2);
}

try {
  assertTestProject(
    {
      testSupabaseUrl: TEST_URL,
      supabaseUrl: TEST_URL,
      viteSupabaseUrl: TEST_URL,
      projectId: ref,
    },
    "test-preview",
  );
} catch (err) {
  console.error((err as Error).message);
  process.exit(2);
}

console.log(`[test-preview] Resolved test project ref: ${ref}`);
console.log(`[test-preview] Production guard passed. Preview will use the test project.`);

const overlay: Record<string, string> = {
  SUPABASE_URL: TEST_URL,
  SUPABASE_PUBLISHABLE_KEY: TEST_ANON,
  SUPABASE_PROJECT_ID: ref,
  VITE_SUPABASE_URL: TEST_URL,
  VITE_SUPABASE_PUBLISHABLE_KEY: TEST_ANON,
  VITE_SUPABASE_PROJECT_ID: ref,
};

const parentEnv = { ...process.env };
// Strip service-role env from the child; fixture setup runs in the parent
// (Playwright globalSetup), which retains access to it.
delete parentEnv.SUPABASE_SERVICE_ROLE_KEY;
delete parentEnv.TEST_SUPABASE_SERVICE_ROLE_KEY;
const childEnv = { ...parentEnv, ...overlay };

const cwd = process.cwd();
const envLocalPath = path.join(cwd, ".env.local");
const envLocalBackup = path.join(cwd, ".env.local.pw-backup");

let hadPrior = false;
try {
  await fs.access(envLocalPath);
  hadPrior = true;
  await fs.rename(envLocalPath, envLocalBackup);
} catch {
  hadPrior = false;
}

const envLocalBody =
  Object.entries(overlay)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n") + "\n";
await fs.writeFile(envLocalPath, envLocalBody, "utf8");

let cleanedUp = false;
async function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  await fs.rm(envLocalPath, { force: true });
  if (hadPrior) {
    try {
      await fs.rename(envLocalBackup, envLocalPath);
    } catch {
      // ignore
    }
  }
}

const host = process.env.PW_HOST ?? "127.0.0.1";
const port = process.env.PW_PORT ?? "4173";

const child = spawn(
  "bash",
  ["-lc", `bun run build && bun run preview --host ${host} --port ${port}`],
  { stdio: "inherit", env: childEnv, cwd },
);

const forwardExit = async (code: number | null, signal: NodeJS.Signals | null) => {
  await cleanup();
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
};

child.on("exit", forwardExit);
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
process.on("beforeExit", () => {
  void cleanup();
});
