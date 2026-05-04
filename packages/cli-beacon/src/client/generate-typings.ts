import fs from "fs/promises";
// Note: we load the template content directly here
// The ideal would be to work only with the path but it does not work right now with tsup (and NPM package) AND Bun (and binaries)
// There is a plan to migrate everything to Bun in the future, and rely on Bun's file loading capabilities, but in the meantime we need to support both environments
import typingsTemplate from "../../templates/typings.txt";
import { LocalArtifactStore } from "../local-artifact-store";
import { toAsyncResult } from "../utils/result";
import { CliError } from "./error";
import { AbsolutePath } from "@/utils/path";
import { StorageProvider } from "@/storage-provider";
import { DebugLogger } from "@/utils/debug-logger";

/**
 * Based from the Ethoko releases folder content, generate in the Ethoko typings folder
 * - `summary-exports.ts`: contains the summary of the projects, tags and contracts as a `constant` typescript object,
 * - `summary.json`: contains the same summary but in a JSON format,
 * - `index.ts`: contains all the utils to be imported by the end-developer, it is generated purely from a template file,
 * - `abis/{project}/{tag}/{sourceName}/{contract}.d.ts`: contains the ABI typings for each contract, organized by project, tag and contract,
 * - `abis.d.ts`: contains a map to all the ABI typings files.
 *
 * Example of the content of the generated `summary-exports.ts` file:
 * ```ts
 * export const ETHOKO_PATH = "<the configured Ethoko path>"
 * export const PROJECTS = {
 *    "my-project": {
 *      contracts: {
 *        "src/Counter.sol/Counter": ["latest", "v1.3.1"],
 *        "src/IncrementOracle.sol/IncrementOracle": ["latest", "v1.3.1"],
 *      },
 *      tags: {
 *        latest: [
 *          "src/Counter.sol/Counter",
 *          "src/IncrementOracle.sol/IncrementOracle",
 *        ],
 *        "v1.3.1": [
 *          "src/Counter.sol/Counter",
 *          "src/IncrementOracle.sol/IncrementOracle",
 *        ],
 *      }
 *    }
 * } as const;
 * ```
 * ```
 *
 * The function consists of the following steps:
 * 1. Set up the Local Artifact Store and the typings folder
 * 2. Read the projects, tags and contracts from the Local Artifact Store and generate a summary object
 * 3. If no projects are found, generate empty summaries and typings files.
 *    Otherwise, generate the content of the `summary-exports.ts` file and write all the typings files to the typings folder.
 *
 * @throws CliError if there is an error while reading Local Artifact Store or writing typings files.
 */
