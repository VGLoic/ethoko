import fs from "fs/promises";
import path from "path";

import { StepTracker } from "@/cli-ui/utils";
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
  const steps = new StepTracker(3, opts.silent);

  steps.start("Setting up local storage and typings folder...");
  const ensureLocalStorageResult = await toAsyncResult(
    localStorage.ensureSetup(),
    { debug: opts.debug },
  );
  if (!ensureLocalStorageResult.success) {
    steps.fail("Failed to setup local storage");
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
      steps.fail("Failed to setup typings folder");
      throw new CliError(
        `Error creating the local Ethoko typings directory ${ethokoTypingsPath}. Is the script not allowed to write to the filesystem? Run with debug mode for more info`,
      );
    }
  }
  steps.succeed("Local storage and typings folder ready");

  steps.start("Processing projects and generating summaries...");
  const projectsResult = await toAsyncResult(localStorage.listProjects(), {
    debug: opts.debug,
  });
  if (!projectsResult.success) {
    steps.fail("Failed to list projects");
    throw new CliError(
      "Error listing the projects. Is the script not allowed to read from the filesystem? Run with debug mode for more info",
    );
  }
  const projects = projectsResult.value;
  if (projects.length === 0) {
    steps.warn("No projects have been found. Generating an empty summary.");
    steps.start("Writing typings files...");
    const emptySummariesResult = await toAsyncResult(
      writeEmptySummaries(localStorage.rootPath, ethokoTypingsPath),
      { debug: opts.debug },
    );
    if (!emptySummariesResult.success) {
      steps.fail("Failed to write typings files");
      throw new CliError(
        "Error writing the empty summaries. Is the script not allowed to write to the filesystem? Run with debug mode for more info",
      );
    }

    steps.succeed("Typings generated successfully");
    return;
  }

  // project -> contract -> tag
  const summary: Record<
    string,
    {
      tagsPerContract: Record<string, string[]>;
      contractsPerTag: Record<string, string[]>;
    }
  > = {};

  for (const project of projects) {
    const tagsResult = await toAsyncResult(localStorage.listTags(project), {
      debug: opts.debug,
    });
    if (!tagsResult.success) {
      steps.fail("Failed to list project tags");
      throw new CliError(
        `Error listing the tags for project "${project}". Run with debug mode for more info`,
      );
    }
    const tagsPerContract: Record<string, string[]> = {};
    const contractsPerTag: Record<string, string[]> = {};
    for (const { tag } of tagsResult.value) {
      if (!contractsPerTag[tag]) {
        contractsPerTag[tag] = [];
      }
      const artifactResult = await toAsyncResult(
        localStorage.retrieveOutputArtifactByTag(project, tag),
        { debug: opts.debug },
      );
      if (!artifactResult.success) {
        steps.fail("Failed to retrieve artifacts");
        throw new CliError(
          `Error retrieving the artifact for project "${project}" and tag "${tag}". Run with debug mode for more info`,
        );
      }
      for (const contractPath in artifactResult.value.output.contracts) {
        const contracts = artifactResult.value.output.contracts[contractPath];
        for (const contractName in contracts) {
          const contractKey = `${contractPath}:${contractName}`;
          contractsPerTag[tag].push(contractKey);
          if (!tagsPerContract[contractKey]) {
            tagsPerContract[contractKey] = [];
          }
          tagsPerContract[contractKey].push(tag);
        }
      }
    }
    summary[project] = { tagsPerContract, contractsPerTag };
  }
  steps.succeed("Summaries generated");

  steps.start("Writing typings files...");
  // Generate the `generate/summary-exports.ts` content
  let generatedSummary = `// THIS IS AN AUTOGENERATED FILE. EDIT AT YOUR OWN RISKS.\n\n`;
  generatedSummary += `export const ETHOKO_PATH="${localStorage.rootPath}";\n\n`;
  generatedSummary += `export const PROJECTS = {\n`;
  for (const project in summary) {
    const projectSummary = summary[project];
    if (!projectSummary) {
      steps.fail("Failed to generate summaries");
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
    steps.fail("Failed to write typings files");
    throw new CliError(
      "Unexpected error while writing typings files. Run with debug mode for more info",
    );
  }

  steps.succeed("Typings generated successfully");
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
