import os from "node:os";
import fs from "node:fs/promises";
import z from "zod";
import { AbsolutePath, generateAbsolutePathSchema } from "@/utils/path";
import { toAsyncResult, toResult } from "@/utils/result";
import { generateProjectConfigSchema } from "./projects";

export function getEthokoGlobalPath(): AbsolutePath {
  return new AbsolutePath(os.homedir(), ".ethoko");
}

export function getEthokoGlobalConfigPath(): AbsolutePath {
  return getEthokoGlobalPath().join("config.json");
}

const GlobalEthokoConfigSchema = z
  .object({
    pulledArtifactsPath: z
      .string('"pulledArtifactsPath" field must be a string or left empty')
      .min(
        1,
        '"pulledArtifactsPath" cannot be an empty string. Provide a valid relative path to "~/.ethoko" or leave it empty to use the default path.',
      )
      .refine(
        (value) => value !== "config.json",
        '"pulledArtifactsPath" cannot be equal to "config.json". Please choose a different name for the pulled artifacts directory.',
      )
      .default("pulled-artifacts")
      .pipe(generateAbsolutePathSchema(getEthokoGlobalPath)),
    projects: z
      .array(
        generateProjectConfigSchema(getEthokoGlobalPath),
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
  })
  .superRefine((data, ctx) => {
    // Pulled artifacts path must not be a child relationship with any of the project paths
    for (const project of data.projects) {
      if (project.storage.type === "filesystem") {
        if (data.pulledArtifactsPath.eq(project.storage.path)) {
          ctx.addIssue({
            code: "custom",
            message: `Pulled artifacts path "${data.pulledArtifactsPath.resolvedPath}" cannot be the same as project "${project.name}" storage path "${project.storage.path.resolvedPath}". Please choose a different pulled artifacts path or storage path.`,
          });
        }
        if (data.pulledArtifactsPath.isChildOf(project.storage.path)) {
          ctx.addIssue({
            code: "custom",
            message: `Pulled artifacts path "${data.pulledArtifactsPath.resolvedPath}" cannot be a parent of project "${project.name}" storage path "${project.storage.path.resolvedPath}". Please choose a different pulled artifacts path or storage path.`,
          });
        }
        if (project.storage.path.isChildOf(data.pulledArtifactsPath)) {
          ctx.addIssue({
            code: "custom",
            message: `Pulled artifacts path "${data.pulledArtifactsPath.resolvedPath}" cannot be a child of project "${project.name}" storage path "${project.storage.path.resolvedPath}". Please choose a different pulled artifacts path or storage path.`,
          });
        }
      }
    }
  });

export type GlobalEthokoConfigInput = z.input<typeof GlobalEthokoConfigSchema>;
export type GlobalEthokoConfig = z.infer<typeof GlobalEthokoConfigSchema> & {
  configPath: AbsolutePath | undefined;
};

export async function loadGlobalConfig(
  configPath?: string,
): Promise<GlobalEthokoConfig> {
  const resolvedConfigPath = configPath
    ? new AbsolutePath(configPath)
    : getEthokoGlobalConfigPath();
  const configExists = await fs
    .stat(resolvedConfigPath.resolvedPath)
    .then(() => true)
    .catch(() => false);
  if (!configExists) {
    // If the config file doesn't exist, return the default configuration
    return { ...GlobalEthokoConfigSchema.parse({}), configPath: undefined };
  }
  const configContentResult = await toAsyncResult(
    fs.readFile(resolvedConfigPath.resolvedPath, "utf-8"),
  );
  if (!configContentResult.success) {
    throw new Error(
      `Failed to read global config file at ${resolvedConfigPath.resolvedPath}: ${configContentResult.error.message}`,
    );
  }

  const jsonContentResult = toResult(() =>
    JSON.parse(configContentResult.value),
  );
  if (!jsonContentResult.success) {
    throw new Error(
      `Failed to parse global config file at ${resolvedConfigPath.resolvedPath} as JSON: ${jsonContentResult.error.message}`,
    );
  }

  const configResult = GlobalEthokoConfigSchema.safeParse(
    jsonContentResult.value,
  );
  if (!configResult.success) {
    throw new Error(
      `Global config file at ${resolvedConfigPath.resolvedPath} is invalid: ${z.prettifyError(configResult.error)}`,
    );
  }

  return { ...configResult.data, configPath: resolvedConfigPath };
}