export async function generateAllPulledArtifactsTypings(
  ethokoTypingsPath: AbsolutePath,
  dependencies: {
    localArtifactStore: LocalArtifactStore;
    logger: DebugLogger;
  },
  opts: { debug: boolean },
): Promise<void> {
  const ensureLocalArtifactStoreResult = await toAsyncResult(
    dependencies.localArtifactStore.ensureSetup(),
    { debug: opts.debug },
  );
  if (!ensureLocalArtifactStoreResult.success) {
    throw new CliError(
      "Error setting up Local Artifact Store, is the script not allowed to write to the filesystem? Run with debug mode for more info",
    );
  }

  const typingsFolderStatResult = await toAsyncResult(
    fs.stat(ethokoTypingsPath.resolvedPath),
    { debug: opts.debug },
  );
  if (!typingsFolderStatResult.success) {
    const typingsDirCreationResult = await toAsyncResult(
      fs.mkdir(ethokoTypingsPath.resolvedPath, { recursive: true }),
      { debug: opts.debug },
    );
    if (!typingsDirCreationResult.success) {
      throw new CliError(
        `Error creating the local Ethoko typings directory ${ethokoTypingsPath}. Is the script not allowed to write to the filesystem? Run with debug mode for more info`,
      );
    }
  }
  if (opts.debug) {
    dependencies.logger.debug(
      `Ethoko typings directory verified/created at ${ethokoTypingsPath.resolvedPath}`,
    );
  }

  const projectsResult = await toAsyncResult(
    dependencies.localArtifactStore.listProjects(),
    {
      debug: opts.debug,
    },
  );
  if (!projectsResult.success) {
    throw new CliError(
      "Error listing the projects. Is the script not allowed to read from the filesystem? Run with debug mode for more info",
    );
  }
  const projects = projectsResult.value;
  if (opts.debug) {
    dependencies.logger.debug(
      `Projects retrieved successfully: ${projects.join(", ")}`,
    );
  }
  if (projects.length === 0) {
    const emptySummariesResult = await toAsyncResult(
      writeEmptySummaries(
        dependencies.localArtifactStore.rootPath,
        ethokoTypingsPath,
      ),
      { debug: opts.debug },
    );
    if (!emptySummariesResult.success) {
      throw new CliError(
        "Error writing the empty summaries. Is the script not allowed to write to the filesystem? Run with debug mode for more info",
      );
    }

    return;
  }

  const summary: Record<
    string,
    {
      // project -> contract -> tags
      tagsPerContract: Record<string, string[]>;
      // project -> tag -> contracts
      contractsPerTag: Record<string, string[]>;
    }
  > = {};
  // project -> tag -> contract -> abi
  const abisPerContractPerTag: Record<
    string,
    Record<string, Record<string, unknown[]>>
  > = {};

  for (const project of projects) {
    const projectSummaryResult = await toAsyncResult(
      retrieveProjectSummary(project, dependencies.localArtifactStore),
      { debug: opts.debug },
    );
    if (!projectSummaryResult.success) {
      throw new CliError(
        `Error retrieving the summary for project "${project}". Run with debug mode for more info`,
      );
    }
    summary[project] = {
      tagsPerContract: projectSummaryResult.value.tagsPerContract,
      contractsPerTag: projectSummaryResult.value.contractsPerTag,
    };
    abisPerContractPerTag[project] =
      projectSummaryResult.value.abisPerContractPerTag;
  }

  if (opts.debug) {
    dependencies.logger.debug(
      `Project summaries retrieved successfully: ${JSON.stringify(summary, null, 2)}`,
    );
  }

  const generatedSummaryResult = await toAsyncResult(
    writeGeneratedSummaries(
      summary,
      dependencies.localArtifactStore.rootPath,
      ethokoTypingsPath,
    ),
    { debug: opts.debug },
  );
  if (!generatedSummaryResult.success) {
    throw new CliError(
      "Unexpected error while generating the typings content. Run with debug mode for more info",
    );
  }
  if (opts.debug) {
    dependencies.logger.debug(
      `Summary typings files generated successfully at ${ethokoTypingsPath.resolvedPath}`,
    );
  }
  const writeAbisResult = await toAsyncResult(
    writeAbiTypings(abisPerContractPerTag, ethokoTypingsPath),
    { debug: opts.debug },
  );
  if (!writeAbisResult.success) {
    throw new CliError(
      "Unexpected error while writing the ABI typings files. Run with debug mode for more info",
    );
  }
  if (opts.debug) {
    dependencies.logger.debug(
      `ABI typings files generated successfully at ${ethokoTypingsPath.join("abis").resolvedPath}`,
    );
  }
}

