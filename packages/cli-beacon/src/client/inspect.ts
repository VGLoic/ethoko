import { PulledArtifactStore } from "../pulled-artifact-store/pulled-artifact-store";
import { toAsyncResult } from "@/utils/result";
import { CliError } from "./error";
import type { EthokoInputArtifact } from "@/ethoko-artifacts/v0";

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
  artifact: {
    project: string;
    search: { type: "tag"; tag: string } | { type: "id"; id: string };
  },
  pulledArtifactStore: PulledArtifactStore,
  opts: { debug: boolean; silent?: boolean },
): Promise<InspectResult> {
  const ensureResult = await toAsyncResult(
    pulledArtifactStore.ensureProjectSetup(artifact.project),
    { debug: opts.debug },
  );
  if (!ensureResult.success) {
    throw new CliError(
      "Error setting up pulled artifact store, is the script not allowed to write to the filesystem? Run with debug mode for more info",
    );
  }

  let artifactId: string;
  if (artifact.search.type === "id") {
    artifactId = artifact.search.id;
  } else {
    const artifactIdResult = await toAsyncResult(
      pulledArtifactStore.retrieveArtifactId(
        artifact.project,
        artifact.search.tag,
      ),
      { debug: opts.debug },
    );
    if (!artifactIdResult.success) {
      throw new CliError(
        `The artifact ${artifact.project}:${artifact.search.tag} does not have an associated artifact ID. Please pull again. Run with debug mode for more info`,
      );
    }
    artifactId = artifactIdResult.value;
  }

  const artifactsResult = await toAsyncResult(
    Promise.all([
      pulledArtifactStore.retrieveInputArtifact(artifact.project, artifactId),
      pulledArtifactStore.listContractArtifacts(artifact.project, artifactId),
    ]),
    { debug: opts.debug },
  );
  if (!artifactsResult.success) {
    throw new CliError(
      "Unable to retrieve the artifact content from the pulled artifact store, please ensure it exists locally. Run with debug mode for more info",
    );
  }
  const [inputArtifact, contractList] = artifactsResult.value;

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
    project: artifact.project,
    tag: artifact.search.type === "tag" ? artifact.search.tag : null,
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
