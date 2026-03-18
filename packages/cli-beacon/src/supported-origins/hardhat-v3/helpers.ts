import fs from "fs/promises";
import {
  HardhatV3CompilerContractOutputSchema,
  HardhatV3CompilerInputPieceSchema,
  HardhatV3CompilerOutputPieceSchema,
} from "@/supported-origins/hardhat-v3/schemas";
import z from "zod";
import { lookForContractArtifactPath } from "@/supported-origins/utils/look-for-contract-artifact-path";
import { toAsyncResult } from "@/utils/result";
import { AbsolutePath } from "@/utils/path";

export function readInputArtifact(
  path: AbsolutePath,
): Promise<z.infer<typeof HardhatV3CompilerInputPieceSchema>> {
  return fs
    .readFile(path.resolvedPath, "utf-8")
    .then((c) => JSON.parse(c))
    .then(HardhatV3CompilerInputPieceSchema.parse);
}

export function readOutputArtifact(
  path: AbsolutePath,
): Promise<z.infer<typeof HardhatV3CompilerOutputPieceSchema>> {
  return fs
    .readFile(path.resolvedPath, "utf-8")
    .then((c) => JSON.parse(c))
    .then(HardhatV3CompilerOutputPieceSchema.parse);
}

export async function retrieveHardhatv3ContractArtifactsPaths(
  buildInfoDirectoryPath: AbsolutePath,
  buildInfoIds: string[],
  userSourceNameMap: Record<string, string>,
  debug: boolean,
): Promise<AbsolutePath[]> {
  const rootArtifactsFolder = buildInfoDirectoryPath.dirname();

  const buildInfoIdsSet = new Set(buildInfoIds);

  const expectedUserSourceNameMap = new Map(Object.entries(userSourceNameMap));

  const rebuiltSourceNameMap = new Map();
  const paths = [];

  for await (const contractArtifactPath of lookForContractArtifactPath(
    rootArtifactsFolder,
  )) {
    const contractContentResult = await toAsyncResult(
      fs
        .readFile(contractArtifactPath.resolvedPath, "utf-8")
        .then((content) => {
          const rawParsing = JSON.parse(content);
          return HardhatV3CompilerContractOutputSchema.parse(rawParsing);
        }),
      { debug },
    );
    if (!contractContentResult.success) {
      if (debug) {
        console.warn(
          `Failed to parse contract artifact at path "${contractArtifactPath.resolvedPath}". Skipping it. Error: ${contractContentResult.error}`,
        );
      }
      continue;
    }
    const contract = contractContentResult.value;
    if (!buildInfoIdsSet.has(contract.buildInfoId)) {
      if (debug) {
        console.warn(
          `Found compilation artifact at path "${contractArtifactPath.resolvedPath}" but does not have the same build info ID than the input/output. Skipping it.`,
        );
      }
      continue;
    }
    if (!expectedUserSourceNameMap.has(contract.sourceName)) {
      if (debug) {
        console.warn(
          `Found compilation artifact at path "${contractArtifactPath.resolvedPath}" but does not belong to the expected user source name map. Skipping it.`,
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