export async function generateProjectTypings(
  project: string,
  ethokoTypingsPath: AbsolutePath,
  dependencies: {
    storageProvider: StorageProvider;
    localArtifactStore: LocalArtifactStore;
    logger: DebugLogger;
  },
  opts: { debug: boolean },
): Promise<void> {
  const ensureLocalArtifactStoreResult = await toAsyncResult(
    dependencies.localArtifactStore.ensureSetup(),
    { debug: opts.debug },
  );
  if (!ensureLocalArtifactStoreResult.success) {
    throw new CliError(
      "Error setting up Local Artifact Store, is the script not allowed to write to the filesystem? Run with debug mode for more info",
    );
  }

  const typingsFolderStatResult = await toAsyncResult(
    fs.stat(ethokoTypingsPath.resolvedPath),
    { debug: opts.debug },
  );
  if (!typingsFolderStatResult.success) {
    const typingsDirCreationResult = await toAsyncResult(
      fs.mkdir(ethokoTypingsPath.resolvedPath, { recursive: true }),
      { debug: opts.debug },
    );
    if (!typingsDirCreationResult.success) {
      throw new CliError(
        `Error creating the local Ethoko typings directory ${ethokoTypingsPath}. Is the script not allowed to write to the filesystem? Run with debug mode for more info`,
      );
    }
  }
  if (opts.debug) {
    dependencies.logger.debug(
      `Ethoko typings directory verified/created at ${ethokoTypingsPath.resolvedPath}`,
    );
  }

  const projectSummaryResult = await toAsyncResult(
    retrieveProjectSummary(project, dependencies.localArtifactStore),
    { debug: opts.debug },
  );
  if (!projectSummaryResult.success) {
    throw new CliError(
      `Error retrieving the summary for project "${project}". Run with debug mode for more info`,
    );
  }
  if (opts.debug) {
    dependencies.logger.debug(
      `Project summary retrieved successfully for project "${project}": ${JSON.stringify(projectSummaryResult.value, null, 2)}`,
    );
  }

  const generatedSummaryResult = await toAsyncResult(
    writeGeneratedSummaries(
      {
        [project]: {
          tagsPerContract: projectSummaryResult.value.tagsPerContract,
          contractsPerTag: projectSummaryResult.value.contractsPerTag,
        },
      },
      dependencies.localArtifactStore.rootPath,
      ethokoTypingsPath,
    ),
    { debug: opts.debug },
  );
  if (!generatedSummaryResult.success) {
    throw new CliError(
      "Unexpected error while generating the typings content. Run with debug mode for more info",
    );
  }
  if (opts.debug) {
    dependencies.logger.debug(
      `Generated typings content successfully for project "${project}"`,
    );
  }
  const writeAbisResult = await toAsyncResult(
    writeAbiTypings(
      { [project]: projectSummaryResult.value.abisPerContractPerTag },
      ethokoTypingsPath,
    ),
    { debug: opts.debug },
  );
  if (!writeAbisResult.success) {
    throw new CliError(
      "Unexpected error while writing the ABI typings files. Run with debug mode for more info",
    );
  }
  if (opts.debug) {
    dependencies.logger.debug(
      `ABI typings files written successfully for project "${project}"`,
    );
  }
}

