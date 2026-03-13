import {
  inferForgeArtifact,
  type InferredForgeArtifacts,
} from "./forge-v1/infer-artifact";
import {
  inferHardhatV3Artifact,
  type InferredHardhatV3Artifacts,
} from "./hardhat-v3/infer-artifact";
import {
  inferHardhatV2Artifact,
  type InferredHardhatV2Artifacts,
} from "./hardhat-v2/infer-artifact";

export type InferredArtifact =
  | {
      format: "forge-v1-default";
      data: InferredForgeArtifacts["forge-v1-default"];
    }
  | {
      format: "forge-v1-with-build-info-option";
      data: InferredForgeArtifacts["forge-v1-with-build-info-option"];
    }
  | {
      format: "hardhat-v3-input-no-isolated-build";
      data: InferredHardhatV3Artifacts["hardhat-v3-input-no-isolated-build"];
    }
  | {
      format: "hardhat-v3-input-isolated-build";
      data: InferredHardhatV3Artifacts["hardhat-v3-input-isolated-build"];
    }
  | {
      format: "hardhat-v3-output";
      data: InferredHardhatV3Artifacts["hardhat-v3-output"];
    }
  | {
      format: "hardhat-v2";
      data: InferredHardhatV2Artifacts["hardhat-v2"];
    };

/**
 * Infer the original artifact format from the given data, which may be in any supported format.
 * The inference is done by trying to parse the data with the inference schemas for each supported format, and returning the first one that matches.
 * @param data JSON parsed data of a build info JSON file
 * @returns The inferred artifact format and the parsed data if recognized, or recognized: false if the format is not recognized
 */
export function inferOriginalArtifactFormat(data: unknown):
  | {
      recognized: true;
      artifact: InferredArtifact;
    }
  | {
      recognized: false;
    } {
  const forgeResult = inferForgeArtifact(data);
  if (forgeResult.recognized) {
    if (forgeResult.artifact.format === "forge-v1-default") {
      return { recognized: true, artifact: forgeResult.artifact };
    }
    if (forgeResult.artifact.format === "forge-v1-with-build-info-option") {
      return { recognized: true, artifact: forgeResult.artifact };
    }

    forgeResult.artifact satisfies never; // This ensures that if a new format is added to the InferredForgeArtifact union type, we will get a type error here reminding us to handle it in this function
  }

  const hardhatV3Result = inferHardhatV3Artifact(data);
  if (hardhatV3Result.recognized) {
    if (
      hardhatV3Result.artifact.format === "hardhat-v3-input-no-isolated-build"
    ) {
      return { recognized: true, artifact: hardhatV3Result.artifact };
    }
    if (hardhatV3Result.artifact.format === "hardhat-v3-input-isolated-build") {
      return { recognized: true, artifact: hardhatV3Result.artifact };
    }
    if (hardhatV3Result.artifact.format === "hardhat-v3-output") {
      return { recognized: true, artifact: hardhatV3Result.artifact };
    }

    hardhatV3Result.artifact satisfies never; // This ensures that if a new format is added to the InferredHardhatV3Artifact union type, we will get a type error here reminding us to handle it in this function
  }

  const hardhatV2Result = inferHardhatV2Artifact(data);
  if (hardhatV2Result.recognized) {
    if (hardhatV2Result.artifact.format === "hardhat-v2") {
      return { recognized: true, artifact: hardhatV2Result.artifact };
    }

    hardhatV2Result.artifact.format satisfies never; // This ensures that if a new format is added to the InferredHardhatV2Artifact union type, we will get a type error here reminding us to handle it in this function
  }

  return { recognized: false };
}
