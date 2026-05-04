import fs from "fs/promises";
import { GlobalFolder } from "./global-folder.js";

export const PROJECT_NAME = "forge-counter";

export class ConfigSetup {
  public testId: string;
  public testPath: string;
  public storagePath: string;
  public localArtifactStorePath: string;
  public typingsPath: string;

  constructor(testId: string) {
    this.testId = testId;
    this.testPath = `${GlobalFolder.path}/test-${testId}`;
    this.storagePath = `${this.testPath}/storage`;
    this.localArtifactStorePath = `${this.testPath}/pulled-artifacts`;
    this.typingsPath = `${this.testPath}/typings`;
  }

  async setup(): Promise<() => Promise<void>> {
    await fs.mkdir(this.testPath, { recursive: true });
    await fs.mkdir(this.storagePath, { recursive: true });
    await fs.mkdir(this.localArtifactStorePath, { recursive: true });
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
    this.cliConfigPath = `${config.testPath}/ethoko.config.json`;
  }

  async setup(): Promise<() => Promise<void>> {
    // CLI config
    const cliConfigTemplate = await fs.readFile(
      "e2e-test/helpers/templates/ethoko.config.e2e.template.json",
      "utf-8",
    );
    const cliConfigContent = cliConfigTemplate
      .replace("PROJECT_NAME", PROJECT_NAME)
      .replace("PULLED_ARTIFACTS_PATH", this.config.localArtifactStorePath)
      .replace("TYPINGS_PATH", this.config.typingsPath)
      .replace("STORAGE_PATH", this.config.storagePath);
    await fs.writeFile(this.cliConfigPath, cliConfigContent);

    return async () => {
      await fs.rm(this.cliConfigPath, { force: true });
    };
  }
}

export class DeployScriptSetup {
  private config: ConfigSetup;
  public hardhatConfigPath: string;

  constructor(config: ConfigSetup) {
    this.config = config;
    this.hardhatConfigPath = `${config.testPath}/hardhat.config.e2e.ts`;
  }

  async setup(): Promise<() => Promise<void>> {
    const localArtifactStorePath = `${this.config.testPath}/pulled-artifacts`;
    const hardhatConfigTemplate = await fs.readFile(
      "e2e-test/helpers/templates/hardhat.config.e2e.template.ts",
      "utf-8",
    );
    const hardhatConfigContent = hardhatConfigTemplate
      .replace("PROJECT_NAME", PROJECT_NAME)
      .replace("PULLED_ARTIFACTS_PATH", localArtifactStorePath)
      .replace("TYPINGS_PATH", this.config.typingsPath)
      .replace("STORAGE_PATH", `${this.config.storagePath}`);
    const deploymentScriptContent = await fs.readFile(
      "deploy/00-deploy-counter-2026-02-04.ts",
      "utf-8",
    );
    const updatedScriptContent = deploymentScriptContent
      .replaceAll("2026-02-04", this.config.testId)
      .replaceAll(".ethoko-typings", this.config.typingsPath);

    const deploymentScriptPath = `deploy/00-deploy-counter-${this.config.testId}.ts`;
    await fs.writeFile(this.hardhatConfigPath, hardhatConfigContent);
    await fs.writeFile(deploymentScriptPath, updatedScriptContent);

    return async () => {
      await fs.rm(this.hardhatConfigPath, { force: true });
      await fs.rm(deploymentScriptPath, { force: true });
    };
  }
}
