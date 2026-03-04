import { LocalStorage } from "../local-storage";
import { EthokoContractArtifact } from "../utils/ethoko-artifacts-schemas/v0";
import { toAsyncResult } from "../utils/result";
import { CliError } from "./error";

export type ExportContractArtifactResult = EthokoContractArtifact & {
  tag: string | null;
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

  const artifactResult = await toAsyncResult(
    artifact.search.type === "tag"
      ? localStorage.retrieveOutputArtifactByTag(
          artifact.project,
          artifact.search.tag,
        )
      : localStorage.retrieveOutputArtifactById(
          artifact.project,
          artifact.search.id,
        ),
    { debug: opts.debug },
  );
  if (!artifactResult.success) {
    throw new CliError(
      "Unable to retrieve the artifact content, please ensure it exists locally. Run with debug mode for more info",
    );
  }

  const contracts = artifactResult.value.output.contracts;

  if (shortOrFullyQualifiedContractName.split(":").length === 1) {
    // Short name, find the contract with that name, if multiple are found, throw an error
    // We will perform the search with lowercase names to allow case-insensitive matching, but we will return the contract with the original contract name casing
    const lowerCaseContractName =
      shortOrFullyQualifiedContractName.toLowerCase();
    const matchingContracts: {
      sourcePath: string;
      exactContractName: string;
    }[] = [];
    for (const [sourcePath, contractsByName] of Object.entries(contracts)) {
      for (const contractName of Object.keys(contractsByName)) {
        if (contractName.toLowerCase() === lowerCaseContractName) {
          matchingContracts.push({
            sourcePath,
            exactContractName: contractName,
          });
        }
      }
    }
    const matchingContract = matchingContracts[0];
    if (!matchingContract) {
      throw new CliError(
        `No contract found with name ${shortOrFullyQualifiedContractName} in artifact ${deriveDisplayArtifactName(artifact.project, artifact.search)}`,
      );
    }
    if (matchingContracts.length > 1) {
      throw new CliError(
        `Multiple contracts found with name ${shortOrFullyQualifiedContractName} in artifact ${deriveDisplayArtifactName(artifact.project, artifact.search)}, please specify the fully qualified contract name (i.e. <sourcePath>:${shortOrFullyQualifiedContractName}).\nMatching source paths: ${matchingContracts.map((c) => c.sourcePath).join(", ")}`,
      );
    }
    const contract =
      contracts[matchingContract.sourcePath]?.[
        matchingContract.exactContractName
      ];
    if (!contract?.abi) {
      throw new CliError(
        `No ABI found for contract ${shortOrFullyQualifiedContractName} in artifact ${deriveDisplayArtifactName(artifact.project, artifact.search)}`,
      );
    }
    const contractArtifact = buildContractArtifact(
      matchingContract.sourcePath,
      matchingContract.exactContractName,
      contract,
      artifactResult.value.id,
      artifact.project,
    );
    return {
      ...contractArtifact,
      tag: artifact.search.type === "tag" ? artifact.search.tag : null,
    };
  }

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
  const sourceContracts = contracts[sourcePath];
  if (!sourceContracts) {
    throw new CliError(
      `No contracts found for source path ${sourcePath} in artifact ${deriveDisplayArtifactName(artifact.project, artifact.search)}`,
    );
  }
  const matchingEntry = Object.entries(sourceContracts).find(
    ([name]) => name.toLowerCase() === lowerCaseContractName,
  );
  if (!matchingEntry) {
    throw new CliError(
      `No contract found with name ${contractName} in source path ${sourcePath} in artifact ${deriveDisplayArtifactName(artifact.project, artifact.search)}`,
    );
  }
  const [exactContractName, contract] = matchingEntry;
  if (!contract?.abi) {
    throw new CliError(
      `No ABI found for contract ${contractName} in source path ${sourcePath} in artifact ${deriveDisplayArtifactName(artifact.project, artifact.search)}`,
    );
  }
  const contractArtifact = buildContractArtifact(
    sourcePath,
    exactContractName,
    contract,
    artifactResult.value.id,
    artifact.project,
  );
  return {
    ...contractArtifact,
    tag: artifact.search.type === "tag" ? artifact.search.tag : null,
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

type ContractOutput = EthokoContractArtifact extends { evm: infer EvmType }
  ? {
      abi: EthokoContractArtifact["abi"];
      metadata?: string;
      userdoc?: unknown;
      devdoc?: unknown;
      storageLayout?: unknown;
      evm: EvmType & {
        bytecode: { object: string; linkReferences: Record<string, unknown> };
        deployedBytecode?: {
          object?: string;
          linkReferences: Record<string, unknown>;
        };
      };
    }
  : never;

function buildContractArtifact(
  contractPath: string,
  contractName: string,
  contract: ContractOutput,
  artifactId: string,
  project: string,
): EthokoContractArtifact {
  return {
    _format: "ethoko-contract-artifact-v0",
    id: artifactId,
    project,
    abi: contract.abi,
    metadata: contract.metadata || "",
    bytecode: prefixWith0x(contract.evm.bytecode.object),
    deployedBytecode: contract.evm.deployedBytecode?.object
      ? prefixWith0x(contract.evm.deployedBytecode.object)
      : "0x",
    linkReferences: contract.evm.bytecode.linkReferences as Record<
      string,
      Record<string, { start: number; length: number }[]>
    >,
    deployedLinkReferences: contract.evm.deployedBytecode
      ? (contract.evm.deployedBytecode.linkReferences as Record<
          string,
          Record<string, { start: number; length: number }[]>
        >)
      : {},
    contractName,
    sourceName: contractPath,
    userdoc: contract.userdoc,
    devdoc: contract.devdoc,
    storageLayout: contract.storageLayout,
    evm: contract.evm as EthokoContractArtifact["evm"],
  };
}
