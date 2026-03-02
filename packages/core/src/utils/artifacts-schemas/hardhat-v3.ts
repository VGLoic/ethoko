import z from "zod";
import { SolcJsonInputSchema } from "./solc-v0.8.33/input-json";
import {
  AbiItemSchema,
  SolcJsonOutputSchema,
} from "./solc-v0.8.33/output-json";

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
  id: z.string(),
  input: z.any(),
});

// This is a smaller schema used for format inference
export const FormatInferenceHardhatV3CompilerOutputPieceSchema = z.object({
  _format: z.literal(HARDHAT_V3_COMPILER_OUTPUT_FORMAT),
  id: z.string(),
  output: z.any(),
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
