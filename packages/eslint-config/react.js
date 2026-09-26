import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import pluginReact from "eslint-plugin-react";
import css from "@eslint/css";
import eslintConfigPrettier from "eslint-config-prettier";
import turboPlugin from "eslint-plugin-turbo";
import onlyWarn from "eslint-plugin-only-warn";
import { defineConfig } from "eslint/config";

const JS_FILES = ["**/*.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"];

/**
 * A shared ESLint configuration for React/Vite web applications.
 *
 * @type {import("eslint").Linter.Config[]}
 * */
export const config = defineConfig([
  {
    files: JS_FILES,
    plugins: { js },
    extends: ["js/recommended"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  {
    files: JS_FILES,
    extends: [
      ...tseslint.configs.recommended,
      pluginReact.configs.flat.recommended,
    ],
  },
  {
    settings: {
      react: {
        version: "detect",
      },
    },
  },
  {
    files: ["**/*.css"],
    plugins: { css },
    language: "css/css",
    extends: ["css/recommended"],
    languageOptions: {
      tolerant: true,
    },
    rules: {
      "css/no-empty-blocks": "error",
      "css/no-invalid-at-rules": "off",
    },
  },
  {
    files: ["**/*.tsx"],
    rules: {
      "react/react-in-jsx-scope": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
    },
  },
  eslintConfigPrettier,
  {
    plugins: {
      turbo: turboPlugin,
    },
    rules: {
      "turbo/no-undeclared-env-vars": "warn",
    },
  },
  {
    plugins: {
      onlyWarn,
    },
  },
  {
    ignores: ["dist/**", "artifacts/**", "node_modules/**", "out/**", "lib/**", "generated/**"],
  },
]);