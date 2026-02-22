import { emptyTask, task } from "hardhat/config";
import { ArgumentType } from "hardhat/types/arguments";
import type { HardhatPlugin } from "hardhat/types/plugins";

import "./type-extension.js";

const hardhatEthoko: HardhatPlugin = {
  id: "hardhat-ethoko",
  hookHandlers: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    config: () => import("./hooks/config.js") as any,
  },
  tasks: [
    emptyTask("ethoko", "Ethoko plugin tasks").build(),
    task(["ethoko", "pull"], "Pull one or many artifacts of a project.")
      .addOption({
        name: "id",
        description:
          "The ID of the artifact to pull, can not be used with the `tag` parameter",
        type: ArgumentType.STRING,
        defaultValue: "",
      })
      .addOption({
        name: "tag",
        description:
          "The tag of the artifact to pull, can not be used with the `id` parameter",
        type: ArgumentType.STRING_WITHOUT_DEFAULT,
        defaultValue: undefined,
      })
      .addOption({
        name: "project",
        description:
          "The project to pull the artifacts from, defaults to the configured project",
        type: ArgumentType.STRING_WITHOUT_DEFAULT,
        defaultValue: undefined,
      })
      .addFlag({
        name: "force",
        description:
          "Force the pull of the artifacts, replacing previously downloaded ones",
      })
      .addFlag({
        name: "debug",
        description: "Enable debug mode",
      })
      .addFlag({
        name: "silent",
        description: "Suppress CLI output (except errors and warnings)",
      })
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore - Dynamic import type inference limitation with tsup
      .setAction(() => import("./tasks/pull.js"))
      .build(),
    task(["ethoko", "push"], "Push one or many artifacts of a project.")
      .addOption({
        name: "artifactPath",
        description: "The path of the compilation artifact to push",
        type: ArgumentType.STRING_WITHOUT_DEFAULT,
        defaultValue: undefined,
      })
      .addOption({
        name: "tag",
        description: "Tag to associate to the pushed artifact",
        type: ArgumentType.STRING_WITHOUT_DEFAULT,
        defaultValue: undefined,
      })
      .addFlag({
        name: "force",
        description:
          "Force the push of the artifact even if it already exists in the storage",
      })
      .addFlag({
        name: "debug",
        description: "Enable debug mode",
      })
      .addFlag({
        name: "silent",
        description: "Suppress CLI output (except errors and warnings)",
      })
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore - Dynamic import type inference limitation with tsup
      .setAction(() => import("./tasks/push.js"))
      .build(),
    task(
      ["ethoko", "typings"],
      "Generate typings based on the pulled artifacts.",
    )
      .addFlag({
        name: "debug",
        description: "Enable debug mode",
      })
      .addFlag({
        name: "silent",
        description: "Suppress CLI output (except errors and warnings)",
      })
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore - Dynamic import type inference limitation with tsup
      .setAction(() => import("./tasks/typings.js"))
      .build(),
    task(
      ["ethoko", "artifacts"],
      "List the artifacts that have been pulled with their associated projects.",
    )
      .addFlag({
        name: "debug",
        description: "Enable debug mode",
      })
      .addFlag({
        name: "silent",
        description: "Suppress CLI output (except errors and warnings)",
      })
      .addFlag({
        name: "json",
        description: "Output results in JSON format",
      })
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore - Dynamic import type inference limitation with tsup
      .setAction(() => import("./tasks/artifacts.js"))
      .build(),
    task(["ethoko", "inspect"], "Inspect a local compilation artifact.")
      .addOption({
        name: "id",
        description:
          "The ID of the artifact to inspect, can not be used with the `tag` parameter",
        type: ArgumentType.STRING_WITHOUT_DEFAULT,
        defaultValue: undefined,
      })
      .addOption({
        name: "tag",
        description:
          "The tag of the artifact to inspect, can not be used with the `id` parameter",
        type: ArgumentType.STRING_WITHOUT_DEFAULT,
        defaultValue: undefined,
      })
      .addOption({
        name: "project",
        description:
          "The project to inspect the artifacts from, defaults to the configured project",
        type: ArgumentType.STRING_WITHOUT_DEFAULT,
        defaultValue: undefined,
      })
      .addFlag({
        name: "json",
        description: "Output results in JSON format",
      })
      .addFlag({
        name: "debug",
        description: "Enable debug mode",
      })
      .addFlag({
        name: "silent",
        description: "Suppress CLI output (except errors and warnings)",
      })
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore - Dynamic import type inference limitation with tsup
      .setAction(() => import("./tasks/inspect.js"))
      .build(),
    task(["ethoko", "export"], "Export contract ABI from a pulled artifact.")
      .addOption({
        name: "contract",
        description:
          "Contract name or fully qualified name (sourcePath:contractName)",
        type: ArgumentType.STRING,
        defaultValue: "",
      })
      .addOption({
        name: "id",
        description:
          "The ID of the artifact to export from, can not be used with the `tag` parameter",
        type: ArgumentType.STRING_WITHOUT_DEFAULT,
        defaultValue: undefined,
      })
      .addOption({
        name: "tag",
        description:
          "The tag of the artifact to export from, can not be used with the `id` parameter",
        type: ArgumentType.STRING_WITHOUT_DEFAULT,
        defaultValue: undefined,
      })
      .addOption({
        name: "project",
        description:
          "The project to export from, defaults to the configured project",
        type: ArgumentType.STRING_WITHOUT_DEFAULT,
        defaultValue: undefined,
      })
      .addOption({
        name: "output",
        description:
          "Output file path (prints to stdout if omitted, allowing piping/redirection)",
        type: ArgumentType.STRING_WITHOUT_DEFAULT,
        defaultValue: undefined,
      })
      .addFlag({
        name: "debug",
        description: "Enable debug mode",
      })
      .addFlag({
        name: "silent",
        description: "Suppress CLI output (except errors and warnings)",
      })
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore - Dynamic import type inference limitation with tsup
      .setAction(() => import("./tasks/export.js"))
      .build(),
    task(
      ["ethoko", "restore"],
      "Restore original compilation artifacts from a pulled artifact.",
    )
      .addOption({
        name: "id",
        description:
          "The ID of the artifact to restore, can not be used with the `tag` parameter",
        type: ArgumentType.STRING_WITHOUT_DEFAULT,
        defaultValue: undefined,
      })
      .addOption({
        name: "tag",
        description:
          "The tag of the artifact to restore, can not be used with the `id` parameter",
        type: ArgumentType.STRING_WITHOUT_DEFAULT,
        defaultValue: undefined,
      })
      .addOption({
        name: "project",
        description:
          "The project to restore from, defaults to the configured project",
        type: ArgumentType.STRING_WITHOUT_DEFAULT,
        defaultValue: undefined,
      })
      .addOption({
        name: "output",
        description:
          "Output directory path where the artifacts will be restored",
        type: ArgumentType.STRING,
        defaultValue: "",
      })
      .addFlag({
        name: "force",
        description: "Overwrite output directory if it already exists",
      })
      .addFlag({
        name: "debug",
        description: "Enable debug mode",
      })
      .addFlag({
        name: "silent",
        description: "Suppress CLI output (except errors and warnings)",
      })
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore - Dynamic import type inference limitation with tsup
      .setAction(() => import("./tasks/restore.js"))
      .build(),
    task(
      ["ethoko", "diff"],
      "Compare a local compilation artifacts with an existing release.",
    )
      .addOption({
        name: "artifactPath",
        description: "The path of the compilation artifact to compare",
        type: ArgumentType.STRING_WITHOUT_DEFAULT,
        defaultValue: undefined,
      })
      .addOption({
        name: "id",
        description:
          "The ID of the artifact to compare with, can not be used with the `tag` parameter",
        type: ArgumentType.STRING_WITHOUT_DEFAULT,
        defaultValue: undefined,
      })
      .addOption({
        name: "tag",
        description:
          "The tag of the artifact to compare with, can not be used with the `id` parameter",
        type: ArgumentType.STRING_WITHOUT_DEFAULT,
        defaultValue: undefined,
      })
      .addFlag({
        name: "debug",
        description: "Enable debug mode",
      })
      .addFlag({
        name: "silent",
        description: "Suppress CLI output (except errors and warnings)",
      })
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore - Dynamic import type inference limitation with tsup
      .setAction(() => import("./tasks/diff.js"))
      .build(),
  ],
};

export { hardhatEthoko as default };
