import SepoliaDeployedAddresses from "./../ignition/deployments/chain-11155111/deployed_addresses.json" with { type: "json" };
import { EthokoInputArtifact, project } from "./../.ethoko-typings/index.js";
import "dotenv/config";

const DEPLOYER_ADDRESS = "0x25371B936fD45e67F00dfEa1cd6A3e77105DD0FA";

async function main() {
  console.log("\nStarting Etherscan verification for release 2026-02-02...\n");

  console.log("Deployed addresses on Sepolia for release 2026-02-02:");
  for (const [key, address] of Object.entries(SepoliaDeployedAddresses)) {
    const [, contractName] = key.split("#");
    console.log(`- ${contractName}: ${address}`);
  }

  const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY;
  if (!ETHERSCAN_API_KEY) {
    console.error(
      "Error: ETHERSCAN_API_KEY is not set in the environment variables.",
    );
    process.exit(1);
  }
  const etherscanClient = new EtherscanVerificationClient(ETHERSCAN_API_KEY);

  const inputCompilationArtifact = await project("verified-forge-counter")
    .tag("2026-02-02")
    .getInputCompilationArtifact();

  const verificationPayload = {
    compilerVersion: inputCompilationArtifact.solcLongVersion,
    optimizationUsed:
      inputCompilationArtifact.input.settings?.optimizer?.enabled ?? false,
    optimizationRuns:
      inputCompilationArtifact.input.settings?.optimizer?.runs ?? 0,
    evmVersion: inputCompilationArtifact.input.settings?.evmVersion ?? "london",
    licenseType: "UNLICENSED" as const,
  };

  const patchedSourceCodeInput = patchInputSources(
    inputCompilationArtifact.input,
  );
  const stringifiedSourceCodeInput = JSON.stringify(patchedSourceCodeInput);

  await etherscanClient.verifyContract({
    sourceCode: stringifiedSourceCodeInput,
    address: SepoliaDeployedAddresses["release_2026_02_02#ExternalMath"],
    fullyQualifiedContractName: "src/ExternalMath.sol:ExternalMath",
    constructorArguments: "", // No constructor arguments for this contract
    ...verificationPayload,
  });

  await etherscanClient.verifyContract({
    sourceCode: stringifiedSourceCodeInput,
    address: SepoliaDeployedAddresses["release_2026_02_02#Oracle"],
    fullyQualifiedContractName: "src/Oracle.sol:Oracle",
    constructorArguments: abiEncodeAddress(DEPLOYER_ADDRESS),
    ...verificationPayload,
  });

  await etherscanClient.verifyContract({
    sourceCode: stringifiedSourceCodeInput,
    address: SepoliaDeployedAddresses["release_2026_02_02#Counter"],
    fullyQualifiedContractName: "src/Counter.sol:Counter",
    constructorArguments: abiEncodeAddress(
      SepoliaDeployedAddresses["release_2026_02_02#Oracle"],
    ), // Address of the Oracle contract as constructor argument
    ...verificationPayload,
  });
}

function patchInputSources(
  input: EthokoInputArtifact["input"],
): EthokoInputArtifact["input"] {
  const updatedSources: Record<string, { content: string }> = {};
  for (const [key, source] of Object.entries(input.sources)) {
    const content = source.content;
    if (!content) {
      throw new Error(
        `Unexpected source format for ${key}: missing 'content' field`,
      );
    }
    // Remove `urls` and `license` fields if they exist, and keep only the `content`
    updatedSources[key] = { content };
  }
  return {
    ...input,
    sources: updatedSources,
  };
}

function abiEncodeAddress(address: string): string {
  // Remove the "0x" prefix and left-pad with zeros to 32 bytes (64 hex characters)
  return address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

class EtherscanVerificationClient {
  constructor(private apiKey: string) {}

  async verifyContract(payload: {
    address: string;
    /**
     * `input` field from the Solidity compiler output, which includes the source code and compilation settings
     * Notes:
     * - do not accept the `urls`, `license` fields in sources
     * ```
     * "src/Oracle.sol": {
     *  "license": "UNLICENSED",
     *  "keccak256": "0xa51dd1806d8690e1e744d9fdabb2cb09705f42c942c0adf165cb9a34ee41b7e0",
     *  "urls": [],
     *  "content": "// SPDX-License-Identifier: UNLICENSED\npragma solidity ^0.8.28;\n\ncontract Oracle {\n    uint public by;\n\n    event Updated(uint by);\n\n    function set(uint _by) public {\n        by = _by;\n        emit Updated(_by);\n    }\n}\n"
     * }
     * ```
     * The `content` and `keccak256` are accepted
     */
    sourceCode: string;
    fullyQualifiedContractName: string;
    compilerVersion: string;
    optimizationUsed: boolean;
    optimizationRuns: number;
    // Encoding of constructor arguments
    constructorArguments: string;
    evmVersion: string;
    licenseType: "MIT" | "UNLICENSED";
  }) {
    const queryParams = new URLSearchParams({
      apikey: this.apiKey,
      chainId: "11155111", // Sepolia chain ID
      module: "contract",
      action: "verifysourcecode",
      contractaddress: payload.address,
      sourceCode: payload.sourceCode,
      codeformat: "solidity-standard-json-input",
      contractname: payload.fullyQualifiedContractName,
      compilerversion: appendCompilerVersion(payload.compilerVersion),
      optimizationUsed: payload.optimizationUsed ? "1" : "0",
      runs: payload.optimizationRuns.toString(),
      constructorArguments: payload.constructorArguments,
      evmVersion: payload.evmVersion,
      licenseType: payload.licenseType === "MIT" ? "3" : "2", // MIT License or UNLICENSED
    });

    const response = await fetch(
      `https://api.etherscan.io/v2/api?${queryParams.toString()}`,
      {
        method: "POST",
      },
    );

    const rawResponse = await response.text();
    try {
      const data = JSON.parse(rawResponse);
      if ("status" in data && data.status === "0") {
        if (
          "result" in data &&
          data.result === "Contract source code already verified"
        ) {
          console.log(
            `Contract ${payload.fullyQualifiedContractName} already verified\n`,
          );
        } else {
          console.error(
            `Verification failed for ${payload.fullyQualifiedContractName}:`,
            data,
          );
        }
      } else {
        console.log(
          `Verification submitted for ${payload.fullyQualifiedContractName}:\n`,
          data,
        );
      }
    } catch (error) {
      console.error("Failed to parse Etherscan response as JSON:", error);
      console.error("Raw response from Etherscan:", rawResponse);
      return;
    }
  }
}

function appendCompilerVersion(version: string) {
  if (version.startsWith("v")) return version;
  return `v${version}`;
}

main();
