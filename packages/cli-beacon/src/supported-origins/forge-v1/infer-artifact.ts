import z from "zod";
import {
  FormatInferenceForgeCompilerOutputDefaultFormatSchema,
  FormatInferenceForgeCompilerOutputWithBuildInfoOptionSchema,
} from "./schemas";

export type InferredForgeArtifacts = {
  "forge-v1-default": z.infer<
    typeof FormatInferenceForgeCompilerOutputDefaultFormatSchema
  >;
  "forge-v1-with-build-info-option": z.infer<
    typeof FormatInferenceForgeCompilerOutputWithBuildInfoOptionSchema
  >;
};
type InferredForgeBuildInfo = {
  [K in keyof InferredForgeArtifacts]: {
    origin: K;
    data: InferredForgeArtifacts[K];
  };
}[keyof InferredForgeArtifacts];

export function inferForgeArtifact(data: unknown):
  | {
      recognized: true;
      artifact: InferredForgeBuildInfo;
    }
  | {
      recognized: false;
    } {
  const defaultFormatResult =
    FormatInferenceForgeCompilerOutputDefaultFormatSchema.safeParse(data);
  if (defaultFormatResult.success) {
    return {
      recognized: true,
      artifact: { origin: "forge-v1-default", data: defaultFormatResult.data },
    };
  }
  const withBuildInfoOptionResult =
    FormatInferenceForgeCompilerOutputWithBuildInfoOptionSchema.safeParse(data);
  if (withBuildInfoOptionResult.success) {
    return {
      recognized: true,
      artifact: {
        origin: "forge-v1-with-build-info-option",
        data: withBuildInfoOptionResult.data,
      },
    };
  }
  return { recognized: false };
}
