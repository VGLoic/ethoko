import fs from "fs/promises";

import { LocalStorage } from "../local-storage";
import { toAsyncResult } from "../utils/result";
import { CliError } from "./error";
import type {
  EthokoInputArtifact,
  EthokoOutputArtifact,
} from "../utils/artifacts-schemas/ethoko-v0";

export type InspectResult = {
  project: string;
  tag: string | null;
  id: string;
  origin:
    | {
        id: string;
        format: "forge" | "hardhat-v2";
      }
    | {
        format: "hardhat-v3";
        ids: string[];
      };
  compiler: {
    solcLongVersion: string;
    evmVersion: string;
    optimizer: {
      enabled: boolean;
      runs: number;
    };
    remappings: string[];
  };
  sourceFiles: string[];
  contractsBySource: Array<{
    sourcePath: string;
    contracts: string[];
  }>;
  artifacts: {
    input: {
      path: string;
      size: number;
    };
    output: {
      path: string;
      size: number;
    };
  };
};

/**
 * Inspect a locally pulled artifact to identify contracts and metadata.
 *
 * @throws CliError if the artifact cannot be found or read.
 */
export async function inspectArtifact(
  artifact: {
    project: string;
    search: { type: "tag"; tag: string } | { type: "id"; id: string };
  },
  localStorage: LocalStorage,
  opts: { debug: boolean; silent?: boolean },
): Promise<InspectResult> {
  const ensureResult = await toAsyncResult(
    localStorage.ensureProjectSetup(artifact.project),
    { debug: opts.debug },
  );
  if (!ensureResult.success) {
    throw new CliError(
      "Error setting up local storage, is the script not allowed to write to the filesystem? Run with debug mode for more info",
    );
  }

  const artifactResult = await toAsyncResult(
    artifact.search.type === "tag"
      ? Promise.all([
          localStorage.retrieveInputArtifactByTag(
            artifact.project,
            artifact.search.tag,
          ),
          localStorage.retrieveOutputArtifactByTag(
            artifact.project,
            artifact.search.tag,
          ),
        ])
      : Promise.all([
          localStorage.retrieveInputArtifactById(
            artifact.project,
            artifact.search.id,
          ),
          localStorage.retrieveOutputArtifactById(
            artifact.project,
            artifact.search.id,
          ),
        ]),
    { debug: opts.debug },
  );
  if (!artifactResult.success) {
    throw new CliError(
      "Unable to retrieve the artifact content, please ensure it exists locally. Run with debug mode for more info",
    );
  }
  const [inputArtifact, outputArtifact] = artifactResult.value;

  const inputArtifactPath = `${localStorage.rootPath}/${artifact.project}/ids/${inputArtifact.id}/input.json`;
  const outputArtifactPath = `${localStorage.rootPath}/${artifact.project}/ids/${inputArtifact.id}/output.json`;

  const fileStatResult = await toAsyncResult(
    Promise.all([fs.stat(inputArtifactPath), fs.stat(outputArtifactPath)]),
    { debug: opts.debug },
  );
  if (!fileStatResult.success) {
    throw new CliError(
      "Unable to read the artifact files size, please ensure they exist locally. Run with debug mode for more info",
    );
  }
  const [inputStat, outputStat] = fileStatResult.value;

  const compilerSettings = deriveCompilerSettings(inputArtifact);

  const origin =
    inputArtifact.origin.type === "hardhat-v3"
      ? {
          format: "hardhat-v3" as const,
          ids: inputArtifact.origin.pairs.map((pair) => pair.id),
        }
      : {
          format:
            inputArtifact.origin.type === "hardhat-v2"
              ? ("hardhat-v2" as const)
              : ("forge" as const),
          id: inputArtifact.origin.id,
        };

  return {
    project: artifact.project,
    tag: artifact.search.type === "tag" ? artifact.search.tag : null,
    id: inputArtifact.id,
    origin,
    compiler: compilerSettings,
    sourceFiles: Object.keys(inputArtifact.input.sources).sort(),
    contractsBySource: deriveContractsBySource(outputArtifact),
    artifacts: {
      input: {
        path: inputArtifactPath,
        size: inputStat.size,
      },
      output: {
        path: outputArtifactPath,
        size: outputStat.size,
      },
    },
  };
}

function deriveCompilerSettings(
  artifact: EthokoInputArtifact,
): InspectResult["compiler"] {
  const settings = artifact.input.settings;
  const optimizer = settings?.optimizer;

  return {
    solcLongVersion: artifact.solcLongVersion,
    evmVersion: settings?.evmVersion ?? "default",
    optimizer: {
      enabled: optimizer?.enabled ?? false,
      runs: optimizer?.runs ?? 200,
    },
    remappings: settings?.remappings ?? [],
  };
}

function deriveContractsBySource(
  artifact: EthokoOutputArtifact,
): InspectResult["contractsBySource"] {
  const entries: InspectResult["contractsBySource"] = [];
  for (const sourcePath of Object.keys(artifact.output.contracts).sort()) {
    const contracts = artifact.output.contracts[sourcePath];
    if (!contracts) {
      continue;
    }
    entries.push({
      sourcePath,
      contracts: Object.keys(contracts).sort(),
    });
  }
  return entries;
}
