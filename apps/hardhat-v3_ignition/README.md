# Hardhat Ethoko - Example - Deploy Counter

This is an example of integration between [Hardhat V3](https://hardhat.org/docs/getting-started) and [Ethoko](https://github.com/VGLoic/ethoko-monorepo).

Deployments are managed using [Hardhat Ignition](https://hardhat.org/docs/guides/deployment/using-ignition).

## Workflow

### Content

In this example, we implement a a simple `Counter` contract, see [Counter.sol](./contracts/Counter.sol).

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

Finally, the deployer can create an Hardhat Ignition module, e.g. [counter-2026-02-02.ts](./ignition/modules/counter-2026-02-02.ts), that will retrieve the compilation artifacts from `Ethoko` and deploy the contract accordingly.

```ts
import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { project } from "../../.ethoko-typings";

const TARGET_RELEASE_TAG = "2026-02-02";
// Hardhat Ignition likes alphanumeric and underscores
const MODULE_SUFFIX = TARGET_RELEASE_TAG.replaceAll("-", "_");

export default buildModule(`CounterModule_${MODULE_SUFFIX}`, (m) => {
  const projectUtils = project("ignited-counter");

  const counterArtifact = projectUtils
    .tag(TARGET_RELEASE_TAG)
    // Hardhat Ignition module does not support promises => we use the `sync` variant of artifact retrieval
    .getContractArtifactSync("project/contracts/Counter.sol:Counter");

  const counter = m.contract("Counter", counterArtifact);

  m.call(counter, "incBy", [5n]);

  return { counter };
});
```

The deployment script can be executed using the Hardhat Ignition command:

```bash
npx hardhat ignition deploy ./ignition/modules/counter-2026-02-02.ts --network <network-name>
```

No additional compilation step is needed since the deployment script directly uses the static artifacts from `Ethoko`.

The deployment is by nature idempotent, this is guaranteed by the fact that the used artifacts are static and the Hardhat Ignition plugin.
