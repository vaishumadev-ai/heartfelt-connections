import { defineConfig, devices } from "@playwright/test";

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
const missingTestEnv = REQUIRED_TEST_ENV.filter((k) => !process.env[k]);
if (missingTestEnv.length > 0 && !process.env.PW_ALLOW_UNCONFIGURED) {
  throw new Error(
    [
      "Playwright E2E is not configured.",
      `Missing: ${missingTestEnv.join(", ")}.`,
      "Provide a DEDICATED test Supabase project and re-run.",
      "Set PW_ALLOW_UNCONFIGURED=1 to load config for tooling introspection only (will still fail in globalSetup).",
    ].join(" "),
  );
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
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  projects: viewports.map((v) => ({
    name: v.name,
    use: { ...devices["Desktop Chrome"], viewport: { width: v.width, height: v.height } },
  })),
  webServer: {
    // Build then preview: production-preview parity.
    command: `bun run build && bun run preview --host ${HOST} --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});