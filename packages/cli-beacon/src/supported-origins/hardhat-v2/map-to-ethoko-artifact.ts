import fs from "fs/promises";
import { HardhatV2CompilerOutputSchema } from "./schemas";
import { deriveEthokoArtifactId } from "@/ethoko-artifacts/derive-ethoko-artifact-id";
import {
  EthokoContractOutputArtifact,
  EthokoInputArtifact,
} from "@/ethoko-artifacts/v0";
import { AbsolutePath, RelativePath } from "@/utils/path";

export async function mapHardhatV2ArtifactToEthokoArtifact(
  buildInfoPath: AbsolutePath,
  debug: boolean,
): Promise<{
  inputArtifact: EthokoInputArtifact;
  outputContractArtifacts: EthokoContractOutputArtifact[];
  originalContent: {
    rootPath: AbsolutePath;
    paths: RelativePath[];
  };
}> {
  const jsonContent = await fs
    .readFile(buildInfoPath.resolvedPath, "utf-8")
    .then(JSON.parse)
    .catch((error) => {
      if (debug) {
        console.error(
          `Failed to read or parse the build info file "${buildInfoPath.resolvedPath}". Error: ${error}`,
        );
      }
      throw error;
    });

  const parsingResult = HardhatV2CompilerOutputSchema.safeParse(jsonContent);
  if (!parsingResult.success) {
    if (debug) {
      console.error(
        `Failed to parse the build info file "${buildInfoPath.resolvedPath}" as a Hardhat v2 compiler output format. Error: ${parsingResult.error}`,
      );
    }
    throw parsingResult.error;
  }

  const id = deriveEthokoArtifactId(parsingResult.data.input);
  const inputArtifact: EthokoInputArtifact = {
    id,
    _format: "ethoko-input-v0",
    origin: {
      type: "hardhat-v2",
      id: parsingResult.data.id,
      format: parsingResult.data._format,
    },
    solcLongVersion: parsingResult.data.solcLongVersion,
    input: parsingResult.data.input,
  };
  const outputContractArtifacts: EthokoContractOutputArtifact[] = [];
  for (const [sourceName, contracts] of Object.entries(
    parsingResult.data.output.contracts,
  )) {
    for (const [contractName, contractOutput] of Object.entries(contracts)) {
      const relatedSourceObject =
        parsingResult.data.output.sources?.[sourceName];
      outputContractArtifacts.push({
        id,
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

  const buildInfoDirPath = buildInfoPath.dirname();
  const rootPath = buildInfoDirPath.dirname();

  return {
    inputArtifact,
    outputContractArtifacts,
    originalContent: {
      rootPath,
      paths: [buildInfoPath.relativeTo(rootPath)],
    },
  };
}
