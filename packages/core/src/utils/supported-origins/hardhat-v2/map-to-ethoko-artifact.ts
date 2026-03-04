import fs from "fs/promises";
import { HardhatV2CompilerOutputSchema } from "./schemas";
import { deriveEthokoArtifactId } from "@/utils/derive-ethoko-artifact-id";
import {
  EthokoInputArtifact,
  EthokoOutputArtifact,
} from "@/utils/ethoko-artifacts-schemas/v0";

export async function mapHardhatV2ArtifactToEthokoArtifact(
  buildInfoPath: string,
  debug: boolean,
): Promise<{
  inputArtifact: EthokoInputArtifact;
  outputArtifact: EthokoOutputArtifact;
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

  const parsingResult = HardhatV2CompilerOutputSchema.safeParse(jsonContent);
  if (!parsingResult.success) {
    if (debug) {
      console.error(
        `Failed to parse the build info file "${buildInfoPath}" as a Hardhat v2 compiler output format. Error: ${parsingResult.error}`,
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
  const outputArtifact: EthokoOutputArtifact = {
    id,
    _format: "ethoko-output-v0",
    output: parsingResult.data.output,
  };
  return {
    inputArtifact,
    outputArtifact,
    originalContentPaths: [buildInfoPath],
  };
}
