import { defineConfig, devices } from "@playwright/test";

const appOrigin = "http://127.0.0.1:4173";
const apiOrigin = "http://127.0.0.1:8787";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  retries: process.env.CI === "true" ? 1 : 0,
  reporter: process.env.CI === "true" ? "github" : "list",
  use: {
    baseURL: appOrigin,
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ],
  webServer: [
    {
      command:
        `GHOSTWRITER_E2E=1 PORT=8787 E2E_APP_ORIGIN=${appOrigin} ` +
        "pnpm --filter @ghostwriter/backend exec tsx src/e2e-server.ts",
      url: `${apiOrigin}/health`,
      reuseExistingServer: false,
      timeout: 30_000
    },
    {
      command:
        `EXPO_PUBLIC_API_URL=${apiOrigin} pnpm exec expo export --platform web && ` +
        "pnpm exec serve -s dist -l 4173",
      cwd: "apps/client",
      url: appOrigin,
      reuseExistingServer: false,
      timeout: 60_000
    }
  ]
});