export async function generateTagTypings(
  project: string,
  tag: string,
  ethokoTypingsPath: AbsolutePath,
  dependencies: {
    storageProvider: StorageProvider;
    localArtifactStore: LocalArtifactStore;
    logger: DebugLogger;
  },
  opts: { debug: boolean },
): Promise<void> {
  const ensureLocalArtifactStoreResult = await toAsyncResult(
    dependencies.localArtifactStore.ensureSetup(),
    { debug: opts.debug },
  );
  if (!ensureLocalArtifactStoreResult.success) {
    throw new CliError(
      "Error setting up Local Artifact Store, is the script not allowed to write to the filesystem? Run with debug mode for more info",
    );
  }

  const typingsFolderStatResult = await toAsyncResult(
    fs.stat(ethokoTypingsPath.resolvedPath),
    { debug: opts.debug },
  );
  if (!typingsFolderStatResult.success) {
    const typingsDirCreationResult = await toAsyncResult(
      fs.mkdir(ethokoTypingsPath.resolvedPath, { recursive: true }),
      { debug: opts.debug },
    );
    if (!typingsDirCreationResult.success) {
      throw new CliError(
        `Error creating the local Ethoko typings directory ${ethokoTypingsPath}. Is the script not allowed to write to the filesystem? Run with debug mode for more info`,
      );
    }
  }
  if (opts.debug) {
    dependencies.logger.debug(
      `Ethoko typings directory verified/created at ${ethokoTypingsPath.resolvedPath}`,
    );
  }

  const projectSummaryResult = await toAsyncResult(
    retrieveProjectSummary(project, dependencies.localArtifactStore),
    { debug: opts.debug },
  );
  if (!projectSummaryResult.success) {
    throw new CliError(
      `Error retrieving the summary for project "${project}". Run with debug mode for more info`,
    );
  }
  if (opts.debug) {
    dependencies.logger.debug(
      `Project summary retrieved successfully for project "${project}": ${JSON.stringify(projectSummaryResult.value, null, 2)}`,
    );
  }

  const filteredTagsPerContract: Record<string, string[]> = {};
  for (const [contract, tags] of Object.entries(
    projectSummaryResult.value.tagsPerContract,
  )) {
    if (tags.includes(tag)) {
      filteredTagsPerContract[contract] = [tag];
    }
  }
  const filteredContractsPerTag: Record<string, string[]> = {};
  if (projectSummaryResult.value.contractsPerTag[tag]) {
    filteredContractsPerTag[tag] =
      projectSummaryResult.value.contractsPerTag[tag];
  }
  const filteredAbisPerContractPerTag: Record<
    string,
    Record<string, unknown[]>
  > = {};
  if (projectSummaryResult.value.abisPerContractPerTag[tag]) {
    filteredAbisPerContractPerTag[tag] =
      projectSummaryResult.value.abisPerContractPerTag[tag];
  }

  if (opts.debug) {
    dependencies.logger.debug(
      `Filtered the project summary for tag "${tag}". Contracts for this tag: ${filteredContractsPerTag[tag]?.join(", ") || "None"}`,
    );
  }

  const generatedSummaryResult = await toAsyncResult(
    writeGeneratedSummaries(
      {
        [project]: {
          tagsPerContract: filteredTagsPerContract,
          contractsPerTag: filteredContractsPerTag,
        },
      },
      dependencies.localArtifactStore.rootPath,
      ethokoTypingsPath,
    ),
    { debug: opts.debug },
  );
  if (!generatedSummaryResult.success) {
    throw new CliError(
      "Unexpected error while generating the typings content. Run with debug mode for more info",
    );
  }
  if (opts.debug) {
    dependencies.logger.debug(
      `Generated typings content successfully for project "${project}"`,
    );
  }
  const writeAbisResult = await toAsyncResult(
    writeAbiTypings(
      { [project]: filteredAbisPerContractPerTag },
      ethokoTypingsPath,
    ),
    { debug: opts.debug },
  );
  if (!writeAbisResult.success) {
    throw new CliError(
      "Unexpected error while writing the ABI typings files. Run with debug mode for more info",
    );
  }
  if (opts.debug) {
    dependencies.logger.debug(
      `ABI typings files written successfully for project "${project}"`,
    );
  }
}

async function retrieveProjectSummary(
  project: string,
  localArtifactStore: LocalArtifactStore,
): Promise<{
  tagsPerContract: Record<string, string[]>;
  contractsPerTag: Record<string, string[]>;
  abisPerContractPerTag: Record<string, Record<string, unknown[]>>;
}> {
  const tags = await localArtifactStore.listTags(project);

  const tagsPerContract: Record<string, string[]> = {};
  const contractsPerTag: Record<string, string[]> = {};
  const abisPerContractPerTag: Record<string, Record<string, unknown[]>> = {};
  for (const { tag } of tags) {
    const abis = await retrieveTagAbis(project, tag, localArtifactStore);
    for (const [contractKey, abi] of Object.entries(abis.abis)) {
      if (!contractsPerTag[tag]) {
        contractsPerTag[tag] = [];
      }
      contractsPerTag[tag].push(contractKey);
      if (!tagsPerContract[contractKey]) {
        tagsPerContract[contractKey] = [];
      }
      tagsPerContract[contractKey].push(tag);
      if (!abisPerContractPerTag[tag]) {
        abisPerContractPerTag[tag] = {};
      }
      abisPerContractPerTag[tag][contractKey] = abi;
    }
  }

  return {
    tagsPerContract,
    contractsPerTag,
    abisPerContractPerTag,
  };
}

