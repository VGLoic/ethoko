import { AbsolutePath } from "@/utils/path";
import { type ProjectConfig } from "./projects";
import { GlobalEthokoConfig, loadGlobalConfig } from "./global-config";
import { loadLocalConfig, LocalEthokoConfig } from "./local-config";
import { toAsyncResult } from "@/utils/result";

export type EthokoStorageConfig = ProjectConfig["storage"];

export class EthokoCliConfig {
  public localArtifactStorePath: AbsolutePath;
  public localArtifactStorePathSource: "local" | "global";
  public typingsPath: AbsolutePath;
  public compilationOutputPath: AbsolutePath | undefined;
  public projects: ProjectConfig[];
  public localConfigPath: AbsolutePath | undefined;
  public globalConfigPath: AbsolutePath | undefined;
  public debug: boolean;
  public localProjectNames: ReadonlySet<string>;
  public globalProjectNames: ReadonlySet<string>;

  constructor(config: EthokoConfig) {
    this.localArtifactStorePath = config.localArtifactStorePath;
    this.localArtifactStorePathSource = config.localArtifactStorePathSource;
    this.typingsPath = config.typingsPath;
    this.compilationOutputPath = config.compilationOutputPath;
    this.debug = config.debug;
    this.projects = config.projects;
    this.localConfigPath = config.localConfigPath;
    this.globalConfigPath = config.globalConfigPath;
    this.localProjectNames = config.localProjectNames;
    this.globalProjectNames = config.globalProjectNames;
  }

  public getProjectConfig(project: string): ProjectConfig | undefined {
    return this.projects.find((p) => p.name === project);
  }
}
interface EthokoConfig {
  localArtifactStorePath: AbsolutePath;
  localArtifactStorePathSource: "local" | "global";
  typingsPath: AbsolutePath;
  compilationOutputPath: AbsolutePath | undefined;
  projects: ProjectConfig[];
  debug: boolean;
  localConfigPath: AbsolutePath | undefined;
  globalConfigPath: AbsolutePath | undefined;
  localProjectNames: ReadonlySet<string>;
  globalProjectNames: ReadonlySet<string>;
}

export async function loadConfig(
  args: {
    globalConfigPath?: string;
    localConfigPath?: string;
  } = {},
): Promise<EthokoCliConfig> {
  const globalConfigResult = await toAsyncResult(
    loadGlobalConfig(args.globalConfigPath),
  );
  if (!globalConfigResult.success) {
    throw new Error(
      `Failed to load global config: ${globalConfigResult.error.message}`,
    );
  }
  const localConfigResult = await toAsyncResult(
    loadLocalConfig(args.localConfigPath),
  );
  if (!localConfigResult.success) {
    throw new Error(
      `Failed to load local config: ${localConfigResult.error.message}`,
    );
  }

  const mergeConfig = mergeConfigs(
    globalConfigResult.value,
    localConfigResult.value,
  );

  validateMergedConfig(mergeConfig);

  return new EthokoCliConfig(mergeConfig);
}

function mergeConfigs(
  globalConfig: GlobalEthokoConfig,
  localConfig: LocalEthokoConfig,
): EthokoConfig {
  const mergedProjects = [...localConfig.projects];
  for (const globalProject of globalConfig.projects) {
    if (!localConfig.projects.some((p) => p.name === globalProject.name)) {
      mergedProjects.push(globalProject);
    }
  }
  return {
    localArtifactStorePath:
      localConfig.localArtifactStorePath || globalConfig.localArtifactStorePath,
    localArtifactStorePathSource: localConfig.localArtifactStorePath
      ? "local"
      : "global",
    typingsPath: localConfig.typingsPath,
    compilationOutputPath: localConfig.compilationOutputPath,
    projects: mergedProjects,
    debug: localConfig.debug,
    localConfigPath: localConfig.configPath,
    globalConfigPath: globalConfig.configPath,
    localProjectNames: new Set(localConfig.projects.map((p) => p.name)),
    globalProjectNames: new Set(globalConfig.projects.map((p) => p.name)),
  };
}

function validateMergedConfig(config: EthokoConfig) {
  const errors: string[] = [];

  // Validate localArtifactStorePath and typingsPath relationship
  if (
    config.localArtifactStorePath.eq(config.typingsPath) ||
    config.localArtifactStorePath.isChildOf(config.typingsPath) ||
    config.typingsPath.isChildOf(config.localArtifactStorePath)
  ) {
    errors.push(
      '"typingsPath" and "localArtifactStorePath" cannot be in a parent-child relationship',
    );
  }

  // Validate storage paths for each project
  for (const project of config.projects) {
    if (project.storage.type === "filesystem") {
      if (
        project.storage.path.isChildOf(config.typingsPath) ||
        config.typingsPath.isChildOf(project.storage.path) ||
        project.storage.path.eq(config.typingsPath)
      ) {
        errors.push(
          `For project "${project.name}", the "storage.path" cannot be a child or parent of "typingsPath".`,
        );
      }
      if (
        config.localArtifactStorePath &&
        (project.storage.path.isChildOf(config.localArtifactStorePath) ||
          config.localArtifactStorePath.isChildOf(project.storage.path) ||
          project.storage.path.eq(config.localArtifactStorePath))
      ) {
        errors.push(
          `For project "${project.name}", the "storage.path" cannot be a child or parent of "localArtifactStorePath".`,
        );
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`Invalid configuration:\n${errors.join("\n")}`);
  }
}
