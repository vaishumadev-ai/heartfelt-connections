import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Standalone Vitest config. Do NOT reuse the main vite.config.ts because the
// TanStack Start plugin (nitro, code-splitter, server-fn transformer) is not
// designed to run inside vitest's worker environment. This keeps unit tests
// deterministic and fast; production behavior is verified separately by the
// Playwright suite in tests/e2e.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup/vitest.setup.ts"],
    include: ["tests/unit/**/*.test.{ts,tsx}"],
    css: false,
    restoreMocks: true,
    clearMocks: true,
  },
});
