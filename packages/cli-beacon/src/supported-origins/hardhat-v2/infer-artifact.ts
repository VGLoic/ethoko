import z from "zod";
import { FormatInferenceHardhatV2CompilerOutputSchema } from "./schemas";

export type InferredHardhatV2Artifacts = {
  "hardhat-v2": z.infer<typeof FormatInferenceHardhatV2CompilerOutputSchema>;
};
type InferredHardhatV2BuildInfo = {
  [K in keyof InferredHardhatV2Artifacts]: {
    origin: K;
    data: InferredHardhatV2Artifacts[K];
  };
}[keyof InferredHardhatV2Artifacts];

export function inferHardhatV2Artifact(data: unknown):
  | {
      recognized: true;
      artifact: InferredHardhatV2BuildInfo;
    }
  | {
      recognized: false;
    } {
  const result = FormatInferenceHardhatV2CompilerOutputSchema.safeParse(data);
  if (result.success) {
    return {
      recognized: true,
      artifact: { origin: "hardhat-v2", data: result.data },
    };
  }
  return { recognized: false };
}
