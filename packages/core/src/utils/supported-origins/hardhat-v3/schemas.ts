import z from "zod";
import { SolcJsonInputSchema } from "../../solc-artifacts-schemas/v0.8.33/input-json";
import {
  AbiItemSchema,
  SolcJsonOutputSchema,
} from "../../solc-artifacts-schemas/v0.8.33/output-json";

/**
 * # Supported formats
 *
 * We support two compilation formats for Hardhat v3 compiler output:
 * 1. The default format, obtained by running the build WITHOUT isolated build, e.g. `npx hardhat build --build-profile default`,
 * 2. The isolated build format, obtained by running the build WITH isolated build, e.g. `npx hardhat build --build-profile production`.
 *
 * Learn more about isolated builds in the Hardhat documentation: https://hardhat.org/docs/guides/writing-contracts/isolated-builds
 *
 * ## The default format
 *
 * It is obtained by running the build WITHOUT isolated build, e.g. `npx hardhat build --build-profile default`.
 * ```bash
 * # Assuming the `default` build profile is configured for non-isolated builds
 * npx hardhat build --build-profile default
 * npx hardhat build --build-profile default --force
 * npx hardhat build --build-profile default --no-test --force
 * ```
 *
 * It will output in the `artifacts` directory by default:
 * 1. a single pair of JSON files in `artifacts/build-info` directory:
 *  - one `input` file, named as `<id>.json` which contains the inputs of the compilation.
 *    It contains in particular the `userSourceNameMap` field which is a mapping from `source name` to `input source name`.
 *    The `source name` is the path of the source file, the `input source name` is a variation of it used as key in the rest of the Solc input and output.
 *    This mapping declares all the source files used in the compilation, including the ones from dependencies.
 *    See more details about artifact here: https://hardhat.org/docs/reference/artifacts#artifacts-format
 *    See the `HardhatV3CompilerInputPieceSchema` for the content of this JSON file.
 *  - one `output` file, named as `<id>.output.json` which contain the outputs of the compilation.
 *    See the `HardhatV3CompilerOutputPieceSchema` for the content of this JSON file.
 * 2. one JSON file PER contract, e.g. `artifacts/path/to/Counter.sol/Counter.json`.
 *    The filename is the name of the contract, e.g. `Counter.json`.
 *    The contract file is contained a directory named as the path of the source file, e.g. `path/to/Counter.sol/Counter.json`.
 *    See the `HardhatV3CompilerContractOutputSchema` for the content of this JSON file.
 *
 * ## The isolated build format
 *
 * It is obtained by running the build WITH isolated build, e.g. `npx hardhat build --build-profile production`.
 * ```bash
 * # Assuming the `production` build profile is configured for isolated builds
 * npx hardhat build --build-profile production
 * npx hardhat build --build-profile production --force
 * npx hardhat build --build-profile production --no-test --force
 * ```
 *
 * It will output in the `artifacts` directory by default:
 * 1. a pair of input and output JSON files for EACH contract.
 *    All the pairs are located in the `build-info` directory.
 *    Each pair has a unique ID.
 *    Each pair contains the input and output of the compilation for a single contract, including all the dependencies.
 *    In this case, the `userSourceNameMap` field in an input contains ONLY the target contract.
 * 2. one JSON file PER contract, with the same format as in the default format.
 *
 * # Format inference
 *
 * Inferences schemas are used to identify quickly the format of the candidate JSON files.
 * See `FormatInferenceHardhatV3CompilerInputPieceSchema` and `FormatInferenceHardhatV3CompilerOutputPieceSchema` for more details.
 */

export const HARDHAT_V3_COMPILER_INPUT_FORMAT = "hh3-sol-build-info-1";
export const HARDHAT_V3_COMPILER_OUTPUT_FORMAT = "hh3-sol-build-info-output-1";

export const HardhatV3CompilerInputPieceSchema = z.object({
  _format: z.literal(HARDHAT_V3_COMPILER_INPUT_FORMAT),
  id: z.string(),
  solcVersion: z.string().optional(),
  solcLongVersion: z.string(),
  userSourceNameMap: z.record(z.string(), z.string()),
  input: SolcJsonInputSchema,
});

export const HardhatV3CompilerOutputPieceSchema = z.object({
  _format: z.literal(HARDHAT_V3_COMPILER_OUTPUT_FORMAT),
  id: z.string(),
  output: SolcJsonOutputSchema,
});

// This is a smaller schema used for format inference
export const FormatInferenceHardhatV3CompilerInputPieceSchema = z.object({
  _format: z.literal(HARDHAT_V3_COMPILER_INPUT_FORMAT),
  solcLongVersion: z.string(),
  userSourceNameMap: z.record(z.string(), z.string()),
  id: z.string(),
});

// This is a smaller schema used for format inference
export const FormatInferenceHardhatV3CompilerOutputPieceSchema = z.object({
  _format: z.literal(HARDHAT_V3_COMPILER_OUTPUT_FORMAT),
  id: z.string(),
});

// Schema for output of a contract in its dedicated file
export const HardhatV3CompilerContractOutputSchema = z.object({
  _format: z.literal("hh3-artifact-1"),
  contractName: z.string(),
  sourceName: z.string(),
  abi: z.array(AbiItemSchema),
  bytecode: z.string().refine((s) => s.startsWith("0x")),
  deployedBytecode: z.string().refine((s) => s.startsWith("0x")),
  linkReferences: z.record(
    z.string(), // File name
    z.record(
      z.string(), // Library name
      z.array(
        z.object({
          start: z.number(),
          length: z.number(),
        }),
      ),
    ),
  ),
  deployedLinkReferences: z.record(
    z.string(), // File name
    z.record(
      z.string(), // Library name
      z.array(
        z.object({
          start: z.number(),
          length: z.number(),
        }),
      ),
    ),
  ),
  immutableReferences: z.json().optional(),
  inputSourceName: z.string(),
  buildInfoId: z.string(),
});
