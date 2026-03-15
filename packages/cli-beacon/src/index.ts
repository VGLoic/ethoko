import { Command } from "commander";

import { loadConfig } from "./config/config.js";
import { registerArtifactsCommand } from "./commands/artifacts.js";
import { registerDiffCommand } from "./commands/diff.js";
import { registerExportCommand } from "./commands/export.js";
import { registerInspectCommand } from "./commands/inspect.js";
import { registerPullCommand } from "./commands/pull.js";
import { registerPushCommand } from "./commands/push.js";
import { registerRestoreCommand } from "./commands/restore.js";
import { registerTypingsCommand } from "./commands/typings.js";
import { registerUninstallCommand } from "./commands/uninstall.js";
import { registerUpgradeCommand } from "./commands/upgrade.js";
import { VERSION } from "./version.js";

const program = new Command();

program
  .name("ethoko")
  .description("Ethoko CLI")
  .option("--config <path>", "Path to ethoko.config.json configuration file")
  .version(VERSION);

const getConfig = async () => loadConfig(program.opts().config);

registerPushCommand(program, getConfig);
registerPullCommand(program, getConfig);
registerDiffCommand(program, getConfig);
registerInspectCommand(program, getConfig);
registerArtifactsCommand(program, getConfig);
registerTypingsCommand(program, getConfig);
registerExportCommand(program, getConfig);
registerRestoreCommand(program, getConfig);
registerUpgradeCommand(program);
registerUninstallCommand(program);

program.parse(process.argv);
