import fs from "fs/promises";
import { deriveEthokoArtifactId } from "@/ethoko-artifacts/derive-ethoko-artifact-id";
import {
  EthokoContractOutputArtifact,
  EthokoInputArtifact,
  EthokoInputArtifactSchema,
} from "@/ethoko-artifacts/v0";
import { ForgeCompilerDefaultOutputSchema } from "./schemas";
import z from "zod";
import {
  SettingsSchema,
  SolcJsonInputSchema,
} from "@/solc-artifacts/v0.8.33/input-json";
import { SolcContractSchema } from "@/solc-artifacts/v0.8.33/output-json";
import { lookForForgeContractArtifactPath } from "./look-for-forge-contract-artifact-paths";
import { AbsolutePath, RelativePath } from "@/utils/path";

type SolcContractOutput = z.infer<typeof SolcContractSchema>;
/**
 * The default Forge build info format splits the contract output into multiple files, the build info file contains only the mapping to these files.
 *
 * The organisation of the files is the following:
 * - build-info/
 *    - <build-info-id>.json (contains the mapping to the contract output files)
 * - <file-name-0.sol>:
 *   - <contract-name>.json (contains the output for the contract)
 * - <file-name-1.sol>:
 *   - <contract-name>.json (contains the output for the contract)
 * - ...
 *
 * To reconstruct the Ethoko artifacts, we need to read the build info file, then read all the contract output files, and reconstruct the input and outputs in the Ethoko artifact format.
 *
 * For this:
 * - we place ourselves in the root folder (one level above the build-info folder),
 * - we recursively look for all the .json files (except the one in the build-info folder), each of them corresponds to a contract output, for each of them:
 *  - we look for the .json files, each of them corresponds to a contract output, for each of them:
 *    - we parse the content, we reconstruct the output and input parts
 * At the end, we compare the contracts we explored with the mapping in the build info file, if they match, we can be confident that we reconstructed the input and output correctly, and we can return the Ethoko artifacts.
 * @param buildInfoPath The path to the Forge build info JSON file (the one in the build-info folder)
 * @param debug Whether to enable debug logging
 */
