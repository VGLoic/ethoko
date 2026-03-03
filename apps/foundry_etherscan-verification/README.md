# Hardhat Ethoko - Example - Deploy Counter

This is an example of integration between [Foundry](https://getfoundry.sh/) and [Ethoko](https://github.com/VGLoic/ethoko-monorepo).

Deployments are managed using [Hardhat Ignition](https://hardhat.org/docs/guides/deployment/using-ignition).

## Workflow

### Content

In this example, we implement a a simple `Counter` contract, see [Counter.sol](./contracts/Counter.sol) linked to another contract `Oracle` in [Oracle.sol](./contracts/Oracle.sol) and relying on an external library `ExternalMath` in [ExternalMath.sol](./contracts/ExternalMath.sol).

### Development phase

Development is done as usual, with as many tests or else.

### Release phase

Once the development is considered done, one can create the compilation artifacts:

```bash
forge build --force --skip test --skip script --use-literal-content
```

> [!NOTE]
> The `--use-literal-content` flag is helping a lot on the verification side, as it will enforce availability of the source code in the compilation artifacts, which is required for later verification. Otherwise, by default, the source code is not included in the compilation artifacts, and only a reference to the file path is kept, which is not exploitable for verification.

The compilation artifacts will be pushed to `Ethoko`, hence freezing them for later use.

```bash
# The tag 2026-02-02 is arbitrary, it can be any string identifying the release
npx hardhat ethoko push --tag 2026-02-02
```

### Deployment phase

Later on, the same developper or another one wants to deploy the contracts for the `2026-02-02` release.
It will first pull the compilation artifacts from `Ethoko`:

```bash
npx hardhat ethoko pull
```

Then, generates the typings in order to write a type-safe deployment script:

```bash
npx hardhat ethoko typings
```

Finally, the deployer can create an Hardhat Ignition module, e.g. [release-2026-02-02.ts](./ignition/modules/release-2026-02-02.ts), that will retrieve the compilation artifacts from `Ethoko` and deploy the contracts accordingly.

```ts
import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { project } from "../../.ethoko-typings";

const TARGET_RELEASE_TAG = "2026-02-02";
// Hardhat Ignition likes alphanumeric and underscores
const MODULE_SUFFIX = TARGET_RELEASE_TAG.replaceAll("-", "_");

export default buildModule(`release_${MODULE_SUFFIX}`, (m) => {
  const projectUtils = project("verified-forge-counter");

  const oracleArtifact = projectUtils
    .tag(TARGET_RELEASE_TAG)
    // Hardhat Ignition module does not support promises => we use the `sync` variant of artifact retrieval
    .getContractArtifactSync("src/Oracle.sol:Oracle");

  const oracle = m.contract("Oracle", oracleArtifact);

  const externalMathLibArtifact = projectUtils
    .tag(TARGET_RELEASE_TAG)
    .getContractArtifactSync("src/ExternalMath.sol:ExternalMath");

  const externalMathLib = m.library("ExternalMath", externalMathLibArtifact);

  const counterArtifact = projectUtils
    .tag(TARGET_RELEASE_TAG)
    .getContractArtifactSync("src/Counter.sol:Counter");

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
import { EthokoBuildInfo, project } from "./../.ethoko-typings/index.js";
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

  const fullCompilationArtifact = await project("verified-forge-counter")
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

  const patchedSourceCodeInput = patchInputSources(
    fullCompilationArtifact.input,
  );
  const stringifiedSourceCodeInput = JSON.stringify(
    patchedSourceCodeInput,
    null,
    2,
  );

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
    constructorArguments: "", // No constructor arguments for this contract
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

// Etherscan expects sources in a specific format, containing only the `content` field for each source
function patchInputSources(
  input: EthokoBuildInfo["input"],
): EthokoBuildInfo["input"] {
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
```
