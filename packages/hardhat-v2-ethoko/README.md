# Hardhat V2 Ethoko

Hardhat plugin in order to interact with Ethoko, warehouse for smart contract compilation artifacts.

> [!NOTE]
> This plugin is compatible with Hardhat V2. For Hardhat V3, please use the [hardhat-ethoko](../hardhat-ethoko/README.md) plugin.

## Installation

Installation can be made using any package manager

```bash
pnpm install hardhat-v2-ethoko
npm install hardhat-v2-ethoko
yarn add hardhat-v2-ethoko
```

## Configuration

In the `hardhat.config.ts/js` file, one should import the `hardhat-v2-ethoko` plugin and fill the Ethoko configuration.

```ts
import { HardhatUserConfig } from "hardhat/config";
...
import "hardhat-v2-ethoko";

export const config: HardhatUserConfig = {
  ... // Existing configuration
  // Example configuration for Ethoko with AWS S3 as storage for compilation artifacts
  ethoko: {
    project: "doubtful-project", // Name of the project, used when pushing artifacts and as default for other commands
    pulledArtifactsPath: ".ethoko", // Local path for pulled artifacts, default to `.ethoko`
    typingsPath: ".ethoko-typings", // Local path for generated typings, default to `.ethoko-typings`
    compilationOutputPath: "./artifacts", // Local path for generated artifacts, allows to avoid providing --artifact-path for push/diff commands
    storageConfiguration: { // Configuration of the storage, see "Storage configurations"
      type: "aws",
      awsRegion: MY_AWS_REGION,
      awsBucketName: MY_AWS_S3_BUCKET,
    },
    debug: false, // If true, all tasks are running with debug mode enabled, default to `false`
  },
}
```

It is recommended to add the folders for pulled artifacts and typings to the `.gitignore` file. They can be regenerated at any time.

## Projects, tags and IDs

A unique **ID**, e.g. `b5e41181986a`, is derived for each compilation artifact. The ID is based on the content of the artifact.

A **tag**, e.g. `2026-02-02` or `v1.2.3`, can be associated to a compilation artifact when pushed.

A **project**, e.g. `doubtful-project`, will gather many compilation artifacts.

The project setup in the Hardhat Config will be used as

- target project when pushing new compilation artifacts,
- default project for pulling artifacts or other commands, different project can be specified for those commands.

## Tasks

> [!NOTE]
> The code snippets in this section uses `npx` but one can choose something else

An overview of the Ethoko tasks is exposed by running the `ethoko` task:

```bash
npx hardhat ethoko
```

Help about any task scopped under ethoko is available:

```bash
npx hardhat help ethoko push
```

### Push

Push a local compilation artifact for the configured project to the storage, creating the remote artifact with its ID and optionally tagging it.

Only push the compilation artifact without an additional tag:

```bash
npx hardhat ethoko push
```

Or use a tag to associate the compilation artifact with it

```bash
npx hardhat ethoko push --tag 2026-02-02
```

If not setup in the configuration or need to be overriden, the path to the compilation artifact can be provided

```bash
# e.g. ./artifacts for Hardhat, ./out for Foundry, etc...
npx hardhat ethoko push --artifact-path ./path/to/artifacts
```

> [!NOTE]
> Hardhat Ethoko will try to read the compilation artifact from the configured or provided path. If multiple choices are possible, it will ask the user to select one of them. One can avoid this prompt by providing the full path to the compilation artifact or ensure there is only one compilation artifact in the provided path.

### Pull

Pull locally the missing artifacts from the configured storage.

One can pull all the artifacts from the configured project

```bash
npx hardhat ethoko pull
```

Or target a specific artifact using its tag or ID or another project:

```bash
npx hardhat ethoko pull --id b5e41181986a
npx hardhat ethoko pull --tag 2026-02-02
npx hardhat ethoko pull --tag v1.2.3 --project another-project
```

### Typings

Once the artifacts have been pulled, one can generate the TypeScript typings based on the pulled projects.

```bash
npx hardhat ethoko typings
```

> [!NOTE]
> If no projects have been pulled, one can still generate the default typings using this command. It may be helpful for those who do not care about the scripts involving Ethoko but want to be unblocked in case of missing files.

