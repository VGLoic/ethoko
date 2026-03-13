# Hardhat Ethoko - Example - Deploy Counter

This is an example of integration between [Hardhat V2](https://v2.hardhat.org/) and [Ethoko](https://github.com/VGLoic/ethoko-monorepo).

The static compilation artifacts from `Ethoko` are used to deploy a simple `Counter` contract, see [Counter.sol](./src/Counter.sol).

The [Hardhat-Deploy](https://rocketh.dev/hardhat-deploy/) (`hardhat-deploy@0.12.4` i.e. `v0`) plugin is used to manage deployments.

## Workflow

### Content

In this example, we implement a a simple `Counter` contract, see [Counter.sol](./src/Counter.sol).

### Development phase

Development is done as usual, with as many tests or else.

### Release phase

Once the development is considered done, one can create the compilation artifacts:

```bash
npx hardhat compile
```

The compilation artifacts will be pushed to `Ethoko`, hence freezing them for later use.

```bash
# The tag 2026-02-04 is arbitrary, it can be any string identifying the release
npx ethoko push --artifact-path ./artifacts --tag 2026-02-04
```

### Deployment phase

Later on, the same developper or another one wants to deploy the contracts for the `2026-02-04` release.
It will first pull the compilation artifacts from `Ethoko`:

```bash
npx ethoko pull
```

Then, generates the typings in order to write a type-safe deployment script:

```bash
npx ethoko typings
```

Finally, the deployer can write a deployment script, e.g. [00-deploy-counter-2026-02-04.ts](./deploy/00-deploy-counter-2026-02-04.ts), that will retrieve the compilation artifacts from `Ethoko` and deploy the contract accordingly.

```ts
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { project } from "../.ethoko-typings";

const TARGET_RELEASE = "2026-02-04";

const deployCounter: DeployFunction = async function (
  hre: HardhatRuntimeEnvironment,
) {
  const { deployer } = await hre.getNamedAccounts();

  const balance = await hre.ethers.provider.getBalance(deployer);

  console.log("Deploying contracts with account: ", {
    address: deployer,
    balance: hre.ethers.formatEther(balance),
  });

  // Get project utilities for the target release
  const projectUtils = project("dummy-counter").tag(TARGET_RELEASE);

  // Get the `Counter` artifact for the target release and deploy it
  const counterArtifact = await projectUtils.getContractArtifact(
    "src/Counter.sol:Counter",
  );
  await hre.deployments.deploy(`Counter@${TARGET_RELEASE}`, {
    contract: {
      abi: counterArtifact.abi,
      bytecode: counterArtifact.evm.bytecode.object,
      metadata: counterArtifact.metadata,
    },
    from: deployer,
    log: true,
  });
};
```

The deployment script can be executed using the Hardhat-Deploy plugin:

```bash
npx hardhat deploy --no-compile --network <network-name>
```

The `no-compile` flag is optional and here to highlight that no compilation is needed since we are working with static artifacts from `Ethoko`.

The deployment is by nature idempotent, this is guaranteed by the fact that the used artifacts are static and the Hardhat-Deploy plugin.
