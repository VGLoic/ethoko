import { LocalStorage } from "../local-storage";
import { toAsyncResult } from "../utils/result";
import { CliError } from "./error";

export type ExportAbiResult = {
  project: string;
  tag: string | null;
  id: string;
  contract: {
    path: string;
    name: string;
    abi: unknown[];
  };
};

export async function exportContractAbi(
  artifact: {
    project: string;
    search: { type: "tag"; tag: string } | { type: "id"; id: string };
  },
  shortOrFullyQualifiedContractName: string,
  localStorage: LocalStorage,
  opts: { debug: boolean; silent?: boolean },
): Promise<ExportAbiResult> {
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
    // We will perform the search with lowercase names to allow case-insensitive matching, but we will return the ABI with the original contract name casing
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
    const abi =
      contracts[matchingContract.sourcePath]?.[
        matchingContract.exactContractName
      ]?.abi;
    if (!abi) {
      throw new CliError(
        `No ABI found for contract ${shortOrFullyQualifiedContractName} in artifact ${deriveDisplayArtifactName(artifact.project, artifact.search)}`,
      );
    }
    return {
      project: artifact.project,
      tag: artifact.search.type === "tag" ? artifact.search.tag : null,
      id: artifactResult.value.id,
      contract: {
        path: matchingContract.sourcePath,
        name: matchingContract.exactContractName,
        abi,
      },
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
  // We will perform the search with lowercase names to allow case-insensitive matching, but we will return the ABI with the original contract name casing
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
  if (!contract.abi) {
    throw new CliError(
      `No ABI found for contract ${contractName} in source path ${sourcePath} in artifact ${deriveDisplayArtifactName(artifact.project, artifact.search)}`,
    );
  }
  return {
    project: artifact.project,
    tag: artifact.search.type === "tag" ? artifact.search.tag : null,
    id: artifactResult.value.id,
    contract: {
      path: sourcePath,
      name: exactContractName,
      abi: contract.abi,
    },
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
