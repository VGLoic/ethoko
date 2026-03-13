import z from "zod";

import { SolcJsonInputSchema } from "../../solc-artifacts-schemas/v0.8.33/input-json";
import {
  AbiItemSchema,
  BytecodeSchema,
  SolcJsonOutputSchema,
} from "../../solc-artifacts-schemas/v0.8.33/output-json";
import { ContractMetadataSchema } from "../../solc-artifacts-schemas/v0.8.33/contract-metadata-json";

/**
 * Forge version at the time of writing: v1.6
 *
 * # Supported formats
 *
 * We support two compilation formats for Forge compiler output:
 * 1. The `default` format, obtained by running `forge build` without the `--build-info` option,
 * 2. The `build-info` format, obtained by running `forge build --build-info`.
 *
 *
 * ## The `default` format
 *
 * It is obtained by running `forge build` without the `--build-info` option.
 * ```bash
 * forge build
 * forge build --use-literal-content
 * forge build --use-literal-content --force
 * ```
 *
 * It will output in the `out` directory by default:
 * 1. one JSON file in `out/build-info` directory. This file is very small and only contains:
 *  - the `id` field, which is a string that probably uniquely identifies the compilation, it is a guess,
 *  - the `language` field, which is the programming language used,
 *  - the `source_id_to_path` field, which is a mapping from contract ID as number (e.g. "0", "1", etc.) to the source file path.
 *    See the `ForgeCompilerDefaultOutputSchema` for the content of this JSON file.
 * 2. one JSON file PER contract, e.g. `out/Counter.sol/Counter.json`.
 *    The filename is the name of the contract, e.g. `Counter.json`.
 *    The contract file is contained a directory named as either:
 *     - either the filename containing the contract, e.g. `Counter.sol`. It will be the usual case when there is no conflict on the filename, e.g. `path/to/Counter.sol` and `path/to/other/Counter.sol`,
 *     - either the full path of the contract in case of conflict on the filename, e.g. `path/to/other/Counter.sol/Counter.json`. Note that the "first" `Counter.json` may be without the full path, e.g. in `Counter.sol/Counter.json`.
 *    See the `ForgeCompilerContractOutputSchema` for the content of the contract JSON file.
 *
 *
 * ## The `build-info` format
 *
 * It is obtained by running `forge build --build-info`.
 * ```bash
 * forge build --build-info
 * forge build --build-info --use-literal-content
 * forge build --build-info --use-literal-content --force
 * ```
 *
 * It will output in the `out` directory by default:
 * 1. one JSON file in `out/build-info` directory.
 *    This file is much larger than the one in the `default` format and contains all the information about the compilation, including the input and output of the compiler, as well as additional information such as the solc version used for the compilation.
 *    See the `ForgeCompilerOutputWithBuildInfoOptionSchema` for the content of this JSON file.
 * 2. one JSON file PER contract, with the same format as in the `default` format.
 *
 * # Format inference
 *
 * Inferences schemas are used to identify quickly the format of the candidate JSON files.
 * See `FormatInferenceForgeCompilerOutputDefaultFormatSchema` and `FormatInferenceForgeCompilerOutputWithBuildInfoOptionSchema`.
 */

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
