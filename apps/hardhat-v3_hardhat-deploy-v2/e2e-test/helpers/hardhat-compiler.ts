import crypto from "crypto";
import fs from "fs/promises";
import { asyncExec } from "./async-exec.js";

export class HardhatCompiler {
  public static async compile(command: string, artifactsPath: string) {
    const hardhatConfigCompilationPath =
      await this.createHardhatConfig(artifactsPath);

    await asyncExec(`${command} --config ${hardhatConfigCompilationPath}`);

    await fs.rm(hardhatConfigCompilationPath, { force: true });
  }

  private static async createHardhatConfig(artifactsPath: string) {
    const hardhatConfigCompilationTemplate = await fs.readFile(
      "e2e-test/helpers/templates/hardhat.config.compilation.e2e.template.ts",
      "utf-8",
    );
    const hardhatConfigContent = hardhatConfigCompilationTemplate
      .replaceAll("ARTIFACTS_PATH", artifactsPath)
      .replaceAll("CACHE_PATH", `${artifactsPath}-cache`);

    const id = crypto.randomBytes(8).toString("hex");
    // We keep the file at the root for simplicity regarding the relative localisations of the contracts
    const hardhatConfigCompilationPath = `hardhat.config.${id}.ts`;
    await fs.writeFile(hardhatConfigCompilationPath, hardhatConfigContent);

    return hardhatConfigCompilationPath;
  }
}
