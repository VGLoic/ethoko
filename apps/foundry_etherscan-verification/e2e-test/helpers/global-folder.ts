import fs from "fs/promises";

const E2E_FOLDER_PATH = ".ethoko-e2e";

export class GlobalFolder {
  public static path = E2E_FOLDER_PATH;

  public static async setup() {
    await this.teardown();
    await fs.mkdir(this.path, { recursive: true });
  }

  public static async teardown() {
    await fs.rm(E2E_FOLDER_PATH, { recursive: true, force: true });
  }
}