async function retrieveTagAbis(
  project: string,
  tag: string,
  localArtifactStore: LocalArtifactStore,
): Promise<{
  abis: Record<string, unknown[]>;
}> {
  const artifactId = await localArtifactStore.retrieveArtifactId(project, tag);

  const contractArtifacts = localArtifactStore.listContractArtifacts(
    project,
    artifactId,
  );

  const abis: Record<string, unknown[]> = {};

  for (const { sourceName, contractName } of await contractArtifacts) {
    const artifact = await localArtifactStore.retrieveContractOutputArtifact(
      project,
      artifactId,
      sourceName,
      contractName,
    );
    const contractKey = `${sourceName}:${contractName}`;
    const abi = artifact.output.contract.abi;
    abis[contractKey] = abi;
  }
  return { abis };
}

export async function generateEmptyTypings(
  ethokoTypingsPath: AbsolutePath,
  localArtifactStore: LocalArtifactStore,
  opts: { debug: boolean },
): Promise<void> {
  const typingsFolderStatResult = await toAsyncResult(
    fs.stat(ethokoTypingsPath.resolvedPath),
    { debug: opts.debug },
  );
  if (!typingsFolderStatResult.success) {
    const typingsDirCreationResult = await toAsyncResult(
      fs.mkdir(ethokoTypingsPath.resolvedPath, { recursive: true }),
      { debug: opts.debug },
    );
    if (!typingsDirCreationResult.success) {
      throw new CliError(
        `Error creating the local Ethoko typings directory ${ethokoTypingsPath}. Is the script not allowed to write to the filesystem? Run with debug mode for more info`,
      );
    }
  }

  const emptySummariesResult = await toAsyncResult(
    writeEmptySummaries(localArtifactStore.rootPath, ethokoTypingsPath),
    { debug: opts.debug },
  );
  if (!emptySummariesResult.success) {
    throw new CliError(
      "Error writing the empty summaries. Is the script not allowed to write to the filesystem? Run with debug mode for more info",
    );
  }

  return;
}

async function writeAbiTypings(
  abisPerContractPerTag: Record<
    string,
    Record<string, Record<string, unknown[]>>
  >,
  ethokoTypingsPath: AbsolutePath,
): Promise<void> {
  // Write all the `abis/${project}/${tag}/${sourceName}/${contractName}.d.ts` files
  for (const project in abisPerContractPerTag) {
    const projectAbisPerContractPerTag = abisPerContractPerTag[project];
    for (const tag in projectAbisPerContractPerTag) {
      const contractAbis = projectAbisPerContractPerTag[tag];
      for (const contractKey in contractAbis) {
        const [sourceName, contractName] = contractKey.split(":");
        if (!sourceName || !contractName) {
          throw new CliError(
            `Unexpected error while generating the ABI typings files. The contract key "${contractKey}" is not in the expected format "sourceName:contractName". Run with debug mode for more info`,
          );
        }
        const contractFolderPath = ethokoTypingsPath.join(
          "abis",
          project,
          tag,
          sourceName,
        );
        await fs.mkdir(contractFolderPath.resolvedPath, { recursive: true });
        const contractAbi = contractAbis[contractKey];
        const contactTypingsContent = `// THIS IS AN AUTOGENERATED FILE. EDIT AT YOUR OWN RISKS.
export type ABI = ${JSON.stringify(contractAbi, null, 4)};
        `;
        await fs.writeFile(
          contractFolderPath.join(`${contractName}.d.ts`).resolvedPath,
          contactTypingsContent,
        );
      }
    }
  }
  // Write the `abis.d.ts` file
  let abisDtsContent = `// THIS IS AN AUTOGENERATED FILE. EDIT AT YOUR OWN RISKS.\n\n`;
  abisDtsContent += `export interface ABIs {\n`;
  for (const project in abisPerContractPerTag) {
    const projectAbisPerContractPerTag = abisPerContractPerTag[project];
    abisDtsContent += `  "${project}": {\n`;
    for (const tag in projectAbisPerContractPerTag) {
      const contractAbis = projectAbisPerContractPerTag[tag];
      abisDtsContent += `    "${tag}": {\n`;
      for (const contractKey in contractAbis) {
        const [sourceName, contractName] = contractKey.split(":");
        if (!sourceName || !contractName) {
          throw new CliError(
            `Unexpected error while generating the ABI typings files. The contract key "${contractKey}" is not in the expected format "sourceName:contractName". Run with debug mode for more info`,
          );
        }

        abisDtsContent += `      "${sourceName}:${contractName}": import("./abis/${project}/${tag}/${sourceName}/${contractName}.d.js").ABI,\n`;
      }
      abisDtsContent += `    };\n`;
    }
    abisDtsContent += `  };\n`;
  }
  abisDtsContent += `}\n`;

  await fs.writeFile(
    ethokoTypingsPath.join("abis.d.ts").resolvedPath,
    abisDtsContent,
  );
}

