import { LocalStorage } from "../local-storage";
import { toAsyncResult, toResult } from "../utils/result";
import { CliError } from "./error";
import { ContractMetadataSchema } from "@/utils/solc-artifacts-schemas/v0.8.33/contract-metadata-json";
import { warn } from "@/cli-ui";
import z from "zod";

type ContractBytecode = {
  functionDebugData?: unknown;
  object: string;
  opcodes?: string;
  sourceMap?: string;
  generatedSources?: unknown[];
  linkReferences: Record<
    string,
    Record<string, { start: number; length: number }[]>
  >;
};
export type ExportContractArtifactResult = {
  tag: string | null;
  _format: "exported-ethoko-contract-artifact-v0";
  id: string;
  project: string;
  abi: unknown[];
  metadata: string;
  bytecode: `0x${string}`;
  deployedBytecode: `0x${string}`;
  linkReferences: Record<
    string,
    Record<string, { start: number; length: number }[]>
  >;
  deployedLinkReferences: Record<
    string,
    Record<string, { start: number; length: number }[]>
  >;
  contractName: string;
  sourceName: string;
  userdoc?: unknown;
  devdoc?: unknown;
  storageLayout?: unknown;
  evm: {
    assembly?: string;
    bytecode: ContractBytecode;
    deployedBytecode?: ContractBytecode & { immutableReferences?: unknown };
    gasEstimates?: {
      creation?: Record<string, string>;
      external?: Record<string, string>;
      internal?: Record<string, string>;
    } | null;
    methodIdentifiers?: Record<string, string>;
  };
  expandedMetadata: z.infer<typeof ContractMetadataSchema>;
};

