import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

type Platform = {
  os: "linux" | "darwin" | "windows";
  arch: "x64" | "arm64";
  binaryName: string;
  npmOs: string[];
  npmCpu: string[];
};

const platforms: Platform[] = [
  {
    os: "linux",
    arch: "x64",
    binaryName: "ethoko-linux-x64",
    npmOs: ["linux"],
    npmCpu: ["x64"],
  },
  {
    os: "linux",
    arch: "arm64",
    binaryName: "ethoko-linux-arm64",
    npmOs: ["linux"],
    npmCpu: ["arm64"],
  },
  {
    os: "darwin",
    arch: "x64",
    binaryName: "ethoko-darwin-x64",
    npmOs: ["darwin"],
    npmCpu: ["x64"],
  },
  {
    os: "darwin",
    arch: "arm64",
    binaryName: "ethoko-darwin-arm64",
    npmOs: ["darwin"],
    npmCpu: ["arm64"],
  },
  {
    os: "windows",
    arch: "x64",
    binaryName: "ethoko-windows-x64.exe",
    npmOs: ["win32"],
    npmCpu: ["x64"],
  },
];

const wrapperScript = [
  "#!/usr/bin/env node",
  'const { spawnSync } = require("child_process");',
  'const os = require("os");',
  "",
  'const platformMap = { darwin: "darwin", linux: "linux", win32: "windows" };',
  'const archMap = { x64: "x64", arm64: "arm64" };',
  "",
  "const platform = platformMap[os.platform()];",
  "const arch = archMap[os.arch()];",
  "",
  "if (!platform || !arch) {",
  "  console.error(`Unsupported platform: ${os.platform()}-${os.arch()}`);",
  "  process.exit(1);",
  "}",
  "",
  'const binaryName = platform === "windows" ? "ethoko.exe" : "ethoko";',
  "",
  "let binaryPath;",
  "try {",
  "  binaryPath = require.resolve(",
  "    `@ethoko/cli-${platform}-${arch}/bin/${binaryName}`,",
  "  );",
  "} catch {",
  "  console.error(",
  "    `Could not find Ethoko binary for ${os.platform()}-${os.arch()}\\n` +",
  "      `The platform package @ethoko/cli-${platform}-${arch} is not installed.\\n` +",
  "      `Try reinstalling: npm install -g @ethoko/cli`,",
  "  );",
  "  process.exit(1);",
  "}",
  "",
  "const result = spawnSync(binaryPath, process.argv.slice(2), {",
  '  stdio: "inherit",',
  "});",
  "process.exit(result.status ?? 1);",
].join("\n");

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const cliBeaconDir = path.resolve(scriptsDir, "..");
const repoRoot = path.resolve(cliBeaconDir, "..");
const tmpRoot = path.resolve(repoRoot, "tmp");

const wrapperPackageName = "@ethoko/cli";
const beaconPackagePath = path.resolve(cliBeaconDir, "package.json");

const isDryRun = process.argv.includes("--dry-run");

const ensureDir = async (path: string) => {
  await fs.mkdir(path, { recursive: true });
};

const writeJson = async (path: string, data: Record<string, unknown>) => {
  await fs.writeFile(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
};

const resolveBinaryPath = (binaryName: string) =>
  path.resolve(cliBeaconDir, "binaries", binaryName);

const exec = async (command: string, args: string[], cwd: string) => {
  const proc = Bun.spawn([command, ...args], {
    cwd,
    env: {
      ...process.env,
      npm_config_registry: "https://registry.npmjs.org/",
    },
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}`);
  }
};

const main = async () => {
  const beaconPackage = JSON.parse(
    await fs.readFile(beaconPackagePath, "utf8"),
  ) as {
    version: string;
    description?: string;
    license?: string;
    repository?: unknown;
  };
  const version = beaconPackage.version;

  if (!version) {
    throw new Error("Could not determine @ethoko/cli-beacon version");
  }

  const tempScopeDir = path.resolve(tmpRoot, "@ethoko");
  await ensureDir(tempScopeDir);

  const platformPackages: { name: string; dir: string }[] = [];

  for (const platform of platforms) {
    const packageName = `@ethoko/cli-${platform.os}-${platform.arch}`;
    const packageDir = path.resolve(
      tempScopeDir,
      `cli-${platform.os}-${platform.arch}`,
    );
    const binDir = path.resolve(packageDir, "bin");

    await ensureDir(binDir);

    const binarySource = resolveBinaryPath(platform.binaryName);
    const binaryTargetName =
      platform.os === "windows" ? "ethoko.exe" : "ethoko";
    const binaryTarget = path.resolve(binDir, binaryTargetName);

    await fs.cp(binarySource, binaryTarget);
    if (platform.os !== "windows") {
      await fs.chmod(binaryTarget, 0o755);
    }

    const packageJson = {
      name: packageName,
      version,
      description: beaconPackage.description ?? "Ethoko CLI platform binary",
      license: beaconPackage.license ?? "MIT",
      repository: beaconPackage.repository,
      os: platform.npmOs,
      cpu: platform.npmCpu,
      bin: {
        ethoko: "./bin/ethoko",
      },
    };

    await writeJson(path.resolve(packageDir, "package.json"), packageJson);
    platformPackages.push({ name: packageName, dir: packageDir });
  }

  const wrapperDir = path.resolve(tempScopeDir, "cli");
  const wrapperBinDir = path.resolve(wrapperDir, "bin");
  await ensureDir(wrapperBinDir);

  await fs.writeFile(
    path.resolve(wrapperBinDir, "ethoko"),
    wrapperScript,
    "utf8",
  );
  await fs.chmod(path.resolve(wrapperBinDir, "ethoko"), 0o755);

  const optionalDependencies = Object.fromEntries(
    platformPackages.map((pkg) => [pkg.name, version]),
  );

  const wrapperPackageJson = {
    name: wrapperPackageName,
    version,
    description:
      beaconPackage.description ??
      "Ethoko CLI - Standalone tool for smart-contract artifact management",
    license: beaconPackage.license ?? "MIT",
    repository: beaconPackage.repository,
    bin: {
      ethoko: "./bin/ethoko",
    },
    optionalDependencies,
  };

  await writeJson(path.resolve(wrapperDir, "package.json"), wrapperPackageJson);

  if (isDryRun) {
    console.log(`Dry run complete. Generated packages in ${tmpRoot}`);
    return;
  }

  if (!process.env.NPM_TOKEN) {
    throw new Error("NPM_TOKEN is required to publish");
  }

  for (const pkg of platformPackages) {
    console.log(`Publishing ${pkg.name}@${version}...`);
    await exec("npm", ["publish", "--access", "public"], pkg.dir);
  }

  console.log(`Publishing ${wrapperPackageName}@${version}...`);
  await exec("npm", ["publish", "--access", "public"], wrapperDir);
};

await main();
