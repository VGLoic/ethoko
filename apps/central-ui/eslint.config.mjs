import { config } from "@ethoko/eslint-config/react";

export default [
  ...config,
  {
    files: ["e2e/**/*.ts", "playwright.config.ts"],
    rules: {
      // These processes are launched by Playwright, not Turborepo.
      "turbo/no-undeclared-env-vars": "off",
    },
  },
];
