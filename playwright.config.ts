import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PW_PORT ?? 4173);
const HOST = process.env.PW_HOST ?? "127.0.0.1";
const BASE_URL = `http://${HOST}:${PORT}`;

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