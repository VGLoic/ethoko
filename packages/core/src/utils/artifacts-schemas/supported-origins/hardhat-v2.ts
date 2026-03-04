import z from "zod";
import { SolcJsonInputSchema } from "./solc-v0.8.33/input-json";
import { SolcJsonOutputSchema } from "./solc-v0.8.33/output-json";

/**
 * # Supported format
 *
 * We support one output format for Hardhat v2 compiler output.
 * As far as we know, this is the only one.
 *
 * It is obtained by running `npx hardhat compile` with Hardhat v2.
 * ```bash
 * npx hardhat compile
 * npx hardhat compile --no-typechain
 * npx hardhat compile --force
 * ```
 *
 * It will output a single JSON file in the `artifacts/build-info` directory by default.
 * The filename is the `id` field of the JSON content with a `.json` extension, e.g. `artifacts/build-info/1234567890abcdef.json`.
 * This file contains all the information about the compilation, including the input and output of the compiler, as well as additional information such as the solc version used for the compilation.
 * See the `HardhatV2CompilerOutputSchema` for the content of this JSON file.
 *
 * # Format inference
 *
 * Inferences schemas are used to identify quickly the format of the candidate JSON files.
 * See `FormatInferenceHardhatV2CompilerOutputSchema`.
 */

export const HARDHAT_V2_COMPILER_OUTPUT_FORMAT = "hh-sol-build-info-1";

export const HardhatV2CompilerOutputSchema = z.object({
  id: z.string(),
  _format: z.literal(HARDHAT_V2_COMPILER_OUTPUT_FORMAT),
  solcVersion: z.string().optional(),
  solcLongVersion: z.string(),
  input: SolcJsonInputSchema,
  output: SolcJsonOutputSchema,
});

// This is a smaller schema used for format inference
export const FormatInferenceHardhatV2CompilerOutputSchema = z.object({
  _format: z.literal(HARDHAT_V2_COMPILER_OUTPUT_FORMAT),
});
