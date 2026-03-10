import fs from "fs/promises";
import path from "path";
import { deriveEthokoArtifactId } from "@/utils/derive-ethoko-artifact-id";
import {
  EthokoContractOutputArtifact,
  EthokoInputArtifact,
} from "@/utils/ethoko-artifacts-schemas/v0";
import { ForgeCompilerOutputWithBuildInfoOptionSchema } from "./schemas";
import { lookForForgeContractArtifactPath } from "./look-for-forge-contract-artifact-paths";

/**
 * The full Forge build info format splits the contract output into multiple files in the same way as Forge default
 * But the build info files contains the full input and output for all contracts.
 *
 * We "straightforwardly" map the full build info format to the Ethoko artifact format.
 * Additionally, we retrieve all the contract artifacts paths for uploading.
 *
 * The organisation of the files is the following:
 * - build-info/
 *    - <build-info-id>.json (contains the mapping to the contract output files and full input/output)
 * - <file-name-0.sol>:
 *   - <contract-name>.json (contains the output for the contract)
 * - <file-name-1.sol>:
 *   - <contract-name>.json (contains the output for the contract)
 * - ...
 *
 * @param buildInfoPath The path to the Forge build info JSON file (the one in the build-info folder)
 * @param debug Whether to enable debug logging
 */
export async function mapForgeV1FullBuildInfoToEthokoArtifact(
  buildInfoPath: string,
  debug: boolean,
): Promise<{
  inputArtifact: EthokoInputArtifact;
  outputContractArtifacts: EthokoContractOutputArtifact[];
  originalContentPaths: string[];
}> {
  const jsonContent = await fs
    .readFile(buildInfoPath, "utf-8")
    .then(JSON.parse)
    .catch((error) => {
      if (debug) {
        console.error(
          `Failed to read or parse the build info file "${buildInfoPath}". Error: ${error}`,
        );
      }
      throw error;
    });

  const buildInfoParsingResult =
    ForgeCompilerOutputWithBuildInfoOptionSchema.safeParse(jsonContent);
  if (!buildInfoParsingResult.success) {
    if (debug) {
      console.error(
        `Failed to parse the build info file "${buildInfoPath}" as a Forge v1 full build info compiler output format. Error: ${buildInfoParsingResult.error}`,
      );
    }
    throw buildInfoParsingResult.error;
  }

  const forgeBuildInfo = buildInfoParsingResult.data;

  const contractArtifactsPaths = await retrieveForgeContractArtifactsPaths(
    buildInfoPath,
    forgeBuildInfo.source_id_to_path,
    debug,
  ).catch((error) => {
    if (debug) {
      console.error(
        `Failed to retrieve the contract artifacts paths related to the build info file "${buildInfoPath}". Error: ${error}`,
      );
    }
    throw error;
  });

  const id = deriveEthokoArtifactId(forgeBuildInfo.input);
  const inputArtifact: EthokoInputArtifact = {
    id,
    _format: "ethoko-input-v0",
    origin: {
      type: "forge-v1-with-build-info-option",
      id: forgeBuildInfo.id,
      format: forgeBuildInfo._format,
    },
    solcLongVersion: forgeBuildInfo.solcLongVersion,
    input: forgeBuildInfo.input,
  };

  const outputContractArtifacts: EthokoContractOutputArtifact[] = [];
  for (const [sourceName, contracts] of Object.entries(
    forgeBuildInfo.output.contracts,
  )) {
    for (const [contractName, contractOutput] of Object.entries(contracts)) {
      const relatedSourceObject = forgeBuildInfo.output.sources?.[sourceName];
      outputContractArtifacts.push({
        id: inputArtifact.id,
        _format: "ethoko-output-v0",
        contract: contractName,
        sourceName,
        output: {
          contract: contractOutput,
          source: relatedSourceObject,
        },
      });
    }
  }

  return {
    inputArtifact,
    outputContractArtifacts,
    originalContentPaths: contractArtifactsPaths.concat(buildInfoPath),
  };
}

async function retrieveForgeContractArtifactsPaths(
  buildInfoPath: string,
  sourceIdToPath: Record<string, string>,
  debug: boolean,
): Promise<string[]> {
  const expectedSourceIdToPath = new Map(Object.entries(sourceIdToPath));

  const buildInfoFolder = path.dirname(buildInfoPath);
  const rootArtifactsFolder = path.dirname(buildInfoFolder);

  // We keep track of the additional artifacts paths to return them at the end
  const additionalArtifactsPaths: string[] = [];

  const rebuiltSourceIdToPath = new Map<string, string>();

  for await (const {
    fullyQualifiedName,
    localArtifactPath,
    contract,
  } of lookForForgeContractArtifactPath(
    rootArtifactsFolder,
    expectedSourceIdToPath,
    debug,
  )) {
    // We register the visiter contract path with the ID
    rebuiltSourceIdToPath.set(contract.id.toString(), fullyQualifiedName.path);
    additionalArtifactsPaths.push(localArtifactPath);
  }

  // We verify that all contract paths have been visited
  // We may have differences due to contracts containing pure types, which are not output as artifacts by Forge
  if (rebuiltSourceIdToPath.size !== expectedSourceIdToPath.size) {
    const pathsNotVisited: string[] = [];
    for (const [id, path] of expectedSourceIdToPath.entries()) {
      if (!rebuiltSourceIdToPath.has(id)) {
        pathsNotVisited.push(`${path} (ID: ${id})`);
      }
    }

    if (debug) {
      console.error(
        `Some contract artifact paths were not visited during the retrieval of Forge contract artifacts. This might be due to a change in the Forge output format or contract files containing pure types. Missing contract paths:\n${pathsNotVisited.join(
          ",\n",
        )}.`,
      );
    }
  }

  return additionalArtifactsPaths;
}
