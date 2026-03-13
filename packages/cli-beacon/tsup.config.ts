/// <reference types="node" />

import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const packageJson = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  splitting: false,
  sourcemap: true,
  dts: true,
  clean: true,
  banner: {
    js: "#!/usr/bin/env node",
  },
  publicDir: "templates",
  define: {
    __ETHOKO_VERSION__: JSON.stringify(packageJson.version),
  },
});
