import { Command } from "commander";

import { loadConfig } from "./config.js";
import { registerArtifactsCommand } from "./commands/artifacts.js";
import { registerDiffCommand } from "./commands/diff.js";
import { registerExportCommand } from "./commands/export.js";
import { registerInspectCommand } from "./commands/inspect.js";
import { registerPullCommand } from "./commands/pull.js";
import { registerPushCommand } from "./commands/push.js";
import { registerRestoreCommand } from "./commands/restore.js";
import { registerTypingsCommand } from "./commands/typings.js";

const program = new Command();

program
  .name("ethoko")
  .description("Ethoko CLI")
  .option("--config <path>", "Path to ethoko.json configuration file")
  .version("0.1.0");

const getConfig = async () => loadConfig(program.opts().config);

registerPushCommand(program, getConfig);
registerPullCommand(program, getConfig);
registerDiffCommand(program, getConfig);
registerInspectCommand(program, getConfig);
registerArtifactsCommand(program, getConfig);
registerTypingsCommand(program, getConfig);
registerExportCommand(program, getConfig);
registerRestoreCommand(program, getConfig);

program.parse(process.argv);
