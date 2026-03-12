import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

/**
 * Known Ethoko installation sources for the CLI.
 */
export type InstallMethod =
  | "curl"
  | "npm-global"
  | "npm-local"
  | "brew"
  | "unknown";

const RELEASES_URL =
  "https://api.github.com/repos/VGLoic/ethoko-monorepo/releases";

const ReleasesSchema = z.array(
  z.object({
    tag_name: z.string(),
    draft: z.boolean().optional(),
    prerelease: z.boolean().optional(),
  }),
);

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

/**
 * Detect how the CLI was installed based on the executable path.
 */
export function detectInstallMethod(): InstallMethod {
  const execPath = normalizePath(process.execPath);

  if (execPath.includes("/.ethoko/bin/")) {
    return "curl";
  }

  if (execPath.includes("/Cellar/") || execPath.includes("/homebrew/")) {
    return "brew";
  }

  if (execPath.includes("/node_modules/")) {
    if (execPath.includes("/lib/node_modules/")) {
      return "npm-global";
    }
    return "npm-local";
  }

  return "unknown";
}

/**
 * Fetch the latest CLI version from GitHub releases.
 */
export async function getLatestVersion(opts?: {
  debug?: boolean;
}): Promise<string> {
  let response: Response;
  try {
    response = await fetch(RELEASES_URL, {
      headers: {
        Accept: "application/vnd.github+json",
      },
    });
  } catch (error) {
    if (opts?.debug) {
      console.error(error);
    }
    throw new Error("Failed to fetch releases from GitHub");
  }

  if (!response.ok) {
    const body = opts?.debug ? await response.text().catch(() => "") : "";
    const details = body ? ` - ${body}` : "";
    throw new Error(
      `Failed to fetch releases: ${response.status} ${response.statusText}${details}`,
    );
  }

  const data = ReleasesSchema.safeParse(await response.json());
  if (!data.success) {
    throw new Error("Unexpected GitHub releases response");
  }

  const release = data.data.find(
    (item) =>
      item.tag_name.startsWith("cli-v") && !item.draft && !item.prerelease,
  );

  if (!release) {
    throw new Error("No CLI release found on GitHub");
  }

  return release.tag_name.replace(/^cli-v/, "");
}

/**
 * Download the CLI binary for the current platform and architecture.
 */
export async function downloadBinary(
  version: string,
  destPath: string,
  opts?: {
    debug?: boolean;
  },
): Promise<void> {
  const platform = process.platform;
  const arch = process.arch;

  let os: "linux" | "darwin" | "windows";
  if (platform === "linux") {
    os = "linux";
  } else if (platform === "darwin") {
    os = "darwin";
  } else if (platform === "win32") {
    os = "windows";
  } else {
    throw new Error(`Unsupported platform: ${platform}`);
  }

  let cpu: "x64" | "arm64";
  if (arch === "x64") {
    cpu = "x64";
  } else if (arch === "arm64") {
    cpu = "arm64";
  } else {
    throw new Error(`Unsupported architecture: ${arch}`);
  }

  const ext = os === "windows" ? ".exe" : "";
  const filename = `ethoko-${os}-${cpu}${ext}`;
  const url = `https://github.com/VGLoic/ethoko-monorepo/releases/download/cli-v${version}/${filename}`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: "application/octet-stream",
      },
    });
  } catch (error) {
    if (opts?.debug) {
      console.error(error);
    }
    throw new Error("Failed to download CLI binary from GitHub");
  }

  if (!response.ok) {
    const body = opts?.debug ? await response.text().catch(() => "") : "";
    const details = body ? ` - ${body}` : "";
    throw new Error(
      `Failed to download binary: ${response.status} ${response.statusText}${details}`,
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const destDir = path.dirname(destPath);
  const tmpPath = `${destPath}.tmp`;

  await mkdir(destDir, { recursive: true });
  await writeFile(tmpPath, buffer);
  await rename(tmpPath, destPath);

  if (os !== "windows") {
    await chmod(destPath, 0o755);
  }
}
