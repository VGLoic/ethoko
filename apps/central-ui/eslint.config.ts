import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import pluginReact from "eslint-plugin-react";
import css from "@eslint/css";
import { defineConfig } from "eslint/config";

const JS_FILES = ["**/*.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"];

export default defineConfig([
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
]);