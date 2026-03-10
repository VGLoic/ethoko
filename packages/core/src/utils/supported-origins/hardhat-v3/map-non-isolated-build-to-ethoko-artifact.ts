import path from "path";
import {
  EthokoContractOutputArtifact,
  EthokoInputArtifact,
  EthokoOutputArtifact,
} from "@/utils/ethoko-artifacts-schemas/v0";
import { deriveEthokoArtifactId } from "@/utils/derive-ethoko-artifact-id";
import {
  readInputArtifact,
  readOutputArtifact,
  retrieveHardhatv3ContractArtifactsPaths,
} from "./helpers";

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
    input: string;
    output: string;
  },
  debug: boolean,
): Promise<{
  inputArtifact: EthokoInputArtifact;
  outputArtifact: EthokoOutputArtifact;
  outputContractArtifacts: EthokoContractOutputArtifact[];
  originalContentPaths: string[];
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

  const contractArtifactsPaths = await retrieveHardhatv3ContractArtifactsPaths(
    path.dirname(pair.input),
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
    outputArtifact: {
      id: ethokoArtifactId,
      _format: "ethoko-output-v0",
      output: solcOutput,
    },
    outputContractArtifacts,
    originalContentPaths: [pair.input, pair.output].concat(
      contractArtifactsPaths,
    ),
  };
}
