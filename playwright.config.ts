import { defineConfig, devices } from "@playwright/test";
import { validateTestProject } from "./src/lib/testing/production-guard";

const PORT = Number(process.env.PW_PORT ?? 4173);
const HOST = process.env.PW_HOST ?? "127.0.0.1";
const BASE_URL = `http://${HOST}:${PORT}`;

// Fail fast at config-load time when required TEST Supabase config is missing.
// This prevents Playwright from silently spinning up a webServer against
// production credentials and gives a clear "not configured" signal instead of
// a webServer timeout. See tests/e2e/global-setup.ts for the fixture guard.
const REQUIRED_TEST_ENV = [
  "TEST_SUPABASE_URL",
  "TEST_SUPABASE_PUBLISHABLE_KEY",
  "TEST_SUPABASE_SERVICE_ROLE_KEY",
];

// PW_ALLOW_UNCONFIGURED opts out of BOTH the required-env check and the
// production-guard check at config-load time. This is required so that
// tooling like `playwright test --list` can enumerate the suite without
// hosted credentials or a dedicated test Supabase project.
//
// The production-guard is NOT weakened: globalSetup re-runs the same
// validation at run-time via tests/e2e/global-setup.ts, and the webServer
// child (scripts/test-preview.ts) enforces its own guards. Any actual test
// execution against production credentials still fails loudly.
if (!process.env.PW_ALLOW_UNCONFIGURED) {
  const missingTestEnv = REQUIRED_TEST_ENV.filter((k) => !process.env[k]);
  if (missingTestEnv.length > 0) {
    throw new Error(
      [
        "Playwright E2E is not configured.",
        `Missing: ${missingTestEnv.join(", ")}.`,
        "Provide a DEDICATED test Supabase project and re-run.",
        "Set PW_ALLOW_UNCONFIGURED=1 to load config for tooling introspection only (will still fail in globalSetup).",
      ].join(" "),
    );
  }
  const check = validateTestProject({
    testSupabaseUrl: process.env.TEST_SUPABASE_URL,
    supabaseUrl: process.env.SUPABASE_URL,
    viteSupabaseUrl: process.env.VITE_SUPABASE_URL,
    projectId: process.env.SUPABASE_PROJECT_ID,
    viteProjectId: process.env.VITE_SUPABASE_PROJECT_ID,
  });
  if (!check.ok) {
    throw new Error(`[playwright.config] ${check.reason}`);
  }
  console.log(`[playwright.config] production-guard OK; test project ref: ${check.ref}`);
}

// Viewports required by 1A-tests scope.
const viewports = [
  { name: "mobile-360", width: 360, height: 800 },
  { name: "mobile-390", width: 390, height: 844 },
  { name: "desktop-1366", width: 1366, height: 768 },
];

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  reporter: [["list"]],
  globalSetup: "./tests/e2e/global-setup.ts",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  projects: viewports.map((v) => ({
    name: v.name,
    use: { ...devices["Desktop Chrome"], viewport: { width: v.width, height: v.height } },
  })),
  webServer: {
    // Test-preview launcher injects the mapped SUPABASE_* / VITE_SUPABASE_*
    // values directly on the child process env (no .env.local writes),
    // and strips SUPABASE_SERVICE_ROLE_KEY from the child env before build
    // and preview.
    //
    // reuseExistingServer is ALWAYS false. Reusing a server already listening
    // on this port would bypass scripts/test-preview.ts entirely — meaning
    // the production-guard, service-role sanitizer, and test-project overlay
    // never run against the process actually serving requests. If the port is
    // already occupied, Playwright fails to start webServer and the suite
    // exits, which is the intended behavior: better a loud failure than a
    // silent test run against an unknown process.
    command: `bun run scripts/test-preview.ts`,
    env: {
      PW_HOST: HOST,
      PW_PORT: String(PORT),
    },
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 240_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
