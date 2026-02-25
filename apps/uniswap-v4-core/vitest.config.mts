import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    testTimeout: 320_000,
    hookTimeout: 30_000,
    globalSetup: "./e2e-test/setup.ts",
    include: ["e2e-test/**/*.e2e.test.ts"],
    exclude: ["node_modules", "dist"],
    pool: "threads",
  },
  resolve: {
    alias: {},
  },
});
