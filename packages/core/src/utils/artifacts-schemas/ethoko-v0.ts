import z from "zod";
import { SolcJsonInputSchema } from "./solc-v0.8.33/input-json";
import { SolcJsonOutputSchema } from "./solc-v0.8.33/output-json";
import { FORGE_COMPILER_OUTPUT_WITH_BUILD_INFO_OPTION_FORMAT } from "./forge-v1";
import { HARDHAT_V2_COMPILER_OUTPUT_FORMAT } from "./hardhat-v2";
import {
  HARDHAT_V3_COMPILER_OUTPUT_FORMAT,
  HARDHAT_V3_COMPILER_INPUT_FORMAT,
} from "./hardhat-v3";

const EthokoArtifactOriginSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.string(),
    type: z.literal("forge-v1.6-default"),
  }),
  z.object({
    id: z.string(),
    type: z.literal("forge-v1.6-build-info"),
    format: z.literal(FORGE_COMPILER_OUTPUT_WITH_BUILD_INFO_OPTION_FORMAT),
  }),
  z.object({
    id: z.string(),
    type: z.literal("hardhat-v2"),
    format: z.literal(HARDHAT_V2_COMPILER_OUTPUT_FORMAT),
  }),
  z.object({
    type: z.literal("hardhat-v3"),
    pairs: z.array(
      z.object({
        id: z.string(),
        inputFormat: z.literal(HARDHAT_V3_COMPILER_INPUT_FORMAT),
        outputFormat: z.literal(HARDHAT_V3_COMPILER_OUTPUT_FORMAT),
      }),
    ),
  }),
]);

export type EthokoArtifactOrigin = z.infer<typeof EthokoArtifactOriginSchema>;

/**
 * Input artifact schema for Ethoko storage
 */
export const EthokoInputArtifactSchema = z.object({
  id: z.string(),
  _format: z.literal("ethoko-input-v0"),
  origin: EthokoArtifactOriginSchema,
  solcLongVersion: z.string(),
  input: SolcJsonInputSchema,
});

/**
 * Output artifact schema for Ethoko storage
 */
export const EthokoOutputArtifactSchema = z.object({
  id: z.string(),
  _format: z.literal("ethoko-output-v0"),
  output: SolcJsonOutputSchema,
});

/**
 * Tag manifest schema for tag references
 */
export const TagManifestSchema = z.object({
  id: z.string(),
});

const LinkReferencesSchema = z.record(
  z.string(),
  z.record(
    z.string(),
    z.array(
      z.object({
        length: z.number(),
        start: z.number(),
      }),
    ),
  ),
);

const HexPrefixedStringSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]*$/) as z.ZodType<`0x${string}`>;

const ContractBytecodeSchema = z.object({
  functionDebugData: z.json().optional(),
  object: z.string(),
  opcodes: z.string().optional(),
  sourceMap: z.string().optional(),
  generatedSources: z.array(z.json()).optional(),
  linkReferences: LinkReferencesSchema,
});

/**
 * Contract artifact schema for export
 */
export const EthokoContractArtifactSchema = z.object({
  _format: z.literal("ethoko-contract-artifact-v0"),
  id: z.string(),
  project: z.string(),
  abi: z.array(z.unknown()),
  metadata: z.string(),
  bytecode: HexPrefixedStringSchema,
  deployedBytecode: HexPrefixedStringSchema,
  linkReferences: LinkReferencesSchema,
  deployedLinkReferences: LinkReferencesSchema,
  contractName: z.string(),
  sourceName: z.string(),
  userdoc: z.unknown().optional(),
  devdoc: z.unknown().optional(),
  storageLayout: z.unknown().optional(),
  evm: z.object({
    assembly: z.string().optional(),
    bytecode: ContractBytecodeSchema,
    deployedBytecode: ContractBytecodeSchema.extend({
      immutableReferences: z.unknown().optional(),
    }).optional(),
    gasEstimates: z
      .object({
        creation: z.record(z.string(), z.string()).optional(),
        external: z.record(z.string(), z.string()).optional(),
        internal: z.record(z.string(), z.string()).optional(),
      })
      .optional(),
    methodIdentifiers: z.record(z.string(), z.string()).optional(),
  }),
});

export type EthokoInputArtifact = z.infer<typeof EthokoInputArtifactSchema>;
export type EthokoOutputArtifact = z.infer<typeof EthokoOutputArtifactSchema>;
export type TagManifest = z.infer<typeof TagManifestSchema>;
export type EthokoContractArtifact = z.infer<
  typeof EthokoContractArtifactSchema
>;