export async function exportContractArtifact(
  artifact: {
    project: string;
    search: { type: "tag"; tag: string } | { type: "id"; id: string };
  },
  shortOrFullyQualifiedContractName: string,
  localStorage: LocalStorage,
  opts: { debug: boolean; silent?: boolean },
): Promise<ExportContractArtifactResult> {
  const ensureResult = await toAsyncResult(
    localStorage.ensureProjectSetup(artifact.project),
    { debug: opts.debug },
  );
  if (!ensureResult.success) {
    throw new CliError(
      "Error setting up local storage, is the script not allowed to write to the filesystem? Run with debug mode for more info",
    );
  }

  let artifactId: string;
  if (artifact.search.type === "id") {
    artifactId = artifact.search.id;
  } else {
    const idResult = await toAsyncResult(
      localStorage.retrieveArtifactId(artifact.project, artifact.search.tag),
      { debug: opts.debug },
    );
    if (!idResult.success) {
      throw new CliError(
        `Unable to find an artifact with tag ${artifact.search.tag} for project ${artifact.project}, please ensure it exists locally. Run with debug mode for more info`,
      );
    }
    artifactId = idResult.value;
  }

  const contractListResult = await toAsyncResult(
    localStorage.listContractArtifacts(artifact.project, artifactId),
    { debug: opts.debug },
  );
  if (!contractListResult.success) {
    throw new CliError(
      `Unable to find any contracts for artifact ${deriveDisplayArtifactName(artifact.project, artifact.search)}, please ensure it exists locally. Run with debug mode for more info`,
    );
  }

  const contracts = contractListResult.value;

  let targetContract: { sourceName: string; contractName: string };
  if (shortOrFullyQualifiedContractName.split(":").length === 1) {
    // Short name, find the contract with that name, if multiple are found, throw an error
    // We will perform the search with lowercase names to allow case-insensitive matching, but we will return the contract with the original contract name casing
    const lowerCaseContractName =
      shortOrFullyQualifiedContractName.toLowerCase();
    const matchingContracts = contracts.filter(
      (contract) =>
        contract.contractName.toLowerCase() === lowerCaseContractName,
    );
    const matchingContract = matchingContracts[0];
    if (!matchingContract) {
      throw new CliError(
        `No contract found with name ${shortOrFullyQualifiedContractName} in artifact ${deriveDisplayArtifactName(artifact.project, artifact.search)}`,
      );
    }
    if (matchingContracts.length > 1) {
      throw new CliError(
        `Multiple contracts found with name ${shortOrFullyQualifiedContractName} in artifact ${deriveDisplayArtifactName(artifact.project, artifact.search)}, please specify the fully qualified contract name (i.e. <sourcePath>:${shortOrFullyQualifiedContractName}).\nMatching source paths: ${matchingContracts.map((c) => c.sourceName).join(", ")}`,
      );
    }

    targetContract = matchingContract;
  } else {
    // Else, we should be in the fully qualified contract name case, so we should have a string in the format <sourcePath>:<contractName>
    const elements = shortOrFullyQualifiedContractName.split(":");
    if (elements.length !== 2) {
      throw new CliError(
        `Invalid contract name ${shortOrFullyQualifiedContractName}, expected format is <contractName> or <sourcePath>:<contractName>`,
      );
    }
    const [sourcePath, contractName] = elements as [string, string];
    // We will perform the search with lowercase names to allow case-insensitive matching, but we will return the contract with the original contract name casing
    const lowerCaseContractName = contractName.toLowerCase();
    const matchingContract = contracts.find(
      (contract) =>
        contract.sourceName === sourcePath &&
        contract.contractName.toLowerCase() === lowerCaseContractName,
    );
    if (!matchingContract) {
      throw new CliError(
        `No contract found with name ${contractName} in source path ${sourcePath} in artifact ${deriveDisplayArtifactName(artifact.project, artifact.search)}`,
      );
    }
    targetContract = matchingContract;
  }

  const contractArtifactResult = await toAsyncResult(
    localStorage.retrieveContractOutputArtifact(
      artifact.project,
      artifactId,
      targetContract.sourceName,
      targetContract.contractName,
    ),
    { debug: opts.debug },
  );
  if (!contractArtifactResult.success) {
    throw new CliError(
      `Unable to retrieve the contract artifact content for contract ${targetContract.contractName} in source path ${targetContract.sourceName} for artifact ${deriveDisplayArtifactName(artifact.project, artifact.search)}, please ensure it exists locally. Run with debug mode for more info`,
    );
  }

  const contractArtifact = contractArtifactResult.value;

  const metadataParsingResult = toResult(() => {
    const raw = JSON.parse(contractArtifact.output.contract.metadata);
    return ContractMetadataSchema.parse(raw);
  });
  if (!metadataParsingResult.success) {
    throw new CliError(
      `Failed to parse the contract metadata for contract ${targetContract.sourceName}:${targetContract.contractName} for artifact ${deriveDisplayArtifactName(artifact.project, artifact.search)}, the metadata field is expected to be a JSON string in the format output by solc. Run with debug mode for more info.`,
    );
  }

  const sourcesWithMissingContent = Object.entries(
    metadataParsingResult.value.sources,
  )
    .filter(([, source]) => !source.content)
    .map(([sourcePath]) => sourcePath);

  if (sourcesWithMissingContent.length > 0) {
    const inputArtifactResult = await toAsyncResult(
      localStorage.retrieveInputArtifact(artifact.project, artifactId),
      { debug: opts.debug },
    );
    if (!inputArtifactResult.success) {
      throw new CliError(
        `Failed to retrieve the artifact input for artifact ${deriveDisplayArtifactName(artifact.project, artifact.search)}, which is required to resolve the contract metadata sources content. Please ensure the artifact input exists locally. Run with debug mode for more info.`,
      );
    }
    const inputArtifact = inputArtifactResult.value;

    for (const sourcePath of sourcesWithMissingContent) {
      const inputSource = inputArtifact.input.sources[sourcePath];
      if (!inputSource || !("content" in inputSource) || !inputSource.content) {
        if (opts.debug) {
          warn(
            `Source ${sourcePath} is missing content in the contract metadata and could not be found in the artifact input sources for artifact ${deriveDisplayArtifactName(artifact.project, artifact.search)}. This source will have empty content in the exported artifact.`,
          );
        }
      } else {
        if (!metadataParsingResult.value.sources[sourcePath]) {
          throw new CliError(
            `Source ${sourcePath} is missing in the contract metadata sources and could not be found in the artifact input sources for artifact ${deriveDisplayArtifactName(artifact.project, artifact.search)}. This source is required to be present in the metadata sources to resolve missing content, please ensure the artifact input is correct. Run with debug mode for more info.`,
          );
        }
        metadataParsingResult.value.sources[sourcePath].content =
          inputSource.content;
      }
    }
  }

  return {
    tag: artifact.search.type === "tag" ? artifact.search.tag : null,
    _format: "exported-ethoko-contract-artifact-v0",
    id: contractArtifact.id,
    project: artifact.project,
    abi: contractArtifact.output.contract.abi,
    metadata: contractArtifact.output.contract.metadata || "",
    bytecode: prefixWith0x(
      contractArtifact.output.contract.evm.bytecode.object,
    ),
    deployedBytecode: contractArtifact.output.contract.evm.deployedBytecode
      ?.object
      ? prefixWith0x(
          contractArtifact.output.contract.evm.deployedBytecode.object,
        )
      : "0x",
    linkReferences:
      contractArtifact.output.contract.evm.bytecode.linkReferences,
    deployedLinkReferences: contractArtifact.output.contract.evm
      .deployedBytecode
      ? contractArtifact.output.contract.evm.deployedBytecode.linkReferences
      : {},
    contractName: contractArtifact.contract,
    sourceName: contractArtifact.sourceName,
    userdoc: contractArtifact.output.contract.userdoc,
    devdoc: contractArtifact.output.contract.devdoc,
    storageLayout: contractArtifact.output.contract.storageLayout,
    evm: contractArtifact.output.contract.evm,
    expandedMetadata: metadataParsingResult.value,
  };
}

function deriveDisplayArtifactName(
  project: string,
  search: { type: "tag"; tag: string } | { type: "id"; id: string },
): string {
  if (search.type === "tag") {
    return `${project}:${search.tag}`;
  }
  return `${project}:${search.id}`;
}

function prefixWith0x(s: string): `0x${string}` {
  if (s.startsWith("0x")) return s as `0x${string}`;
  return `0x${s}`;
}