export async function mapForgeV1DefaultArtifactToEthokoArtifact(
  buildInfoPath: AbsolutePath,
  debug: boolean,
): Promise<{
  inputArtifact: EthokoInputArtifact;
  outputContractArtifacts: EthokoContractOutputArtifact[];
  originalContent: { rootPath: AbsolutePath; paths: RelativePath[] };
}> {
  const jsonContent = await fs
    .readFile(buildInfoPath.resolvedPath, "utf-8")
    .then(JSON.parse)
    .catch((error) => {
      if (debug) {
        console.error(
          `Failed to read or parse the build info file "${buildInfoPath.resolvedPath}". Error: ${error}`,
        );
      }
      throw error;
    });

  const buildInfoParsingResult =
    ForgeCompilerDefaultOutputSchema.safeParse(jsonContent);
  if (!buildInfoParsingResult.success) {
    if (debug) {
      console.error(
        `Failed to parse the build info file "${buildInfoPath.resolvedPath}" as a Forge v1 default compiler output format. Error: ${buildInfoParsingResult.error}`,
      );
    }
    throw buildInfoParsingResult.error;
  }

  const forgeBuildInfo = buildInfoParsingResult.data;

  const expectedSourceIdToPath = new Map(
    Object.entries(forgeBuildInfo.source_id_to_path),
  );
  if (expectedSourceIdToPath.size === 0) {
    throw new Error("Empty build info file");
  }

  const buildInfoFolder = buildInfoPath.dirname();
  const rootArtifactsFolder = buildInfoFolder.dirname();

  // We keep track of the additional artifacts paths to return them at the end
  const additionalArtifactsPaths: AbsolutePath[] = [];

  const rebuiltSourceIdToPath = new Map<string, string>();
  let solcLongVersion: string | undefined = undefined;
  // Target input libraries are formatted as
  // "sourceFile" -> "libraryName" -> "libraryAddress"
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inputLibraries: Record<string, any> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inputSources: Record<string, any> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const input: Record<string, any> = {};
  const outputContracts: Record<
    string,
    Record<string, SolcContractOutput>
  > = {};
  for await (const {
    fullyQualifiedName,
    artifactPath,
    contract,
  } of lookForForgeContractArtifactPath(
    rootArtifactsFolder,
    expectedSourceIdToPath,
    debug,
  )) {
    // We register the visiter contract path with the ID
    rebuiltSourceIdToPath.set(contract.id.toString(), fullyQualifiedName.path);
    additionalArtifactsPaths.push(artifactPath);

    const contractMetadata = contract.metadata;
    const contractRawMetadata = contract.rawMetadata;
    // No contract metadata is likely to involve test/script contracts from Forge, we keep track of them but we do not use them for setting the rest of the fields
    if (!contractMetadata || !contractRawMetadata) continue;

    // Fill the solc version if not set
    if (!solcLongVersion) {
      solcLongVersion = contractMetadata.compiler.version;
    }

    // Fill the input language if not set
    if (!input.language) {
      input.language = contractMetadata.language;
    }
    // Fill the input settings if not set
    if (!input.settings) {
      // Libraries in contract
      input.settings = {
        remappings: contractMetadata.settings.remappings,
        optimizer: contractMetadata.settings.optimizer,
        evmVersion: contractMetadata.settings.evmVersion,
        eofVersion: contractMetadata.settings.eofVersion,
        viaIR: contractMetadata.settings.viaIR,
        metadata: contractMetadata.settings.metadata,
        outputSelection: undefined, // not handled
        modelChecker: undefined, // not handled
      } satisfies z.infer<typeof SettingsSchema>;
    }
    // Update the input settings libraries with the libraries found in the contract metadata
    const contractLibraries = contractMetadata.settings.libraries;
    if (contractLibraries) {
      for (const fullyQualifiedName in contractLibraries) {
        const [filePath, libraryName] = fullyQualifiedName.split(":");
        if (!filePath || !libraryName) {
          continue;
        }
        if (!inputLibraries[filePath]) {
          inputLibraries[filePath] = {};
        }
        inputLibraries[filePath][libraryName] =
          contractLibraries[fullyQualifiedName];
      }
    }
    // Update the input sources with the source found in the contract metadata
    for (const sourcePath in contractMetadata.sources) {
      inputSources[sourcePath] = {
        ...inputSources[sourcePath],
        ...contractMetadata.sources[sourcePath],
      };
    }

    // Fill the output contracts
    const contractArtifact: SolcContractOutput = {
      abi: contract.abi,
      metadata: contractRawMetadata,
      userdoc: contractMetadata.output.userdoc,
      devdoc: contractMetadata.output.devdoc,
      ir: undefined, // not handled
      irAst: undefined, // not handled
      irOptimized: undefined, // not handled
      irOptimizedAst: undefined, // not handled
      storageLayout: undefined, // not handled
      transientStorageLayout: undefined, // not handled
      evm: {
        assembly: undefined, // not handled
        legacyAssembly: undefined, // not handled
        bytecode: {
          ...contract.bytecode,
          // The bytecode in the default Forge output is 0x-prefixed, but the Ethoko artifact format expects it to be non-prefixed, so we strip the 0x prefix here.
          object: strip0xPrefix(contract.bytecode.object),
        },
        deployedBytecode: {
          ...contract.deployedBytecode,
          // The bytecode in the default Forge output is 0x-prefixed, but the Ethoko artifact format expects it to be non-prefixed, so we strip the 0x prefix here.
          object: strip0xPrefix(contract.deployedBytecode.object),
        },
        methodIdentifiers: contract.methodIdentifiers,
        gasEstimates: undefined, // not handled
      },
    };
    const outputContractPath = outputContracts[fullyQualifiedName.path] || {};
    outputContractPath[fullyQualifiedName.name] = contractArtifact;
    outputContracts[fullyQualifiedName.path] = outputContractPath;
  }

  // We verify that all contract paths have been visited
  if (rebuiltSourceIdToPath.size !== expectedSourceIdToPath.size) {
    const pathsNotVisited: string[] = [];
    for (const [id, path] of expectedSourceIdToPath.entries()) {
      if (!rebuiltSourceIdToPath.has(id)) {
        pathsNotVisited.push(`${path} (ID: ${id})`);
      }
    }

    if (debug) {
      console.error(
        `Some contract artifact paths were not visited during the retrieval of Forge contract artifacts. This might be due to a change in the Forge output format or contract files containing pure types. Missing contract paths:\n${pathsNotVisited.join(
          ",\n",
        )}.`,
      );
    }
  }

  input.settings.libraries = inputLibraries;
  input.sources = inputSources;

  const inputParsingResult = SolcJsonInputSchema.safeParse(input);
  if (!inputParsingResult.success) {
    throw new Error(
      `Failed to parse the reconstructed input from the Forge build info default format. Error: ${inputParsingResult.error}`,
    );
  }
  const id = deriveEthokoArtifactId(inputParsingResult.data);
  const inputArtifact = {
    id,
    _format: "ethoko-input-v0",
    solcLongVersion: solcLongVersion ?? "unknown",
    origin: {
      type: "forge-v1-default",
      id: forgeBuildInfo.id,
    },
    input: inputParsingResult.data,
  } satisfies EthokoInputArtifact;

  const inputArtifactResult =
    EthokoInputArtifactSchema.safeParse(inputArtifact);
  if (!inputArtifactResult.success) {
    throw new Error(
      `Failed to parse the reconstructed Ethoko input artifact from the Forge build info default format. Error: ${inputArtifactResult.error}`,
    );
  }

  const outputContractArtifacts: EthokoContractOutputArtifact[] = [];
  for (const [sourceName, contracts] of Object.entries(outputContracts)) {
    for (const [contractName, contractOutput] of Object.entries(contracts)) {
      outputContractArtifacts.push({
        id: inputArtifactResult.data.id,
        _format: "ethoko-output-v0",
        contract: contractName,
        sourceName,
        output: {
          contract: contractOutput,
          source: undefined, // Not handled for Forge default output
        },
      });
    }
  }

  return {
    inputArtifact: inputArtifactResult.data,
    outputContractArtifacts,
    originalContent: {
      rootPath: rootArtifactsFolder,
      paths: additionalArtifactsPaths
        .concat(buildInfoPath)
        .map((p) => p.relativeTo(rootArtifactsFolder)),
    },
  };
}

function strip0xPrefix(bytecode: string): string {
  if (bytecode.startsWith("0x")) {
    return bytecode.slice(2);
  }
  return bytecode;
}
