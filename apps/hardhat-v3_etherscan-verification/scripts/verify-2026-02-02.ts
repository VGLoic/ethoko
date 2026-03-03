import SepoliaDeployedAddresses from "./../ignition/deployments/chain-11155111/deployed_addresses.json" with { type: "json" };
import { project } from "./../.ethoko-typings/index.js";
import "dotenv/config";

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

  const fullCompilationArtifact = await project("verified-counter")
    .tag("2026-02-02")
    .getCompilationArtifact();

  const verificationPayload = {
    compilerVersion: fullCompilationArtifact.solcLongVersion,
    optimizationUsed:
      fullCompilationArtifact.input.settings?.optimizer?.enabled ?? false,
    optimizationRuns:
      fullCompilationArtifact.input.settings?.optimizer?.runs ?? 0,
    evmVersion: fullCompilationArtifact.input.settings?.evmVersion ?? "london",
    licenseType: "UNLICENSED" as const,
  };

  await etherscanClient.verifyContract({
    sourceCode: JSON.stringify(fullCompilationArtifact.input),
    address: SepoliaDeployedAddresses["release_2026_02_02#ExternalMath"],
    fullyQualifiedContractName:
      "project/contracts/ExternalMath.sol:ExternalMath",
    constructorArguments: "", // No constructor arguments for this contract
    ...verificationPayload,
  });

  await etherscanClient.verifyContract({
    sourceCode: JSON.stringify(fullCompilationArtifact.input),
    address: SepoliaDeployedAddresses["release_2026_02_02#Oracle"],
    fullyQualifiedContractName: "project/contracts/Oracle.sol:Oracle",
    constructorArguments: "", // No constructor arguments for this contract
    ...verificationPayload,
  });

  await etherscanClient.verifyContract({
    sourceCode: JSON.stringify(fullCompilationArtifact.input),
    address: SepoliaDeployedAddresses["release_2026_02_02#Counter"],
    fullyQualifiedContractName: "project/contracts/Counter.sol:Counter",
    constructorArguments: abiEncodeAddress(
      SepoliaDeployedAddresses["release_2026_02_02#Oracle"],
    ), // Address of the Oracle contract as constructor argument
    ...verificationPayload,
  });
}

function abiEncodeAddress(address: string): string {
  // Remove the "0x" prefix and left-pad with zeros to 32 bytes (64 hex characters)
  return address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

class EtherscanVerificationClient {
  constructor(private apiKey: string) {}

  async verifyContract(payload: {
    address: string;
    // `input` field from the Solidity compiler output, which includes the source code and compilation settings
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

    const data = await response.json();
    if (
      typeof data === "object" &&
      data !== null &&
      "status" in data &&
      data.status === "0"
    ) {
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
  }
}

function appendCompilerVersion(version: string) {
  if (version.startsWith("v")) return version;
  return `v${version}`;
}

main();
