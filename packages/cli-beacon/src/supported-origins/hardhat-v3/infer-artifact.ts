import z from "zod";
import {
  FormatInferenceHardhatV3CompilerInputPieceSchema,
  FormatInferenceHardhatV3CompilerOutputPieceSchema,
} from "./schemas";

export type InferredHardhatV3Artifacts = {
  "hardhat-v3-input-no-isolated-build": z.infer<
    typeof FormatInferenceHardhatV3CompilerInputPieceSchema
  >;
  "hardhat-v3-input-isolated-build": z.infer<
    typeof FormatInferenceHardhatV3CompilerInputPieceSchema
  >;
  "hardhat-v3-output": z.infer<
    typeof FormatInferenceHardhatV3CompilerOutputPieceSchema
  >;
};
type InferredHardhatV3BuildInfo = {
  [K in keyof InferredHardhatV3Artifacts]: {
    origin: K;
    data: InferredHardhatV3Artifacts[K];
  };
}[keyof InferredHardhatV3Artifacts];

export function inferHardhatV3Artifact(data: unknown):
  | {
      recognized: true;
      artifact: InferredHardhatV3BuildInfo;
    }
  | {
      recognized: false;
    } {
  const outputFormatResult =
    FormatInferenceHardhatV3CompilerOutputPieceSchema.safeParse(data);
  if (outputFormatResult.success) {
    return {
      recognized: true,
      artifact: { origin: "hardhat-v3-output", data: outputFormatResult.data },
    };
  }

  const inputFormatResult =
    FormatInferenceHardhatV3CompilerInputPieceSchema.safeParse(data);
  if (inputFormatResult.success) {
    const hasASingleUserSource =
      Object.keys(inputFormatResult.data.userSourceNameMap).length === 1;
    // A single user source means that the build can be considered as "isolated"
    // i.e. the artifact is about this single contract
    if (hasASingleUserSource) {
      return {
        recognized: true,
        artifact: {
          origin: "hardhat-v3-input-isolated-build",
          data: inputFormatResult.data,
        },
      };
    } else {
      return {
        recognized: true,
        artifact: {
          origin: "hardhat-v3-input-no-isolated-build",
          data: inputFormatResult.data,
        },
      };
    }
  }

  return { recognized: false };
}
