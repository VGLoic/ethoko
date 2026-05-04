import { LocalArtifactStore } from "../local-artifact-store";
import { toAsyncResult } from "@/utils/result";
import { CliError } from "./error";
import type { EthokoInputArtifact } from "@/ethoko-artifacts/v0";
import { ResolvedArtifactKey } from "@/utils/artifact-key";
import { DebugLogger } from "@/utils/debug-logger";

export type InspectResult = {
  project: string;
  tag: string | null;
  id: string;
  origin:
    | {
        id: string;
        format: "forge" | "hardhat-v2" | "hardhat-v3-non-isolated-build";
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
};

/**
 * Inspect a locally pulled artifact to identify contracts and metadata.
 *
 * @throws CliError if the artifact cannot be found or read.
 */
export async function inspectArtifact(
  artifactKey: ResolvedArtifactKey,
  dependencies: {
    localArtifactStore: LocalArtifactStore;
    logger: DebugLogger;
  },
  opts: { debug: boolean },
): Promise<InspectResult> {
  const ensureResult = await toAsyncResult(
    dependencies.localArtifactStore.ensureProjectSetup(artifactKey.project),
    { debug: opts.debug },
  );
  if (!ensureResult.success) {
    throw new CliError(
      "Error setting up Local Artifact Store, is the script not allowed to write to the filesystem? Run with debug mode for more info",
    );
  }

  const artifactsResult = await toAsyncResult(
    Promise.all([
      dependencies.localArtifactStore.retrieveInputArtifact(
        artifactKey.project,
        artifactKey.id,
      ),
      dependencies.localArtifactStore.listContractArtifacts(
        artifactKey.project,
        artifactKey.id,
      ),
    ]),
    { debug: opts.debug },
  );
  if (!artifactsResult.success) {
    throw new CliError(
      "Unable to retrieve the artifact content from the Local Artifact Store, please ensure it exists locally. Run with debug mode for more info",
    );
  }
  const [inputArtifact, contractList] = artifactsResult.value;
  if (opts.debug) {
    dependencies.logger.debug(
      `Pulled artifact retrieved successfully for artifact "${artifactKey.project}@${artifactKey.id}".\nInput artifact details: ${JSON.stringify(inputArtifact, null, 2)}.\nContract list: ${JSON.stringify(contractList, null, 2)}`,
    );
  }

  const compilerSettings = deriveCompilerSettings(inputArtifact);

  const origin =
    inputArtifact.origin.type === "hardhat-v3"
      ? {
          format: "hardhat-v3" as const,
          ids: inputArtifact.origin.pairs.map((pair) => pair.id),
        }
      : inputArtifact.origin.type === "hardhat-v3-non-isolated-build"
        ? {
            format: "hardhat-v3-non-isolated-build" as const,
            id: inputArtifact.origin.id,
          }
        : {
            format:
              inputArtifact.origin.type === "hardhat-v2"
                ? ("hardhat-v2" as const)
                : ("forge" as const),
            id: inputArtifact.origin.id,
          };

  return {
    project: artifactKey.project,
    tag: artifactKey.tag,
    id: inputArtifact.id,
    origin,
    compiler: compilerSettings,
    sourceFiles: Object.keys(inputArtifact.input.sources).sort(),
    contractsBySource: deriveContractsBySource(contractList),
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
  contracts: { sourceName: string; contractName: string }[],
): InspectResult["contractsBySource"] {
  const gatheredContracts: Record<string, string[]> = {};
  for (const { sourceName, contractName } of contracts) {
    if (!gatheredContracts[sourceName]) {
      gatheredContracts[sourceName] = [];
    }
    gatheredContracts[sourceName].push(contractName);
  }

  const entries: InspectResult["contractsBySource"] = [];
  for (const sourcePath of Object.keys(gatheredContracts).sort()) {
    const contracts = gatheredContracts[sourcePath];
    if (!contracts) {
      continue;
    }
    entries.push({
      sourcePath,
      contracts: contracts.sort(),
    });
  }
  return entries;
}
