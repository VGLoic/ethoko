import fs from "fs/promises";
import path from "path";
import {
  EthokoArtifactOrigin,
  EthokoInputArtifact,
  EthokoOutputArtifact,
} from "@/utils/artifacts-schemas/ethoko-v0";
import {
  HardhatV3CompilerContractOutputSchema,
  HardhatV3CompilerInputPieceSchema,
  HardhatV3CompilerOutputPieceSchema,
} from "@/utils/artifacts-schemas/hardhat-v3";
import z from "zod";
import { deriveEthokoArtifactId } from "@/utils/derive-ethoko-artifact-id";
import { lookForContractArtifactPath } from "./look-for-contract-artifact-path";
import { toAsyncResult } from "@/utils/result";

/**
 * Hardhat v3 will emit pairs of input/output artifacts for each compiled contract.
 * This functions gathers the pairs and transform them into a single Ethoko artifact, by merging the input and output artifacts of each pair.
 *
 * The first pair is taken as starting point
 * For each additional pair, the input and output artifacts are merged with the current result.
 *
 * Additionally, Hardhat v3 output artifacts for each contract directly, we also look to these artifacts based on the pairs we tackled.
 * Once found, we register their paths in the original content list
 *
 * @param pairs The list of pairs of input/output artifacts paths to transform into Ethoko artifacts.
 * @param debug Whether to enable debug logging
 */
export async function hardhatV3ArtifactsToEthokoArtifact(
  pairs: {
    input: string;
    output: string;
  }[],
  debug: boolean,
): Promise<{
  inputArtifact: EthokoInputArtifact;
  outputArtifact: EthokoOutputArtifact;
  originalArtifactPaths: string[];
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

    // Input updates:
    // - Merge userSourceNameMap
    // - Merge sources
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
    // Output updates:
    // - Merge contracts
    // - Merge sources
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
  const contractArtifactsPaths = await retrieveHardhatv3ContractArtifactsPaths(
    path.dirname(firstPair.input),
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
    outputArtifact: {
      id: ethokoArtifactId,
      _format: "ethoko-output-v0",
      output: solcOutput,
    },
    originalArtifactPaths: pairs
      .flatMap((pair) => [pair.input, pair.output])
      .concat(contractArtifactsPaths),
  };
}

function readInputArtifact(
  path: string,
): Promise<z.infer<typeof HardhatV3CompilerInputPieceSchema>> {
  return fs
    .readFile(path, "utf-8")
    .then((c) => JSON.parse(c))
    .then(HardhatV3CompilerInputPieceSchema.parse);
}

function readOutputArtifact(
  path: string,
): Promise<z.infer<typeof HardhatV3CompilerOutputPieceSchema>> {
  return fs
    .readFile(path, "utf-8")
    .then((c) => JSON.parse(c))
    .then(HardhatV3CompilerOutputPieceSchema.parse);
}

async function retrieveHardhatv3ContractArtifactsPaths(
  buildInfoDirectoryPath: string,
  buildInfoIds: string[],
  userSourceNameMap: Record<string, string>,
  debug: boolean,
): Promise<string[]> {
  const rootArtifactsFolder = path.dirname(buildInfoDirectoryPath);

  const buildInfoIdsSet = new Set(buildInfoIds);

  const expectedUserSourceNameMap = new Map(Object.entries(userSourceNameMap));

  const rebuiltSourceNameMap = new Map();
  const paths = [];

  for await (const contractArtifactPath of lookForContractArtifactPath(
    rootArtifactsFolder,
  )) {
    const contractContentResult = await toAsyncResult(
      fs.readFile(contractArtifactPath, "utf-8").then((content) => {
        const rawParsing = JSON.parse(content);
        return HardhatV3CompilerContractOutputSchema.parse(rawParsing);
      }),
      { debug },
    );
    if (!contractContentResult.success) {
      if (debug) {
        console.warn(
          `Failed to parse contract artifact at path "${contractArtifactPath}". Skipping it. Error: ${contractContentResult.error}`,
        );
      }
      continue;
    }
    const contract = contractContentResult.value;
    if (!buildInfoIdsSet.has(contract.buildInfoId)) {
      if (debug) {
        console.warn(
          `Found compilation artifact at path "${contractArtifactPath}" but does not have the same build info ID than the input/output. Skipping it.`,
        );
      }
      continue;
    }
    if (!expectedUserSourceNameMap.has(contract.sourceName)) {
      if (debug) {
        console.warn(
          `Found compilation artifact at path "${contractArtifactPath}" but does not belong to the expected user source name map. Skipping it.`,
        );
      }
      continue;
    }

    rebuiltSourceNameMap.set(contract.sourceName, contract.inputSourceName);
    paths.push(contractArtifactPath);
  }

  if (rebuiltSourceNameMap.size !== expectedUserSourceNameMap.size) {
    if (debug) {
      console.warn(
        `The number of visited contract artifacts (${rebuiltSourceNameMap.size}) does not match the number of expected contract artifacts (${expectedUserSourceNameMap.size})`,
      );
    }
    throw new Error(
      `The number of visited contract artifacts (${rebuiltSourceNameMap.size}) does not match the number of expected contract artifacts (${expectedUserSourceNameMap.size})`,
    );
  }

  return paths;
}
