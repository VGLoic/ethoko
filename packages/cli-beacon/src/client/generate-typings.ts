import fs from "fs/promises";
// Note: we load the template content directly here
// The ideal would be to work only with the path but it does not work right now with tsup (and NPM package) AND Bun (and binaries)
// There is a plan to migrate everything to Bun in the future, and rely on Bun's file loading capabilities, but in the meantime we need to support both environments
import typingsTemplate from "../../templates/typings.txt";
import { LocalStorage } from "../local-storage/local-storage";
import { toAsyncResult } from "../utils/result";
import { CliError } from "./error";

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
 * 1. Set up the local storage and the typings folder
 * 2. Read the projects, tags and contracts from the local storage and generate a summary object
 * 3. If no projects are found, generate empty summaries and typings files.
 *    Otherwise, generate the content of the `summary-exports.ts` file and write all the typings files to the typings folder.
 *
 * @throws CliError if there is an error while reading local storage or writing typings files.
 */
export async function generateArtifactsSummariesAndTypings(
  ethokoTypingsPath: string,
  localStorage: LocalStorage,
  opts: { debug: boolean; silent?: boolean },
): Promise<void> {
  const ensureLocalStorageResult = await toAsyncResult(
    localStorage.ensureSetup(),
    { debug: opts.debug },
  );
  if (!ensureLocalStorageResult.success) {
    throw new CliError(
      "Error setting up local storage, is the script not allowed to write to the filesystem? Run with debug mode for more info",
    );
  }

  const typingsFolderStatResult = await toAsyncResult(
    fs.stat(ethokoTypingsPath),
    { debug: opts.debug },
  );
  if (!typingsFolderStatResult.success) {
    const typingsDirCreationResult = await toAsyncResult(
      fs.mkdir(ethokoTypingsPath, { recursive: true }),
      { debug: opts.debug },
    );
    if (!typingsDirCreationResult.success) {
      throw new CliError(
        `Error creating the local Ethoko typings directory ${ethokoTypingsPath}. Is the script not allowed to write to the filesystem? Run with debug mode for more info`,
      );
    }
  }

  const projectsResult = await toAsyncResult(localStorage.listProjects(), {
    debug: opts.debug,
  });
  if (!projectsResult.success) {
    throw new CliError(
      "Error listing the projects. Is the script not allowed to read from the filesystem? Run with debug mode for more info",
    );
  }
  const projects = projectsResult.value;
  if (projects.length === 0) {
    const emptySummariesResult = await toAsyncResult(
      writeEmptySummaries(localStorage.rootPath, ethokoTypingsPath),
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
    const tagsResult = await toAsyncResult(localStorage.listTags(project), {
      debug: opts.debug,
    });
    if (!tagsResult.success) {
      throw new CliError(
        `Error listing the tags for project "${project}". Run with debug mode for more info`,
      );
    }
    const tagsPerContract: Record<string, string[]> = {};
    const contractsPerTag: Record<string, string[]> = {};
    const projectAbisPerContractPerTag: Record<
      string,
      Record<string, unknown[]>
    > = {};
    for (const { tag } of tagsResult.value) {
      if (!contractsPerTag[tag]) {
        contractsPerTag[tag] = [];
      }
      if (!projectAbisPerContractPerTag[tag]) {
        projectAbisPerContractPerTag[tag] = {};
      }
      const artifactIdResult = await toAsyncResult(
        localStorage.retrieveArtifactId(project, tag),
        { debug: opts.debug },
      );
      if (!artifactIdResult.success) {
        throw new CliError(
          `The artifact ${project}:${tag} does not have an associated artifact ID. Please pull again. Run with debug mode for more info`,
        );
      }
      const contractArtifactsResult = await toAsyncResult(
        localStorage.listContractArtifacts(project, artifactIdResult.value),
        { debug: opts.debug },
      );
      if (!contractArtifactsResult.success) {
        throw new CliError(
          `Error listing the artifacts for project "${project}" and tag "${tag}". Run with debug mode for more info`,
        );
      }
      for (const {
        sourceName,
        contractName,
      } of contractArtifactsResult.value) {
        const artifactResult = await toAsyncResult(
          localStorage.retrieveContractOutputArtifact(
            project,
            artifactIdResult.value,
            sourceName,
            contractName,
          ),
          { debug: opts.debug },
        );
        if (!artifactResult.success) {
          throw new CliError(
            `Error retrieving the artifact for project "${project}:${tag}" and contract "${sourceName}:${contractName}". Run with debug mode for more info`,
          );
        }
        const contractKey = `${sourceName}:${contractName}`;
        contractsPerTag[tag].push(contractKey);
        if (!tagsPerContract[contractKey]) {
          tagsPerContract[contractKey] = [];
        }
        tagsPerContract[contractKey].push(tag);
        if (!projectAbisPerContractPerTag[tag][contractKey]) {
          projectAbisPerContractPerTag[tag][contractKey] =
            artifactResult.value.output.contract.abi;
        }
      }
    }
    summary[project] = {
      tagsPerContract,
      contractsPerTag,
    };
    abisPerContractPerTag[project] = projectAbisPerContractPerTag;
  }

  const generatedSummaryResult = await toAsyncResult(
    writeGeneratedSummaries(summary, localStorage.rootPath, ethokoTypingsPath),
    { debug: opts.debug },
  );
  if (!generatedSummaryResult.success) {
    throw new CliError(
      "Unexpected error while generating the typings content. Run with debug mode for more info",
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
}

async function writeAbiTypings(
  abisPerContractPerTag: Record<
    string,
    Record<string, Record<string, unknown[]>>
  >,
  ethokoTypingsPath: string,
): Promise<void> {
  // Write all the `abis/${project}/${tag}/${sourceName}/${contractName}.d.ts` files
  for (const project in abisPerContractPerTag) {
    const projectAbisPerContractPerTag = abisPerContractPerTag[project];
    for (const tag in projectAbisPerContractPerTag) {
      const contractAbis = projectAbisPerContractPerTag[tag];
      for (const contractKey in contractAbis) {
        const [sourceName, contractName] = contractKey.split(":");
        const contractFolderPath = `${ethokoTypingsPath}/abis/${project}/${tag}/${sourceName}`;
        await fs.mkdir(contractFolderPath, { recursive: true });
        const contractAbi = contractAbis[contractKey];
        const contactTypingsContent = `// THIS IS AN AUTOGENERATED FILE. EDIT AT YOUR OWN RISKS.
export type ABI = ${JSON.stringify(contractAbi, null, 4)};
        `;
        await fs.writeFile(
          `${contractFolderPath}/${contractName}.d.ts`,
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
        abisDtsContent += `      "${sourceName}:${contractName}": import("./abis/${project}/${tag}/${sourceName}/${contractName}.d.js").ABI,\n`;
      }
      abisDtsContent += `    };\n`;
    }
    abisDtsContent += `  };\n`;
  }
  abisDtsContent += `}\n`;

  await fs.writeFile(`${ethokoTypingsPath}/abis.d.ts`, abisDtsContent);
}

async function writeGeneratedSummaries(
  summary: Record<
    string,
    {
      tagsPerContract: Record<string, string[]>;
      contractsPerTag: Record<string, string[]>;
    }
  >,
  ethokoPath: string,
  ethokoTypingsPath: string,
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
    `${ethokoTypingsPath}/summary-exports.ts`,
    generatedSummary,
  );

  await fs.writeFile(
    `${ethokoTypingsPath}/summary.json`,
    JSON.stringify(
      {
        ethokoPath,
        projects: summary,
      },
      null,
      4,
    ),
  );

  await fs.writeFile(`${ethokoTypingsPath}/index.ts`, typingsTemplate);
}

async function writeEmptySummaries(
  ethokoDirectory: string,
  ethokoTypingsPath: string,
): Promise<void> {
  const emptyReleasesSummaryTsContent = `// THIS IS AN AUTOGENERATED FILE. EDIT AT YOUR OWN RISKS.
export const ETHOKO_PATH="${ethokoDirectory}";

export const PROJECTS = {} as const;
  `;
  await fs.writeFile(
    `${ethokoTypingsPath}/summary-exports.ts`,
    emptyReleasesSummaryTsContent,
  );
  const emptyReleasesSummaryJsonContent = {
    ethokoPath: ethokoDirectory,
    projects: {},
  };
  await fs.writeFile(
    `${ethokoTypingsPath}/summary.json`,
    JSON.stringify(emptyReleasesSummaryJsonContent, null, 4),
  );
  const emptyAbisContent = `// THIS IS AN AUTOGENERATED FILE. EDIT AT YOUR OWN RISKS.
export type ABIs = object;
  `;
  await fs.writeFile(`${ethokoTypingsPath}/abis.d.ts`, emptyAbisContent);

  await fs.writeFile(`${ethokoTypingsPath}/index.ts`, typingsTemplate);
}
