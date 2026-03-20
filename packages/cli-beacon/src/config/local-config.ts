import { AbsolutePath, generateAbsolutePathSchema } from "@/utils/path";
import fs from "node:fs/promises";
import { z } from "zod";
import { generateProjectConfigSchema } from "./projects";
import { toAsyncResult, toResult } from "@/utils/result";

const EthokoLocalConfigSchema = z
  .object({
    typingsPath: z
      .string('"typingsPath" field must be a string or left empty')
      .min(
        1,
        "'typingsPath' cannot be an empty string. Provide a valid path or set it to '.' to use the current directory or leave it empty to default to './.ethoko-typings'",
      )
      .default(".ethoko-typings")
      .pipe(generateAbsolutePathSchema(() => new AbsolutePath(process.cwd()))),
    pulledArtifactsPath: z
      .string('"pulledArtifactsPath" field must be a string or left empty')
      .min(
        1,
        "'pulledArtifactsPath' cannot be an empty string. Provide a valid path or set it to '.' to use the current directory or leave it empty to use the global pulled artifacts path",
      )
      .pipe(generateAbsolutePathSchema(() => new AbsolutePath(process.cwd())))
      .optional(),
    compilationOutputPath: z
      .string('"compilationOutputPath" field must be a string or left empty')
      .min(
        1,
        "'compilationOutputPath' cannot be an empty string. Provide a valid path or set it to '.' to use the current directory or leave it empty",
      )
      .pipe(generateAbsolutePathSchema(() => new AbsolutePath(process.cwd())))
      .optional(),
    projects: z
      .array(
        generateProjectConfigSchema(() => new AbsolutePath(process.cwd())),
        '"projects" field must be an array of project configurations',
      )
      .default([])
      .superRefine((projects, ctx) => {
        const projectNames = new Set<string>();
        for (const project of projects) {
          if (projectNames.has(project.name)) {
            ctx.addIssue({
              code: "custom",
              message: `Duplicate project name "${project.name}" found. Each project must have a unique name.`,
            });
          } else {
            projectNames.add(project.name);
          }
        }
      }),
    debug: z
      .boolean('"debug" field must be a boolean or left empty')
      .default(false),
  })
  .refine(
    (data) => {
      // Typings path and pulled artifacts path must not be a parent-child relationship
      if (!data.pulledArtifactsPath) {
        return true;
      }
      return !(
        data.typingsPath.eq(data.pulledArtifactsPath) ||
        data.pulledArtifactsPath.isChildOf(data.typingsPath) ||
        data.typingsPath.isChildOf(data.pulledArtifactsPath)
      );
    },
    {
      message:
        '"typingsPath" and "pulledArtifactsPath" cannot be in a parent-child relationship',
    },
  )
  .superRefine((data, ctx) => {
    // In case of storage type "filesystem", the storage path must not be a child or parent of typings path or pulled artifacts path
    for (const project of data.projects) {
      if (project.storage.type === "filesystem") {
        if (
          project.storage.path.isChildOf(data.typingsPath) ||
          data.typingsPath.isChildOf(project.storage.path) ||
          project.storage.path.eq(data.typingsPath)
        ) {
          ctx.addIssue({
            code: "custom",
            message: `For project "${project.name}", the "storage.path" cannot be a child or parent of "typingsPath".`,
            input: data,
          });
        }
        if (
          data.pulledArtifactsPath &&
          (project.storage.path.isChildOf(data.pulledArtifactsPath) ||
            data.pulledArtifactsPath.isChildOf(project.storage.path) ||
            project.storage.path.eq(data.pulledArtifactsPath))
        ) {
          ctx.addIssue({
            code: "custom",
            message: `For project "${project.name}", the "storage.path" cannot be a child or parent of "pulledArtifactsPath".`,
            input: data,
          });
        }
      }
    }
  });

export type LocalEthokoConfig = z.infer<typeof EthokoLocalConfigSchema> & {
  configPath: AbsolutePath | undefined;
};

export async function loadLocalConfig(
  configPath?: string,
): Promise<LocalEthokoConfig> {
  const resolvedPath = configPath
    ? new AbsolutePath(configPath)
    : await findLocalConfigPath(new AbsolutePath(process.cwd()));

  if (!resolvedPath) {
    return { ...EthokoLocalConfigSchema.parse({}), configPath: undefined };
  }
  const configExists = await fs
    .stat(resolvedPath.resolvedPath)
    .then(() => true)
    .catch(() => false);
  if (!configExists) {
    return { ...EthokoLocalConfigSchema.parse({}), configPath: undefined };
  }

  const configContentResult = await toAsyncResult(
    fs.readFile(resolvedPath.resolvedPath, "utf-8"),
  );
  if (!configContentResult.success) {
    throw new Error(
      `Failed to read local config file at ${resolvedPath.resolvedPath}: ${configContentResult.error.message}`,
    );
  }

  const jsonContentResult = toResult(() =>
    JSON.parse(configContentResult.value),
  );
  if (!jsonContentResult.success) {
    throw new Error(
      `Failed to parse local config file at ${resolvedPath.resolvedPath} as JSON: ${jsonContentResult.error.message}`,
    );
  }

  const configResult = EthokoLocalConfigSchema.safeParse(
    jsonContentResult.value,
  );
  if (!configResult.success) {
    throw new Error(
      `Local config file at ${resolvedPath.resolvedPath} is invalid: ${z.prettifyError(configResult.error)}`,
    );
  }

  return { ...configResult.data, configPath: resolvedPath };
}

async function findLocalConfigPath(
  startDir: AbsolutePath,
): Promise<AbsolutePath | null> {
  let currentDir = startDir;
  while (true) {
    const candidate = currentDir.join("ethoko.config.json");
    const exists = await fs
      .stat(candidate.resolvedPath)
      .then(() => true)
      .catch(() => false);
    if (exists) {
      return candidate;
    }

    if (isRootPath(currentDir)) {
      return null;
    }
    currentDir = currentDir.dirname();
  }
}

function isRootPath(currentPath: AbsolutePath): boolean {
  return currentPath.dirname().resolvedPath === currentPath.resolvedPath;
}
