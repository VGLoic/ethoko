import fs from "fs/promises";
import { toAsyncResult } from "@/utils/result";
import { ForgeCompilerContractOutputSchema } from "@/utils/supported-origins/forge-v1/schemas";
import z from "zod";
import { lookForContractArtifactPath } from "@/utils/look-for-contract-artifact-path";

export async function* lookForForgeContractArtifactPath(
  rootArtifactsFolderPath: string,
  buildInfoContractPaths: Map<string, string>,
  debug: boolean,
): AsyncIterable<{
  localArtifactPath: string; // Relative path in artifacts output
  fullyQualifiedName: {
    path: string;
    name: string;
  };
  contract: z.infer<typeof ForgeCompilerContractOutputSchema>;
}> {
  for await (const contractArtifactPath of lookForContractArtifactPath(
    rootArtifactsFolderPath,
  )) {
    const contractContentResult = await toAsyncResult(
      fs.readFile(contractArtifactPath, "utf-8").then((content) => {
        const rawParsing = JSON.parse(content);
        return ForgeCompilerContractOutputSchema.parse(rawParsing);
      }),
      { debug },
    );
    if (!contractContentResult.success) {
      if (debug) {
        console.error(
          `Failed to parse contract artifact at path "${contractArtifactPath}". Skipping it. Error: ${contractContentResult.error}`,
        );
      }
      continue;
    }
    const contract = contractContentResult.value;

    // E.g "contracts/MyContract.sol" and "MyContract"
    let contractPath: string;
    let contractName: string;
    // @dev we retrieve the name and path from the `compilationTarget` field
    // An exception is made for `console2.sol` helper "contract" because the format is different, I don't know why
    if (contractArtifactPath.endsWith("console2.json")) {
      contractPath = "lib/forge-std/src/console2.sol";
      contractName = "console2";
    } else {
      const compilationTargetEntries = Object.entries(
        contract.metadata?.settings.compilationTarget || {},
      );
      const targetEntry = compilationTargetEntries.at(0);
      if (!targetEntry || compilationTargetEntries.length > 1) {
        if (debug) {
          console.error(
            `No compilation target found or too many targets for contract "${contractArtifactPath}". Skipping it.`,
          );
        }
        continue;
      }
      [contractPath, contractName] = targetEntry;
    }

    // We verify that the couple (ID, contractPath) matches the one in the `contractPathToVisit`
    const expectedContractPath = buildInfoContractPaths.get(
      contract.id.toString(),
    );
    if (expectedContractPath != contractPath) {
      if (debug) {
        console.error(
          `Found an artifact belonging to another compilation for contract "${contractArtifactPath}". Skipping it.`,
        );
      }
      continue;
    }
    yield {
      fullyQualifiedName: {
        name: contractName,
        path: contractPath,
      },
      localArtifactPath: contractArtifactPath,
      contract,
    };
  }
}
