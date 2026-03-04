import {
  EthokoInputArtifact,
  EthokoOutputArtifact,
} from "../ethoko-artifacts-schemas/v0";
import { mapForgeV1DefaultArtifactToEthokoArtifact } from "./forge-v1/map-default-to-ethoko-artifact";
import { mapForgeV1FullBuildInfoToEthokoArtifact } from "./forge-v1/map-full-build-info-to-ethoko-artifact";
import { mapHardhatV2ArtifactToEthokoArtifact } from "./hardhat-v2/map-to-ethoko-artifact";
import { mapHardhatV3ArtifactsToEthokoArtifact } from "./hardhat-v3/map-isolated-build-to-ethoko-artifact";

export type OriginalBuildInfoPaths =
  | {
      format:
        | "forge-v1-default"
        | "forge-v1-with-build-info-option"
        | "hardhat-v2";
      buildInfoPath: string;
    }
  | {
      // TODO: handle isolated build
      format: "hardhat-v3";
      buildInfoPaths: {
        input: string;
        output: string;
      }[];
    };
/**
 * Given the paths description of an original artifact, map it to Ethoko artifacts.
 * The mapping is done by reading the original artifact(s) from the given path(s), parsing them, and then transforming them to the Ethoko input and output artifact formats.
 * @param paths The paths to the original artifact(s) to map, along with the format of the original artifact(s)
 * @param debug The debug flag to enable debug logging during the mapping process
 * @returns The mapped Ethoko input and output artifacts, along with the paths to the original content files that were read during the mapping process
 */
export function mapOriginalArtifactToEthokoArtifact(
  paths: OriginalBuildInfoPaths,
  debug: boolean,
): Promise<{
  inputArtifact: EthokoInputArtifact;
  outputArtifact: EthokoOutputArtifact;
  originalContentPaths: string[];
}> {
  if (paths.format === "hardhat-v3") {
    return mapHardhatV3ArtifactsToEthokoArtifact(paths.buildInfoPaths, debug);
  } else if (paths.format === "hardhat-v2") {
    return mapHardhatV2ArtifactToEthokoArtifact(paths.buildInfoPath, debug);
  } else if (paths.format === "forge-v1-with-build-info-option") {
    return mapForgeV1FullBuildInfoToEthokoArtifact(paths.buildInfoPath, debug);
  } else if (paths.format === "forge-v1-default") {
    return mapForgeV1DefaultArtifactToEthokoArtifact(
      paths.buildInfoPath,
      debug,
    );
  } else {
    throw new Error(
      `Unsupported artifact format: ${paths.format satisfies never}. Please provide a valid build info JSON file.`,
    );
  }
}
