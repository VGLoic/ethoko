# Hardhat Ethoko - Example - Hardhat v3 and Etherscan verification

This is an example of integration between [Hardhat V3](https://hardhat.org/docs/getting-started) and [Ethoko](https://github.com/VGLoic/ethoko-monorepo).

Deployments are managed using [Hardhat Ignition](https://hardhat.org/docs/guides/deployment/using-ignition).

## Workflow

### Content

In this example, we implement a a simple `Counter` contract, see [Counter.sol](./contracts/Counter.sol) linked to another contract `Oracle` in [Oracle.sol](./contracts/Oracle.sol) and relying on an external library `ExternalMath` in [ExternalMath.sol](./contracts/ExternalMath.sol).

### Development phase

Development is done as usual, with as many tests or else.

### Release phase

Once the development is considered done, one can create the compilation artifacts:

```bash
npx hardhat build --build-profile production
```

The compilation artifacts will be pushed to `Ethoko`, hence freezing them for later use.

```bash
# The tag 2026-02-02 is arbitrary, it can be any string identifying the release
npx ethoko push --tag 2026-02-02
```

### Deployment phase

Later on, the same developper or another one wants to deploy the contracts for the `2026-02-02` release.
It will first pull the compilation artifacts from `Ethoko`:

```bash
npx ethoko pull
```

Then, generates the typings in order to write a type-safe deployment script:

```bash
npx ethoko typings
```

Finally, the deployer can create an Hardhat Ignition module, e.g. [release-2026-02-02.ts](./ignition/modules/release-2026-02-02.ts), that will retrieve the compilation artifacts from `Ethoko` and deploy the contracts accordingly.

```ts
import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { project } from "../../.ethoko-typings";

const TARGET_RELEASE_TAG = "2026-02-02";
// Hardhat Ignition likes alphanumeric and underscores
const MODULE_SUFFIX = TARGET_RELEASE_TAG.replaceAll("-", "_");

export default buildModule(`release_${MODULE_SUFFIX}`, (m) => {
  const projectUtils = project("verified-counter");

  const oracleArtifact = projectUtils
    .tag(TARGET_RELEASE_TAG)
    // Hardhat Ignition module does not support promises => we use the `sync` variant of artifact retrieval
    .getContractArtifactSync("project/contracts/Oracle.sol:Oracle");

  const oracle = m.contract("Oracle", oracleArtifact);

  const externalMathLibArtifact = projectUtils
    .tag(TARGET_RELEASE_TAG)
    .getContractArtifactSync("project/contracts/ExternalMath.sol:ExternalMath");

  const externalMathLib = m.library("ExternalMath", externalMathLibArtifact);

  const counterArtifact = projectUtils
    .tag(TARGET_RELEASE_TAG)
    .getContractArtifactSync("project/contracts/Counter.sol:Counter");

  const counter = m.contract("Counter", counterArtifact, [oracle], {
    libraries: {
      ExternalMath: externalMathLib,
    },
  });

  return { counter, oracle, externalMathLib };
});
```

The deployment script can be executed using the Hardhat Ignition command:

```bash
npx hardhat ignition run --module release_2026_02_02 --network <target_network>
```

No additional compilation step is needed since the deployment script directly uses the static artifacts from `Ethoko`.

The deployment is by nature idempotent, this is guaranteed by the fact that the used artifacts are static and the Hardhat Ignition plugin.

### Verification phase

Once the contracts are deployed, one can verify them on Etherscan using the static artifacts from `Ethoko` and the Etherscan API. See [verify-2026-02-02.ts](./scripts/verify-2026-02-02.ts) for an example of how to implement the verification script using the Etherscan API.

```ts
import SepoliaDeployedAddresses from "./../ignition/deployments/chain-11155111/deployed_addresses.json" with { type: "json" };
import { project } from "./../.ethoko-typings/index.js";
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

  const externalMathArtifact = await project("verified-counter")
    .tag("2026-02-02")
    .getContractArtifact("project/contracts/ExternalMath.sol:ExternalMath");
  await etherscanClient.verifyContract({
    address: SepoliaDeployedAddresses["release_2026_02_02#ExternalMath"],
    constructorArguments: "", // No constructor arguments for this contract
    licenseType: "UNLICENSED",
    artifact: externalMathArtifact,
  });

  const oracleArtifact = await project("verified-counter")
    .tag("2026-02-02")
    .getContractArtifact("project/contracts/Oracle.sol:Oracle");
  await etherscanClient.verifyContract({
    address: SepoliaDeployedAddresses["release_2026_02_02#Oracle"],
    constructorArguments: abiEncodeAddress(DEPLOYER_ADDRESS),
    licenseType: "UNLICENSED",
    artifact: oracleArtifact,
  });

  const counterArtifact = await project("verified-counter")
    .tag("2026-02-02")
    .getContractArtifact("project/contracts/Counter.sol:Counter");
  await etherscanClient.verifyContract({
    address: SepoliaDeployedAddresses["release_2026_02_02#Counter"],
    constructorArguments: abiEncodeAddress(
      SepoliaDeployedAddresses["release_2026_02_02#Oracle"],
    ), // Address of the Oracle contract as constructor argument
    licenseType: "UNLICENSED",
    artifact: counterArtifact,
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
    constructorArguments: string;
    licenseType: "UNLICENSED" | "MIT";
    artifact: EthokoContractArtifact;
  }): Promise<void> {
    const fullyQualifiedName = `${payload.artifact.sourceName}:${payload.artifact.contractName}`;

    /**
     * Etherscan API expects a few things, the few lines of code below reconstruct the expected input format.
     * This is from my understanding, happy to receive corrections if I'm wrong:
     * - the sources contain only the `content` field. Etherscan does not accept the `urls` and `license` fields that are present in the original input artifact, so we remove them,
     * - the `settings` field does match the one from the metadata, I picked the fields that I needed
     */
    const sources: Record<string, { content: string }> = {};
    for (const [key, source] of Object.entries(
      payload.artifact.expandedMetadata.sources,
    )) {
      const content = source.content;
      if (!content) {
        throw new Error(
          `Unexpected source format for ${key}: missing 'content' field`,
        );
      }
      sources[key] = { content };
    }
    const reconstructedInput = {
      language: payload.artifact.expandedMetadata.language,
      settings: {
        optimizer: payload.artifact.expandedMetadata.settings.optimizer,
        evmVersion: payload.artifact.expandedMetadata.settings.evmVersion,
        metadata: payload.artifact.expandedMetadata.settings.metadata,
        remappings: payload.artifact.expandedMetadata.settings.remappings,
      },
      sources,
    };

    // See Etherscan API docs: https://docs.etherscan.io/api-reference/endpoint/verifysourcecode
    const queryParams = new URLSearchParams({
      apikey: this.apiKey,
      chainId: "11155111", // Sepolia chain ID
      module: "contract",
      action: "verifysourcecode",
      contractaddress: payload.address,
      sourceCode: JSON.stringify(reconstructedInput),
      codeformat: "solidity-standard-json-input",
      contractname: fullyQualifiedName,
      compilerversion: appendCompilerVersion(
        payload.artifact.expandedMetadata.compiler.version,
      ),
      optimizationUsed: payload.artifact.expandedMetadata.settings.optimizer
        ?.enabled
        ? "1"
        : "0",
      runs: (
        payload.artifact.expandedMetadata.settings.optimizer?.runs ?? 0
      ).toString(),
      constructorArguments: payload.constructorArguments,
      evmVersion:
        payload.artifact.expandedMetadata.settings.evmVersion ?? "london",
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
          console.log(`Contract ${fullyQualifiedName} already verified\n`);
        } else {
          console.error(`Verification failed for ${fullyQualifiedName}:`, data);
        }
      } else {
        console.log(
          `Verification submitted for ${fullyQualifiedName}:\n`,
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
```