async function writeGeneratedSummaries(
  summary: Record<
    string,
    {
      tagsPerContract: Record<string, string[]>;
      contractsPerTag: Record<string, string[]>;
    }
  >,
  ethokoPath: AbsolutePath,
  ethokoTypingsPath: AbsolutePath,
): Promise<void> {
  let generatedSummary = `// THIS IS AN AUTOGENERATED FILE. EDIT AT YOUR OWN RISKS.\n\n`;
  generatedSummary += `export const ETHOKO_PATH="${ethokoPath}";\n\n`;
  generatedSummary += `export const PROJECTS = {\n`;
  for (const project in summary) {
    const projectSummary = summary[project];
    if (!projectSummary) {
      throw Error(`Unexpected missing summary for project "${project}"`);
    }
    generatedSummary += `  "${project}": {\n`;
    generatedSummary += `    contracts: {\n`;
    for (const contract in projectSummary.tagsPerContract) {
      generatedSummary += `      "${contract}": ${JSON.stringify(
        projectSummary.tagsPerContract[contract],
      )},\n`;
    }
    generatedSummary += `    },\n`;
    generatedSummary += `    tags: {\n`;
    for (const tag in projectSummary.contractsPerTag) {
      generatedSummary += `      "${tag}": ${JSON.stringify(
        projectSummary.contractsPerTag[tag],
      )},\n`;
    }
    generatedSummary += `    },\n`;
    generatedSummary += `  },\n`;
  }
  generatedSummary += `} as const;\n`;

  await fs.writeFile(
    ethokoTypingsPath.join("summary-exports.ts").resolvedPath,
    generatedSummary,
  );

  await fs.writeFile(
    ethokoTypingsPath.join("summary.json").resolvedPath,
    JSON.stringify(
      {
        ethokoPath,
        projects: summary,
      },
      null,
      4,
    ),
  );

  await fs.writeFile(
    ethokoTypingsPath.join("index.ts").resolvedPath,
    typingsTemplate,
  );
}

async function writeEmptySummaries(
  ethokoDirectory: AbsolutePath,
  ethokoTypingsPath: AbsolutePath,
): Promise<void> {
  const emptyReleasesSummaryTsContent = `// THIS IS AN AUTOGENERATED FILE. EDIT AT YOUR OWN RISKS.
export const ETHOKO_PATH="${ethokoDirectory}";

export const PROJECTS = {} as const;
  `;
  await fs.writeFile(
    ethokoTypingsPath.join("summary-exports.ts").resolvedPath,
    emptyReleasesSummaryTsContent,
  );
  const emptyReleasesSummaryJsonContent = {
    ethokoPath: ethokoDirectory,
    projects: {},
  };
  await fs.writeFile(
    ethokoTypingsPath.join("summary.json").resolvedPath,
    JSON.stringify(emptyReleasesSummaryJsonContent, null, 4),
  );
  const emptyAbisContent = `// THIS IS AN AUTOGENERATED FILE. EDIT AT YOUR OWN RISKS.
export type ABIs = object;
  `;
  await fs.writeFile(
    ethokoTypingsPath.join("abis.d.ts").resolvedPath,
    emptyAbisContent,
  );

  await fs.writeFile(
    ethokoTypingsPath.join("index.ts").resolvedPath,
    typingsTemplate,
  );
}
