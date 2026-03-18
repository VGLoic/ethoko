import {
  EthokoContractOutputArtifact,
  EthokoInputArtifact,
} from "@/ethoko-artifacts/v0";
import { deriveEthokoArtifactId } from "@/ethoko-artifacts/derive-ethoko-artifact-id";
import {
  readInputArtifact,
  readOutputArtifact,
  retrieveHardhatv3ContractArtifactsPaths,
} from "./helpers";
import { AbsolutePath, RelativePath } from "@/utils/path";

/**
 * Hardhat v3 non isolated build will emit a single pair of input/output artifacts
 *
 * Additionally, Hardhat v3 output artifacts for each contract directly, we also look to these artifacts based on the pairs we tackled.
 * Once found, we register their paths in the original content list
 *
 * @param pairs The list of pairs of input/output artifacts paths to transform into Ethoko artifacts.
 * @param debug Whether to enable debug logging
 */
export async function mapNonIsolatedBuildHardhatV3ArtifactsToEthokoArtifact(
  pair: {
    input: AbsolutePath;
    output: AbsolutePath;
  },
  debug: boolean,
): Promise<{
  inputArtifact: EthokoInputArtifact;
  outputContractArtifacts: EthokoContractOutputArtifact[];
  originalContent: {
    rootPath: AbsolutePath;
    paths: RelativePath[];
  };
}> {
  const inputArtifact = await readInputArtifact(pair.input);
  const outputArtifact = await readOutputArtifact(pair.output);

  const solcLongVersion = inputArtifact.solcLongVersion;
  const userSourceNameMap = inputArtifact.userSourceNameMap;

  const solcInput = inputArtifact.input;
  const solcOutput = outputArtifact.output;
  const ethokoArtifactId = deriveEthokoArtifactId(solcInput);

  const outputContractArtifacts: EthokoContractOutputArtifact[] = [];
  for (const [sourceName, contracts] of Object.entries(solcOutput.contracts)) {
    for (const [contractName, contractOutput] of Object.entries(contracts)) {
      const relatedSourceObject = solcOutput.sources?.[sourceName];
      outputContractArtifacts.push({
        id: ethokoArtifactId,
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

  const buildInfoDirPath = pair.input.dirname();
  const rootPath = buildInfoDirPath.dirname();

  const contractArtifactsPaths = await retrieveHardhatv3ContractArtifactsPaths(
    buildInfoDirPath,
    [inputArtifact.id],
    userSourceNameMap,
    debug,
  );
  return {
    inputArtifact: {
      id: ethokoArtifactId,
      _format: "ethoko-input-v0",
      origin: {
        type: "hardhat-v3-non-isolated-build",
        id: inputArtifact.id,
        pair: {
          inputFormat: inputArtifact._format,
          outputFormat: outputArtifact._format,
        },
      },
      solcLongVersion,
      input: solcInput,
    },
    outputContractArtifacts,
    originalContent: {
      rootPath,
      paths: [pair.input, pair.output]
        .concat(contractArtifactsPaths)
        .map((p) => p.relativeTo(rootPath)),
    },
  };
}
