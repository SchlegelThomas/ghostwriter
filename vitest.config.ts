import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Keep CI from hanging on stray async work after the suite finishes.
    // Cover-image jobs settle in afterEach; this is a backstop for open handles.
    pool: "forks",
    maxWorkers: 2,
    testTimeout: 30_000,
    hookTimeout: 20_000,
    teardownTimeout: 20_000,
    exclude: ["**/node_modules/**", "**/dist/**", "e2e/**", ".cursor/hooks/**"]
  }
});
