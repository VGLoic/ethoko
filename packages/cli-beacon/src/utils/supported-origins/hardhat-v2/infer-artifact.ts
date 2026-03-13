import z from "zod";
import { FormatInferenceHardhatV2CompilerOutputSchema } from "./schemas";

export type InferredHardhatV2Artifacts = {
  "hardhat-v2": z.infer<typeof FormatInferenceHardhatV2CompilerOutputSchema>;
};
type InferredArtifact = {
  [K in keyof InferredHardhatV2Artifacts]: {
    format: K;
    data: InferredHardhatV2Artifacts[K];
  };
}[keyof InferredHardhatV2Artifacts];

export function inferHardhatV2Artifact(data: unknown):
  | {
      recognized: true;
      artifact: InferredArtifact;
    }
  | {
      recognized: false;
    } {
  const result = FormatInferenceHardhatV2CompilerOutputSchema.safeParse(data);
  if (result.success) {
    return {
      recognized: true,
      artifact: { format: "hardhat-v2", data: result.data },
    };
  }
  return { recognized: false };
}
