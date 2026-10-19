import { defineConfig, devices } from "@playwright/test";
import { apiUrl, machineCredential, uiUrl } from "./e2e/settings";

export default defineConfig({
  testDir: "./e2e",
  testMatch: process.env.E2E_HARNESS_PROBE
    ? "harness.spec.ts"
    : ["login.spec.ts", "signup.spec.ts", "register-handle.spec.ts"],
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  globalTeardown: "./e2e/audit.ts",
  use: { baseURL: uiUrl, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node --experimental-strip-types e2e/mock-api.ts",
      url: `${apiUrl}/__test/health`,
      reuseExistingServer: false,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command:
        "pnpm dev --config vite.e2e.config.ts --host 127.0.0.1 --port 5174 --strictPort",
      url: `${uiUrl}/login`,
      reuseExistingServer: false,
      env: {
        ETHOKO_CENTRAL_URL: apiUrl,
        CENTRAL_UI_BFF_SHARED_SECRET: machineCredential,
        SESSION_SECRET: "playwright-only-cookie-signing-secret",
        NODE_ENV: "development",
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
