import z from "zod";
import { SolcJsonInputSchema } from "./solc-v0.8.33/input-json";
import { SolcJsonOutputSchema } from "./solc-v0.8.33/output-json";
import {
  FORGE_COMPILER_DEFAULT_OUTPUT_FORMAT,
  FORGE_COMPILER_OUTPUT_WITH_BUILD_INFO_OPTION_FORMAT,
} from "./forge-v1";
import { HARDHAT_V2_COMPILER_OUTPUT_FORMAT } from "./hardhat-v2";
import {
  HARDHAT_V3_COMPILER_OUTPUT_FORMAT,
  HARDHAT_V3_COMPILER_INPUT_FORMAT,
} from "./hardhat-v3";

const OriginSchema = z.discriminatedUnion("format", [
  z.object({
    id: z.string(),
    format: z.enum([
      FORGE_COMPILER_DEFAULT_OUTPUT_FORMAT,
      FORGE_COMPILER_OUTPUT_WITH_BUILD_INFO_OPTION_FORMAT,
      HARDHAT_V2_COMPILER_OUTPUT_FORMAT,
    ]),
  }),
  z.object({
    id: z.string(),
    format: z.literal(HARDHAT_V3_COMPILER_INPUT_FORMAT),
    outputFormat: z.literal(HARDHAT_V3_COMPILER_OUTPUT_FORMAT),
  }),
]);

/**
 * Input artifact schema for Ethoko storage
 */
export const EthokoInputArtifactSchema = z.object({
  id: z.string(),
  __format: z.literal("ethoko-input-v0"),
  origin: OriginSchema,
  solcLongVersion: z.string(),
  input: SolcJsonInputSchema,
});

/**
 * Output artifact schema for Ethoko storage
 */
export const EthokoOutputArtifactSchema = z.object({
  id: z.string(),
  __format: z.literal("ethoko-output-v0"),
  output: SolcJsonOutputSchema,
});

/**
 * Tag manifest schema for tag references
 */
export const TagManifestSchema = z.object({
  id: z.string(),
});

export type EthokoInputArtifact = z.infer<typeof EthokoInputArtifactSchema>;
export type EthokoOutputArtifact = z.infer<typeof EthokoOutputArtifactSchema>;
export type TagManifest = z.infer<typeof TagManifestSchema>;
