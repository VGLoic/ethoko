import fs from "fs/promises";
import { GlobalFolder } from "./global-folder.js";

export const PROJECT_NAME = "curious-counter";

export class ConfigSetup {
  public testId: string;
  public testPath: string;
  public storagePath: string;
  public pulledArtifactsPath: string;
  public typingsPath: string;

  constructor(testId: string) {
    this.testId = testId;
    this.testPath = `${GlobalFolder.path}/test-${testId}`;
    this.storagePath = `${this.testPath}/storage`;
    this.pulledArtifactsPath = `${this.testPath}/pulled-artifacts`;
    this.typingsPath = `${this.testPath}/typings`;
  }

  async setup(): Promise<() => Promise<void>> {
    await fs.mkdir(this.testPath, { recursive: true });
    await fs.mkdir(this.storagePath, { recursive: true });
    await fs.mkdir(this.pulledArtifactsPath, { recursive: true });
    await fs.mkdir(this.typingsPath, { recursive: true });

    return async () => {
      await fs.rm(this.testPath, { recursive: true, force: true });
    };
  }
}

export class CliConfigSetup {
  public cliConfigPath: string;
  private config: ConfigSetup;

  constructor(config: ConfigSetup) {
    this.config = config;
    this.cliConfigPath = `${config.testPath}/ethoko.json`;
  }

  async setup(): Promise<() => Promise<void>> {
    // CLI config
    const cliConfigTemplate = await fs.readFile(
      "e2e-test/helpers/templates/ethoko.config.e2e.template.json",
      "utf-8",
    );
    const cliConfigContent = cliConfigTemplate
      .replace("PROJECT_NAME", PROJECT_NAME)
      .replace(
        "PULLED_ARTIFACTS_PATH",
        `./../../${this.config.pulledArtifactsPath}`,
      )
      .replace("TYPINGS_PATH", `./../../${this.config.typingsPath}`)
      .replace("STORAGE_PATH", `./../../${this.config.storagePath}`);
    await fs.writeFile(this.cliConfigPath, cliConfigContent);

    return async () => {
      await fs.rm(this.cliConfigPath, { force: true });
    };
  }
}

export class HardhatConfigSetup {
  public hardhatConfigPath: string;
  private config: ConfigSetup;

  constructor(config: ConfigSetup) {
    this.config = config;
    this.hardhatConfigPath = `${config.testPath}/hardhat.config.e2e.ts`;
  }

  async setup(): Promise<() => Promise<void>> {
    const pulledArtifactsPath = `${this.config.testPath}/pulled-artifacts`;
    const hardhatConfigTemplate = await fs.readFile(
      "e2e-test/helpers/templates/hardhat.config.e2e.template.ts",
      "utf-8",
    );
    const hardhatConfigContent = hardhatConfigTemplate
      .replace("PROJECT_NAME", PROJECT_NAME)
      .replace("PULLED_ARTIFACTS_PATH", pulledArtifactsPath)
      .replace("TYPINGS_PATH", this.config.typingsPath)
      .replace("STORAGE_PATH", `${this.config.storagePath}`);
    await fs.writeFile(this.hardhatConfigPath, hardhatConfigContent);

    return async () => {
      await fs.rm(this.hardhatConfigPath, { force: true });
    };
  }
}

export class HardhatDeployScriptSetup {
  private config: ConfigSetup;

  constructor(config: ConfigSetup) {
    this.config = config;
  }

  async setup(): Promise<() => Promise<void>> {
    const deploymentScriptContent = await fs.readFile(
      "deploy/deploy_counter-2026-02-02.ts",
      "utf-8",
    );
    const updatedScriptContent = deploymentScriptContent
      .replaceAll("2026-02-02", this.config.testId)
      .replaceAll(".ethoko-typings", this.config.typingsPath);

    const deploymentScriptPath = `deploy/deploy_counter-${this.config.testId}.ts`;
    await fs.writeFile(deploymentScriptPath, updatedScriptContent);

    return async () => {
      await fs.rm(deploymentScriptPath, { force: true });
    };
  }
}