### List artifacts

List the pulled compilation artifacts with their project.

```bash
npx hardhat ethoko artifacts
```

### Inspect

Inspect a pulled compilation artifact to list contracts and metadata.

```bash
npx hardhat ethoko inspect --tag 2026-02-02
npx hardhat ethoko inspect --id b5e41181986a
```

Target a different project:

```bash
npx hardhat ethoko inspect --project another-project --tag 2026-02-02
```

Output JSON for scripting:

```bash
npx hardhat ethoko inspect --tag 2026-02-02 --json
```

### Export

Export a contract artifact from a locally pulled artifact.

```bash
npx hardhat ethoko export --tag 2026-02-02 --contract Counter
npx hardhat ethoko export --id b5e41181986a --contract contracts/Counter.sol:Counter
```

Write the contract artifact to a file (overwrites if it exists):

```bash
npx hardhat ethoko export --tag 2026-02-02 --contract Counter --output ./Counter.json
```

Pipe the artifact to another tool:

```bash
npx hardhat ethoko export --tag 2026-02-02 --contract Counter | jq
```

Export the ABI as a TypeScript `const`:

```bash
echo "export const MY_ABI = $(npx hardhat ethoko export --tag 2026-02-02 --contract Counter | jq .abi) as const;" > ./my-abi.ts
```

### Restore

Restore original compilation artifacts from a locally pulled artifact to a local directory.

```bash
npx hardhat ethoko restore --id b5e41181986a --output ./restored
npx hardhat ethoko restore --tag 2026-02-02 --output ./restored
npx hardhat ethoko restore --tag v1.2.3 --project another-project --output ./restored
```

> [!NOTE]
> The artifact must be pulled locally before restoring, and the output directory must be empty unless the `--force` flag is used.

### Diff

Compare a local compilation artifacts with an existing compilation artifact and print the contracts for which differences have been found.

```bash
npx hardhat ethoko diff --tag 2026-02-02

npx hardhat ethoko diff --id b5e41181986a
```

If not setup in the configuration or need to be overriden, the path to the compilation artifact can be provided

```bash
# e.g. ./artifacts for Hardhat, ./out for Foundry, etc...
npx hardhat ethoko diff --tag 2026-02-02 --artifact-path ./path/to/artifacts
```

## Using the typings

The typings are exposed in order to help the developer retrieve easily and safely a contract artifact (ABI, bytecode, etc...).

There are two available utils in order to retrieve a contract artifact, it would depend on the task at hand:

- start with a contract, select one of its available tags

```ts
import { project } from "../.ethoko-typings";

const artifact = await project("doubtful-project")
  .contract("src/path/to/my/contract.sol:Foo")
  .getArtifact("2026-02-02");
```

- start with a tag, select a contract within it

```ts
import { project } from "../.ethoko-typings";

const artifact = await project("doubtful-project")
  .tag("2026-02-02")
  .getContractArtifact("src/path/to/my/contract.sol:Foo");
```

If typings have been generated from existing projects, the inputs of the utils will be strongly typed and wrong project, tags or contracts names will be detected.

In case there are no projects or the projects have not been pulled, the generated typings are made in such a way that strong typecheck disappears and any string can be used with the helper functions.

### Retrieve full compilation artifact

The input and contract outputs compilation artifacts of a tag can be retrieved using the `project("doubtful-project").tag("2026-02-02").{getInputCompilationArtifact, getContractOutputCompilationArtifact}` methods.

The input compilation artifact contains the sources and settings used for compilation. There is one output compilation artifact per contract, each containing the ABI, bytecode and metadata for the contract.

### Example with hardhat-deploy v0

