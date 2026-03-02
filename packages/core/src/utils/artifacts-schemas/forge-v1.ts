import z from "zod";

import { SolcJsonInputSchema } from "./solc-v0.8.33/input-json";
import {
  AbiItemSchema,
  BytecodeSchema,
  SolcJsonOutputSchema,
} from "./solc-v0.8.33/output-json";
import { ContractMetadataSchema } from "./solc-v0.8.33/contract-metadata-json";

// Forge version at the time of writing: v1.6

export const FORGE_COMPILER_OUTPUT_WITH_BUILD_INFO_OPTION_FORMAT =
  "ethers-rs-sol-build-info-1";

export const ForgeCompilerOutputWithBuildInfoOptionSchema = z.object({
  id: z.string(),
  // Mapping from contract ID as number (e.g. "0", "1", etc.) to the source file path
  // This is needed to resolve the source files when the output JSON doesn't include the source file paths.
  source_id_to_path: z.record(z.string(), z.string()),
  language: z.enum(["Solidity", "Yul", "SolidityAST", "EVMAssembly"]),
  _format: z.literal(FORGE_COMPILER_OUTPUT_WITH_BUILD_INFO_OPTION_FORMAT),
  input: SolcJsonInputSchema.extend({
    // Repeat of the solc version
    version: z.string().optional(),
    // Additional paths
    allowPaths: z.array(z.string()).optional(),
    basePath: z.string().optional(),
    includePaths: z.array(z.string()).optional(),
  }),
  output: SolcJsonOutputSchema,
  solcLongVersion: z.string(),
  solcVersion: z.string().optional(),
});

export const ForgeCompilerDefaultOutputSchema = z.strictObject({
  id: z.string(),
  // Mapping from contract "number" (e.g. "0", "1", etc.) to the source file path
  // This is needed to resolve the source files when the output JSON doesn't include the source file paths.
  source_id_to_path: z.record(z.string(), z.string()),
  language: z.enum(["Solidity", "Yul", "SolidityAST", "EVMAssembly"]),
});

export const ForgeCompilerContractOutputSchema = z.object({
  abi: z.array(AbiItemSchema),
  bytecode: BytecodeSchema,
  deployedBytecode: BytecodeSchema.extend({
    immutableReferences: z.json().optional(),
  }),
  methodIdentifiers: z.record(z.string(), z.string()).optional(),
  rawMetadata: z.string().optional(),
  metadata: ContractMetadataSchema.optional(),
  // ID as number (e.g. 0, 1, etc.) of the contract, used to resolve the source file path from the "source_id_to_path" field in the output JSON.
  id: z.number().int(),
});

// This is a smaller schema used for format inference
export const FormatInferenceForgeCompilerOutputDefaultFormatSchema =
  ForgeCompilerDefaultOutputSchema;

// This is a smaller schema used for format inference
export const FormatInferenceForgeCompilerOutputWithBuildInfoOptionSchema =
  z.object({
    _format: z.literal(FORGE_COMPILER_OUTPUT_WITH_BUILD_INFO_OPTION_FORMAT),
  });
