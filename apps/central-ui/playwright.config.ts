import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  use: { baseURL: "http://127.0.0.1:5178" },
  webServer: [
    { command: "node tests/api-fixture.mjs", port: 5189 },
    {
      command: "pnpm dev --host 127.0.0.1 --port 5178 --strictPort",
      port: 5178,
      env: {
        ETHOKO_CENTRAL_URL: "http://127.0.0.1:5189",
        CENTRAL_UI_BFF_SHARED_SECRET: "browser-test-machine-credential",
        SESSION_SECRET: "browser-test-cookie-secret",
      },
    },
  ],
});
