import fs from "fs/promises";
import path from "path";

import { LocalStorage } from "../local-storage";
import { toAsyncResult } from "../utils/result";
import { CliError } from "./error";

/**
 * Based from the Ethoko releases folder content, generate a `summary-exports.ts`, a `summary.json` and a `index.ts` files in the Ethoko typings folder.
 * This file contains the PROJECTS object that maps the project name to the contracts and tags.
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
 *
 * It consists of the following steps:
 * 1. Set up the local storage and the typings folder
 * 2. Read the projects, tags and contracts from the local storage and generate a summary object
 * 3. If no projects are found, generate empty summaries and typings files. Otherwise, generate the content of the `summary-exports.ts` file and write all the typings files to the typings folder.
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

  // project -> contract -> tag
  const summary: Record<
    string,
    {
      tagsPerContract: Record<string, string[]>;
      contractsPerTag: Record<string, string[]>;
      abisPerContract: Record<string, unknown[]>;
    }
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
    const abisPerContract: Record<string, unknown[]> = {};
    for (const { tag } of tagsResult.value) {
      if (!contractsPerTag[tag]) {
        contractsPerTag[tag] = [];
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
        if (!abisPerContract[contractKey]) {
          abisPerContract[contractKey] =
            artifactResult.value.output.contract.abi;
        }
      }
    }
    summary[project] = { tagsPerContract, contractsPerTag, abisPerContract };
  }
  // Generate the `generate/summary-exports.ts` content
  let generatedSummary = `// THIS IS AN AUTOGENERATED FILE. EDIT AT YOUR OWN RISKS.\n\n`;
  generatedSummary += `export const ETHOKO_PATH="${localStorage.rootPath}";\n\n`;
  generatedSummary += `export const PROJECTS = {\n`;
  for (const project in summary) {
    const projectSummary = summary[project];
    if (!projectSummary) {
      throw new CliError(
        `Unexpected missing summary for project "${project}". Run with debug mode for more info`,
      );
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
    generatedSummary += `    abis: {\n`;
    for (const contract in projectSummary.abisPerContract) {
      generatedSummary += `      "${contract}": ${JSON.stringify(
        projectSummary.abisPerContract[contract],
      )} as const,\n`;
    }
    generatedSummary += `    },\n`;
    generatedSummary += `  },\n`;
  }
  generatedSummary += `} as const;\n`;

  const writeSummariesResult = await toAsyncResult(
    writeSummaries(
      ethokoTypingsPath,
      localStorage.rootPath,
      generatedSummary,
      summary,
    ),
    { debug: opts.debug },
  );
  if (!writeSummariesResult.success) {
    throw new CliError(
      "Unexpected error while writing typings files. Run with debug mode for more info",
    );
  }
}

function generateEmptyReleasesSummaryTsContent(ethokoDirectory: string) {
  return `// THIS IS AN AUTOGENERATED FILE. EDIT AT YOUR OWN RISKS.
  export const ETHOKO_PATH="${ethokoDirectory}";
  
  export const PROJECTS = {} as const;
  `;
}
function generateEmptyReleasesSummaryJsonContent(ethokoPath: string) {
  return {
    ethokoPath,
    projects: {},
  };
}

async function writeSummaries(
  ethokoTypingsPath: string,
  ethokoPath: string,
  generatedSummary: string,
  summary: Record<
    string,
    {
      tagsPerContract: Record<string, string[]>;
      contractsPerTag: Record<string, string[]>;
      abisPerContract: Record<string, unknown[]>;
    }
  >,
): Promise<void> {
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

  // The path contains a `..` because the `typings.txt` file is mapped to the `dist/typings.txt` file while the CLI client methods are under `dist/cli-client/`
  const typingsTemplate = await fs.readFile(
    path.join(__dirname, "..", "typings.txt"),
    "utf-8",
  );

  await fs.writeFile(`${ethokoTypingsPath}/index.ts`, typingsTemplate);
}

async function writeEmptySummaries(
  ethokoDirectory: string,
  ethokoTypingsPath: string,
): Promise<void> {
  await fs.writeFile(
    `${ethokoTypingsPath}/summary-exports.ts`,
    generateEmptyReleasesSummaryTsContent(ethokoDirectory),
  );
  await fs.writeFile(
    `${ethokoTypingsPath}/summary.json`,
    JSON.stringify(
      generateEmptyReleasesSummaryJsonContent(ethokoDirectory),
      null,
      4,
    ),
  );

  // The path contains a `..` because the `typings.txt` file is mapped to the `dist/typings.txt` file while the CLI client methods are under `dist/cli-client/`
  const typingsTemplate = await fs.readFile(
    path.join(__dirname, "..", "typings.txt"),
    "utf-8",
  );

  await fs.writeFile(`${ethokoTypingsPath}/index.ts`, typingsTemplate);
}
