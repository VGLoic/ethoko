<p align="center">
    <picture>
        <source srcset="images/ethoko-logo-dark.svg" media="(prefers-color-scheme: dark)">
        <source srcset="images/ethoko-logo-light.svg" media="(prefers-color-scheme: light)">
        <img alt="Ethoko Logo" src="images/ethoko-logo-light.svg" />
    </picture>
</p>
<p align="center">
    <strong>Warehouse for smart-contract compilation artifacts.</strong>
</p>

## What is Ethoko?

Ethoko enables teams to **store** and **share** versioned smart-contract compilation artifacts.  
As such, it decouples the compilation process from the operation processes.

Define the storage backend of your choice, push your compilation artifacts to Ethoko and pull them back when you need them, in a safe and transparent way.

Ethoko supports both Hardhat and Foundry development environments, compile once, operates safely.

<picture>
    <source srcset="images/ethoko-workflow-dark.svg" media="(prefers-color-scheme: dark)">
    <source srcset="images/ethoko-workflow-light.svg" media="(prefers-color-scheme: light)">
    <img alt="Ethoko workflow" src="images/ethoko-workflow-light.svg" />
</picture>

## Install

Ethoko ships as a standalone CLI.

The easiest way to install the Ethoko CLI is through the installation script:

```bash
curl -fsSL https://install.ethoko.com | bash
```

Alternatively, Ethoko can be installed globally or locally via npm:

```bash
npm install -g @ethoko/cli
npm install --save-dev @ethoko/cli
```

## Configuration

Ethoko CLI manages various `projects`, each of them storing their dedicated compilation artifacts in a `storage` backend. Two types of storage backends are currently supported:
- `aws`: store the compilation artifacts in an AWS S3 bucket. The bucket must be created beforehand, and the AWS credentials must be configured locally for Ethoko to be able to access it.
- `filesystem`: store the compilation artifacts locally in the specified directory.

Ethoko CLI can be configured either using the global configuration file at `~/.ethoko/config.json` or using a local configuration file `ethoko.config.json` at the root of your repository. The local configuration file will override the global one if both are present.

For a quick guided setup, it is recommended to use the init command:
```bash
ethoko init
```

Generally, the global configuration file will define the projects:
```json
// Global ~/.ethoko/config.json: defines global projects
{
  "projects": [
    {
      "name": "my-project",
      "storage": {
        "type": "aws",
        "awsRegion": "us-east-1",
        "awsBucketName": "my-artifacts-bucket",
        "awsProfile": "my-profile"
      }
    }
  ]
}
```

While the local configuration file will refine the configuration for a specific project or specify local project hosted directly in the directory:

```json
// Local ethoko.config.json: 
{
  "compilationOutputPath": "./artifacts"
}
```

Check out the full [configuration reference in the docs](docs/external/CONFIGURATION.md).

## Projects, tags and IDs

A developer will interact with a list of **projects**, e.g. `my-project`, each of them gathering many compilation artifacts. A project is defined by its name and storage backend.

Each artifact is uniquely identified by its **ID**, e.g. `b5e41181986a`, which is the hash of the compilation artifact content. The ID is automatically generated when pushing an artifact to Ethoko and can be used to retrieve it later.

Finally, a **tag**, e.g. `2026-02-02` or `v1.2.3`, can be associated to a compilation artifact when pushed.

Ethoko commands will use the syntax `PROJECT[:TAG|@ID]` to refer to a specific artifact of a project, e.g. `my-project` for the project, `my-project:2026-02-02` for a specific tag, or `my-project@b5e41181986a` for a specific ID.

## Commands

Run `ethoko --help` for a full list of available commands and options. Use the `--help` flag with any command to get more details about its usage, e.g. `ethoko push --help`.

### Push

Push a local compilation artifact for the configured project, creating the remote artifact with its ID and optionally tagging it.

Only push the compilation artifact without an additional tag:

```bash
ethoko push my-project
```

Or use a tag to associate the compilation artifact with it:

```bash
ethoko push my-project:2026-02-02
```

If not set up in the local configuration with `compilationOutputPath` or need to be overridden, the path to the compilation artifact can be provided:

```bash
# e.g. ./artifacts for Hardhat, ./out for Foundry, etc...
ethoko push my-project --artifact-path ./path/to/artifacts
```

> [!NOTE]  
> Ethoko will try to read the compilation artifact from the configured or provided path. If multiple choices are possible, it will ask the user to select one of them. To avoid this prompt, provide the full path to the compilation artifact, or ensure there is only one compilation artifact in the path.

### Export

Export a contract artifact

```bash
# Using only the contract name (case-insensitive) — fails if multiple contracts share the same name
ethoko export my-project:2026-02-02 --contract Counter
# Using the fully qualified path (case-sensitive) — avoids any ambiguity
ethoko export my-project@b5e41181986a --contract contracts/Counter.sol:Counter
```

