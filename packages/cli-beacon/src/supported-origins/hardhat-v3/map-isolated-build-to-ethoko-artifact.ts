import path from "path";
import {
  EthokoArtifactOrigin,
  EthokoContractOutputArtifact,
  EthokoInputArtifact,
} from "@/ethoko-artifacts/v0";
import { deriveEthokoArtifactId } from "@/ethoko-artifacts/derive-ethoko-artifact-id";
import {
  readInputArtifact,
  readOutputArtifact,
  retrieveHardhatv3ContractArtifactsPaths,
} from "./helpers";

/**
 * Hardhat v3 isolated build will emit pairs of input/output artifacts for each compiled contract.
 * This functions gathers the pairs and creates the merged input and multiple output ethoko artifacts.
 *
 * The first pair is taken as starting point
 * For each additional pair
 *  - the input artifact sources is merged with the current result,
 *  - for each contract of the output artifact, we build the associated Ethoko contract output artifact
 *
 * Additionally, Hardhat v3 output artifacts for each contract directly, we also look to these artifacts based on the pairs we tackled.
 * Once found, we register their paths in the original content list
 *
 * @param pairs The list of pairs of input/output artifacts paths to transform into Ethoko artifacts.
 * @param debug Whether to enable debug logging
 */
export async function mapHardhatV3ArtifactsToEthokoArtifact(
  pairs: {
    input: string;
    output: string;
  }[],
  debug: boolean,
): Promise<{
  inputArtifact: EthokoInputArtifact;
  outputContractArtifacts: EthokoContractOutputArtifact[];
  originalContent: {
    rootPath: string;
    paths: string[];
  };
}> {
  const firstPair = pairs.at(0);
  if (!firstPair) {
    throw new Error("Empty pairs list");
  }

  const firstInputArtifact = await readInputArtifact(firstPair.input);
  const firstOutputArtifact = await readOutputArtifact(firstPair.output);

  const solcVersion = firstInputArtifact.solcVersion;
  const solcLongVersion = firstInputArtifact.solcLongVersion;
  const userSourceNameMap = firstInputArtifact.userSourceNameMap;
  const originPairs: Extract<
    EthokoArtifactOrigin,
    { type: "hardhat-v3" }
  >["pairs"] = [
    {
      id: firstInputArtifact.id,
      inputFormat: firstInputArtifact._format,
      outputFormat: firstOutputArtifact._format,
    },
  ];

  const solcInput = firstInputArtifact.input;
  const solcOutput = firstOutputArtifact.output;

  for (const pair of pairs.slice(1)) {
    const inputArtifact = await readInputArtifact(pair.input);
    if (
      inputArtifact.solcLongVersion !== solcLongVersion ||
      inputArtifact.solcVersion !== solcVersion
    ) {
      throw new Error(
        `Inconsistent solc version in input artifacts: expected ${solcLongVersion} (${solcVersion}), got ${inputArtifact.solcLongVersion} (${inputArtifact.solcVersion}) in artifact ${pair.input}`,
      );
    }

    // Updates from input:
    // - Merge userSourceNameMap
    // - Merge input sources
    for (const [userSourceName, sourceName] of Object.entries(
      inputArtifact.userSourceNameMap,
    )) {
      userSourceNameMap[userSourceName] = sourceName;
    }
    for (const [sourceName, sourceContent] of Object.entries(
      inputArtifact.input.sources,
    )) {
      if (!solcInput.sources[sourceName]) {
        // New source, we add it to the input
        solcInput.sources[sourceName] = sourceContent;
      } else {
        solcInput.sources[sourceName] = {
          ...solcInput.sources[sourceName],
          ...sourceContent,
        };
      }
    }

    const outputArtifact = await readOutputArtifact(pair.output);
    // Updates from output:
    // - Merge contracts in output
    // - Merge sources in output
    for (const [filePath, fileValue] of Object.entries(
      outputArtifact.output.contracts,
    )) {
      if (!solcOutput.contracts[filePath]) {
        // New file, we add it to the output
        solcOutput.contracts[filePath] = fileValue;
      } else {
        solcOutput.contracts[filePath] = {
          ...solcOutput.contracts[filePath],
          ...fileValue,
        };
      }
    }
    if (outputArtifact.output.sources) {
      if (!solcOutput.sources) {
        solcOutput.sources = {};
      }
      for (const [sourceName, sourceContent] of Object.entries(
        outputArtifact.output.sources,
      )) {
        solcOutput.sources[sourceName] = sourceContent;
      }
    }

    originPairs.push({
      id: inputArtifact.id,
      inputFormat: inputArtifact._format,
      outputFormat: outputArtifact._format,
    });
  }

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

  const buildInfoDirPath = path.dirname(firstPair.output);
  const rootPath = path.dirname(buildInfoDirPath);

  const contractArtifactsPaths = await retrieveHardhatv3ContractArtifactsPaths(
    buildInfoDirPath,
    originPairs.map((p) => p.id),
    userSourceNameMap,
    debug,
  );

  return {
    inputArtifact: {
      id: ethokoArtifactId,
      _format: "ethoko-input-v0",
      origin: {
        type: "hardhat-v3",
        pairs: originPairs,
      },
      solcLongVersion,
      input: solcInput,
    },
    outputContractArtifacts,
    originalContent: {
      rootPath,
      paths: pairs
        .flatMap((pair) => [pair.input, pair.output])
        .concat(contractArtifactsPaths)
        .map((p) => path.relative(rootPath, p)),
    },
  };
}
