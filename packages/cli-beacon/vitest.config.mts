import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "e2e",
          environment: "node",
          testTimeout: 60000,
          hookTimeout: 30000,
          globalSetup: "./test/setup.ts",
          include: ["test/**/*.e2e.test.ts"],
          exclude: ["node_modules", "dist"],
        },
      },
      {
        extends: true,
        test: {
          name: "typecheck",
          environment: "node",
          testTimeout: 60000,
          hookTimeout: 30000,
          include: ["templates-builder/*.test-d.ts"],
          exclude: ["node_modules", "dist"],
        },
      },
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          testTimeout: 60000,
          hookTimeout: 30000,
          include: ["src/**/*.test.ts"],
          exclude: ["node_modules", "dist"],
        },
      },
    ],
  },
  resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
        "@test": path.resolve(__dirname, "./test"),
      },
    },
});
