#!/usr/bin/env bun
/**
 * Test-only preview launcher.
 *
 * Maps TEST_SUPABASE_* env into SUPABASE_* / VITE_SUPABASE_* directly on the
 * child process environment. Vite gives explicit process env priority over
 * loaded .env files, so no .env.local manipulation is required.
 *
 *   - Never maps the service-role key into any VITE_* variable.
 *   - Never writes credentials or configuration into `.env.local`.
 *   - Verifies the production project ref is not present before build.
 *   - Cross-platform: spawns Bun directly (no bash, no shell chaining).
 *   - Runs build first; only starts preview after build exits 0.
 *   - Forwards SIGINT / SIGTERM and propagates the child exit code.
 *   - Prints only the resolved test project ref — never keys.
 */
import { spawn } from "node:child_process";
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
      viteProjectId: ref,
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
// Strip service-role env from the child preview/build; fixture setup runs
// in the parent (Playwright globalSetup), which retains access to it.
delete parentEnv.SUPABASE_SERVICE_ROLE_KEY;
delete parentEnv.TEST_SUPABASE_SERVICE_ROLE_KEY;
const childEnv = { ...parentEnv, ...overlay };

const cwd = process.cwd();
const host = process.env.PW_HOST ?? "127.0.0.1";
const port = process.env.PW_PORT ?? "4173";

function spawnBun(args: string[]) {
  return spawn("bun", args, { stdio: "inherit", env: childEnv, cwd });
}

// 1) Build the app with the guarded child env.
const build = spawnBun(["run", "build"]);
const buildCode: number = await new Promise((resolve) => {
  build.on("exit", (code) => resolve(code ?? 1));
  process.on("SIGINT", () => build.kill("SIGINT"));
  process.on("SIGTERM", () => build.kill("SIGTERM"));
});
if (buildCode !== 0) {
  console.error(`[test-preview] build failed with code ${buildCode}; not starting preview.`);
  process.exit(buildCode);
}

// 2) Start preview with the same guarded child env.
const preview = spawnBun(["run", "preview", "--host", host, "--port", port]);
preview.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
process.on("SIGINT", () => preview.kill("SIGINT"));
process.on("SIGTERM", () => preview.kill("SIGTERM"));
