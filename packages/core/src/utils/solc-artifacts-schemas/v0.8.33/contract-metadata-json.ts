import z from "zod";
import { AbiItemSchema } from "./output-json";
import { InputSourceSchema, SettingsSchema } from "./input-json";

/**
 * This is the schema for the JSON structure of the "metadata" field of the contract output as output by the Solidity compiler (solc).
 *
 * Fields and comments are copied from https://docs.soliditylang.org/en/v0.8.33/metadata.html
 */
export const ContractMetadataSchema = z.object({
  // Required: Details about the compiler, contents are specific to the language.
  compiler: z.object({
    // Optional: Hash of the compiler binary which produced this output
    keccak256: z.string().optional(),
    // Required for Solidity: Version of the compiler
    version: z.string(),
  }),
  // Required: Source code language, basically selects a "sub-version" of the specification
  language: z.enum(["Solidity", "Yul", "SolidityAST", "EVMAssembly"]),
  // Required: Generated information about the contract.
  output: z.object({
    // Required: ABI definition of the contract. See "Contract ABI Specification"
    abi: z.array(AbiItemSchema),
    // Required: NatSpec developer documentation of the contract. See https://docs.soliditylang.org/en/latest/natspec-format.html for details.
    devdoc: z.json().optional(),
    // Required: NatSpec user documentation of the contract. See "NatSpec Format"
    userdoc: z.json().optional(),
  }),
  // Required: Compiler settings.
  // Reflects the settings in the JSON input during compilation, except:
  // - Different format: "libraries" field
  // - Added field in metadata.settings: "compilationTarget"
  // - Not in metadata.settings: "stopAfter", "debug.debugInfo", "outputSelection"
  // See the standard JSON input's "settings" field docs for the rest.
  settings: SettingsSchema.omit({
    stopAfter: true,
    debug: true,
    outputSelection: true,
    libraries: true,
  }).extend({
    // Required for Solidity: File path and the name of the contract or library this
    // metadata is created for. This field is not present in the standard JSON input settings.
    compilationTarget: z.record(z.string(), z.string()).optional(),
    // Required for Solidity: Addresses for libraries used.
    // Note that metadata has a different format for "libraries" field than the standard JSON input.
    // metadata format = { "MyLib.sol:MyLib": "0x123123..." }
    // standard JSON input format = { "MyLib.sol": { "MyLib": "0x123123..." } }
    libraries: z.record(z.string(), z.string()).optional(),
  }),
  // Required: Compilation source files/source units, keys are file paths
  sources: z.record(z.string(), InputSourceSchema),
  // Required: The version of the metadata format
  version: z.number(),
});