An example can be made with the [hardhat-deploy](https://github.com/wighawag/hardhat-deploy) plugin for deploying a released smart contract.

The advantage of this deployment is that it only works with frozen artifacts. New development will never have an impact on it.

```ts
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { project } from "../.ethoko-typings";

const deployMyExample: DeployFunction = async function (
  hre: HardhatRuntimeEnvironment,
) {
  const { deployer } = await hre.getNamedAccounts();

  const fooArtifact = await project("doubtful-project")
    .contract("src/Example.sol:Foo")
    .getArtifact("2026-02-02");

  await hre.deployments.deploy(`Foo@2026-02-02`, {
    contract: {
      abi: fooArtifact.abi,
      bytecode: fooArtifact.evm.bytecode.object,
      metadata: fooArtifact.metadata,
    },
    from: deployer,
  });
};

export default deployMyExample;
```

## Storage configurations

Ethoko supports AWS S3 and local filesystem storage providers.

### AWS S3

Compilation artifacts are stored in an [AWS S3 bucket](https://aws.amazon.com/s3/).

Before using Ethoko with AWS S3, create an S3 bucket and make sure AWS credentials are available. By default, Ethoko uses the AWS SDK's default credential provider chain, which checks the following sources in order:

- Environment variables (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`)
- AWS IAM Identity Center (SSO)
- Shared credentials file (`~/.aws/credentials`)
- Shared config file (`~/.aws/config`)
- ECS container credentials
- EC2 instance metadata (IAM roles)

The configuration requires:

- `awsRegion`: AWS region where the S3 bucket is located
- `awsBucketName`: Name of the S3 bucket

Default configuration example:

```ts
storageConfiguration: {
  type: "aws",
  awsRegion: "us-east-1",
  awsBucketName: "my-ethoko-bucket",
}
```

Regarding credentials, it is recommended to rely on the default credential provider chain and configure credentials using environment variables or AWS config/credentials files. This allows for better security practices and flexibility across different environments.

If working with a dedicated AWS profile, use the environment variable `AWS_PROFILE` or specify the profile name in the configuration:

```bash
# ~/.aws/config
[profile my-ethoko-profile]
region = eu-west-3
role_arn = arn:aws:iam::123456789012:role/my-ethoko-role
source_profile = my-ethoko-source-profile

# ~/.aws/credentials
[my-ethoko-source-profile]
aws_access_key_id = YOUR_ACCESS_KEY_ID
aws_secret_access_key = YOUR_SECRET_ACCESS_KEY
```

```ts
storageConfiguration: {
  type: "aws",
  awsRegion: "us-east-1",
  awsBucketName: "my-ethoko-bucket",
  credentials: { profile: "my-ethoko-profile" },
}
```
or set the environment variable:

```bash
AWS_PROFILE=my-ethoko-profile npx hardhat ethoko pull
```

Alternatively, provide explicit static credentials (for example in CI):

```ts
storageConfiguration: {
  type: "aws",
  awsRegion: "us-east-1",
  awsBucketName: "my-ethoko-bucket",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
}
```

Optionally, in the case of static credentials, you can assume an IAM role using explicit credentials:

- `credentials.role.roleArn`: ARN of the IAM role to assume
- `credentials.role.externalId`: Optional external ID for cross-account role assumption
- `credentials.role.sessionName`: Optional role session name (default: `ethoko-hardhat-session`)
- `credentials.role.durationSeconds`: Optional session duration in seconds (900-43200)

When `credentials.role` is provided, Ethoko assumes the role using the access key and secret key, and uses the temporary credentials for S3 operations. The credentials are cached in memory for the duration of the task.

When `credentials` is omitted, Ethoko relies on the default credential provider chain.

If you want role assumption while still relying on the default credential chain, configure it in your AWS config file using `role_arn` and `source_profile`.

It is possible to use a single bucket for multiple projects, Ethoko will handle the organization of the artifacts within the bucket.

### Local filesystem

The local filesystem provider stores artifacts in a local directory, making it a good fit for lightweight organizations or small teams that want a simpler setup while keeping proper versioning of compilation artifacts.

This storage is compatible with sharing through version control (commit the storage directory) or a shared drive.

Configuration example:

```ts
storageConfiguration: {
  type: "local",
  path: "./ethoko-storage",
}
```

Use this provider when you want to keep the setup light and local while still tracking versions of artifacts across your team.

## Integration examples

The monorepo contains [integration examples](https://github.com/VGLoic/ethoko-monorepo/tree/main/apps) that can be used as references.

## Contributing

See `CONTRIBUTING.md` for test and development guidelines.