Write the contract artifact to a file (overwrites if it exists):

```bash
ethoko export my-project:2026-02-02 --contract Counter --output ./Counter.json
```

Pipe the artifact to another tool:

```bash
ethoko export my-project:2026-02-02 --contract Counter | jq
```

Export the ABI as a TypeScript `const`:

```bash
echo "export const MY_ABI = $(ethoko export my-project:2026-02-02 --contract Counter | jq .abi) as const;" > ./my-abi.ts
```

### Inspect

Inspect a compilation artifact to list contracts and metadata.

```bash
ethoko inspect my-project:2026-02-02
ethoko inspect my-project@b5e41181986a
```

Output JSON for scripting:

```bash
ethoko inspect my-project:2026-02-02 --json
```

### Pull

Pull locally the missing artifacts for a configured project.

To pull all artifacts from a project, run:

```bash
ethoko pull my-project
```

Or target a specific artifact using its tag or ID:

```bash
ethoko pull my-project@b5e41181986a
ethoko pull my-project:2026-02-02
```

### Typings

Generate TypeScript typings for all the pulled artifacts

```bash
ethoko typings
```

> [!NOTE]  
> If no projects have been pulled, you can still generate the default typings. This is useful if you don't need Ethoko scripts but want to avoid missing-file errors.

### Artifacts

List the pulled compilation artifacts with their project.

```bash
ethoko artifacts
```

### Config

Display the effective configuration — the result of merging the global and local config files. Useful to verify which projects are available and where values come from.

```bash
ethoko config
```

Each project is labelled with its source: `[global]`, `[local]`, or `[local - overrides global]` when both configs define the same project name.

### Init

Initialize the Ethoko configuration through an interactive wizard. It guides you through:

- Adding projects (name, storage backend, and whether to store the config globally or locally)
- Detecting and setting the compilation output path (`./artifacts` for Hardhat, `./out` for Foundry)
- Adding the relevant paths to `.gitignore`

```bash
ethoko init
```

If you need to add another project or change the local config file path:

```bash
ethoko init --config ./path/to/ethoko.config.json
```

> [!NOTE]  
> Running `ethoko init` again will let you add more projects to an existing configuration without overwriting it.

### Restore

Original compilation artifacts are never lost and can be restored to a local directory.

```bash
ethoko restore my-project@b5e41181986a --output ./restored
ethoko restore my-project:2026-02-02 --output ./restored
```

> [!NOTE]  
> The artifact must be pulled locally before restoring, and the output directory must be empty unless the `--force` flag is used.

### Diff

Compare local compilation artifacts with an existing compilation artifact and print the contracts where differences are found.

```bash
ethoko diff my-project:2026-02-02

ethoko diff my-project@b5e41181986a
```

If not set up in the configuration or need to be overridden, the path to the compilation artifact can be provided:

```bash
# e.g. ./artifacts for Hardhat, ./out for Foundry, etc...
ethoko diff my-project:2026-02-02 --artifact-path ./path/to/artifacts
```

### Prune

Prune pulled artifacts that are no longer needed, either by ID, tag, project, or all orphaned and untagged artifacts.

```bash
# Prune a specific artifact by ID or tag
ethoko prune my-project@b5e41181986a
ethoko prune my-project:2026-02-02
# Prune all artifacts of a project
ethoko prune my-project
# Prune all orphaned and untagged artifacts
ethoko prune
```

## Using exported artifacts in a deployment script

