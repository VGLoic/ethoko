import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const platforms = [
  { os: "linux", arch: "x64", target: "bun-linux-x64" },
  { os: "linux", arch: "arm64", target: "bun-linux-arm64" },
  { os: "darwin", arch: "x64", target: "bun-darwin-x64" },
  { os: "darwin", arch: "arm64", target: "bun-darwin-arm64" },
  { os: "windows", arch: "x64", target: "bun-windows-x64" },
] as const;

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const outDir = join(scriptsDir, "../binaries");
mkdirSync(outDir, { recursive: true });

for (const platform of platforms) {
  const ext = platform.os === "windows" ? ".exe" : "";
  const outFile = join(outDir, `ethoko-${platform.os}-${platform.arch}${ext}`);

  console.log(`Building ${platform.os}-${platform.arch}...`);
  const result = await Bun.build({
    entrypoints: ["./src/index.ts"],
    compile: {
      target: platform.target,
      outfile: outFile,
    },
  });

  if (!result.success) {
    const error = result.logs[0];
    throw new Error(
      error ? error.message : `Failed building ${platform.os}-${platform.arch}`,
    );
  }

  if (platform.os === process.platform) {
    await Bun.spawn(["chmod", "+x", outFile]).exited;
  }

  console.log(`✓ ${outFile}`);
}