Exported artifacts are plain JSON files and can be imported into any script. The example below uses the [hardhat-deploy](https://github.com/wighawag/hardhat-deploy) plugin — adapt it to your own deployment tooling.

```ts
import { deployScript } from "../rocketh/deploy.js";
import CounterArtifact from "../releases/2026-02-04/counter.json";
import type * as RockethTypes from "rocketh/types";

export default deployScript(
  async ({ deploy, namedAccounts }) => {
    const { deployer } = namedAccounts;

    await deploy(`Counter@2026-02-04`, {
      account: deployer,
      artifact: {
        abi: CounterArtifact.abi as RockethTypes.Abi,
        bytecode: CounterArtifact.bytecode,
        metadata: CounterArtifact.metadata,
      },
    });
  },
  { tags: ["Counter", "Counter_deploy", "2026-02-04"] },
);
```

## Using the typings in a TypeScript environment

The typings are exposed in order to help the developer retrieve easily and safely a contract artifact (ABI, bytecode, etc...).

The same deployment script as above can be rewritten using the generated typings:

```ts
import { deployScript } from "../rocketh/deploy.js";
import { project } from "../.ethoko-typings";

export default deployScript(
  async ({ deploy, namedAccounts }) => {
    const { deployer } = namedAccounts;

    const counterArtifact = await project("my-project")
      .tag("2026-02-04")
      .getContractArtifact("src/Counter.sol:Counter");

    await deploy(`Counter@2026-02-04`, {
      account: deployer,
      artifact: {
        abi: counterArtifact.abi,
        bytecode: counterArtifact.bytecode,
        metadata: counterArtifact.metadata,
      },
    });
  },
  { tags: ["Counter", "Counter_deploy", "2026-02-04"] },
);
```

If typings have been generated from existing projects, the inputs of the utils will be strongly typed and wrong project, tags or contracts names will be detected.

In case there are no projects or the projects have not been pulled, the generated typings are made in such a way that strong typecheck disappears and any string can be used with the helper functions.

### Retrieve input and outputs compilation artifacts

The input and contract output compilation artifacts of a tag can be retrieved using the `getInputCompilationArtifact` and `getContractOutputCompilationArtifact` methods on the result of `project("my-project").tag("2026-02-02")`.

The input compilation artifact contains the sources and settings used for compilation. There is one output compilation artifact per contract, each containing the ABI, bytecode and metadata for the contract.

## Integration examples

Integration examples with Foundry or Hardhat can be found in the `apps/` folder:

- [hardhat-v3_hardhat-deploy-v2](apps/hardhat-v3_hardhat-deploy-v2/README.md): compile a contract using Hardhat v3, deploy using Hardhat Deploy v2,
- [hardhat-v3_ignition](apps/hardhat-v3_ignition/README.md): compile a contract using Hardhat v3, deploy using Hardhat Ignition,
- [foundry_hardhat-deploy-v2](apps/foundry_hardhat-deploy-v2/README.md): compile a contract with Foundry, deploy using Hardhat Deploy v2,
- [hardhat-v2_hardhat-deploy-v0](apps/hardhat-v2_hardhat-deploy-v0/README.md): compile a contract with Hardhat v2, deploy using Hardhat Deploy v0.12,
- [hardhat-v2_hardhat-deploy-v0_external-lib](apps/hardhat-v2_hardhat-deploy-v0_external-lib/README.md): compile a contract and its external library with Hardhat v2, deploy using Hardhat Deploy v0.12,
- [foundry_etherscan-verification](apps/foundry_etherscan-verification/README.md): compile a contract with Foundry, deploy using Hardhat Ignition, verify on Etherscan using the static artifact,
- [hardhat-v3_etherscan-verification](apps/hardhat-v3_etherscan-verification/README.md): compile a contract with Hardhat v3, deploy using Hardhat Ignition, verify on Etherscan using the static artifact.

## FAQ

### When to use Ethoko?

Use Ethoko when you want to

- decouple the compilation process from the operation processes,
- organize and version your compilation artifacts within your team(s),
- build scripts or automation on top of static compilation artifacts.

### When NOT to use Ethoko?

Don't use Ethoko when

- you are prototyping and iterating fast, Ethoko adds some friction that is not needed at this stage,
- you don't care about transparency and reproducibility of your deployments or scripts,
- you are perfectly fine with your process.

### What is the difference between Ethoko and Etherscan or Sourcify?

Etherscan and Sourcify are both great tools for verifying smart contracts after deployment. They allow you to upload your source code and metadata to make it publicly available and verifiable.

While they enable a great transparency and trust in the deployed contracts, they are not designed to be used as a source of compilation artifacts for development, deployment or scripting purposes. They are more focused on the post-deployment phase.

Ethoko is meant to be used as a source of truth for compilation artifacts during the development and operation processes. It allows you to store and share your compilation artifacts in a safe and transparent way, and to build scripts or automation on top of them.

As such, Ethoko can be used in complement to Etherscan and Sourcify. You can push your compilation artifacts to Ethoko for your internal use, and then verify your contracts on Etherscan or Sourcify for public transparency.

To be fully transparent, Ethoko is not about transparency to the public but rather an organization and safety tool for teams.

### I work with Foundry, should I use Ethoko?

You can! I would say you should. Although Foundry is amazing for development and testing, it may not be the best fit for everybody for deployment and operations.

Ethoko can help you there by decoupling the compilation process from the deployment process:
- As a smart contract developer, you will be able to fully benefit from Foundry's speed and ease of use for testing and compilation. Once done, push your artifacts with Ethoko.
- As an operator, you can pull the compilation artifacts with Ethoko and choose the way to use them for your deployment or other scripts. You will not need to care about compilation as you will only work with previously pushed static artifacts.


### Where does the name "Ethoko" come from?

Ethoko comes from a contraction of the Japanese word *倉庫* ("Soko") which means "warehouse" and the boring *Eth* prefix to attach it to the Ethereum ecosystem.

## Contributing

Thank you for your interest in contributing to Ethoko! Please see our [contributing guidelines](CONTRIBUTING.md) for more information.
