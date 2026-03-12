# @ethoko/cli-beacon

Standalone CLI for Ethoko artifact management.

`@ethoko/cli-beacon` is the source package used for Node.js execution and development. End users should install `@ethoko/cli` to get the platform-specific binary.

## Installation

### npm - Binary (recommended)

```bash
npm install -g @ethoko/cli
```

This installs a thin wrapper that resolves the platform-specific binary automatically.

### npm - Node.js (for development)

```bash
npm install -g @ethoko/cli-beacon
```

This installs the source package and runs via Node.js directly. Useful for contributors or environments where binaries are not available.

### Direct binary download (no Node.js required)

```bash
curl -fsSL https://raw.githubusercontent.com/VGLoic/ethoko-monorepo/main/install.sh | bash
```

## Quick Start

1. Create `ethoko.json`:

```json
{
  "project": "my-contracts",
  "storage": {
    "type": "local",
    "path": ".ethoko-storage"
  }
}
```

2. Push artifacts:

```bash
ethoko push --artifact-path out/build-info --tag v1.0.0
```

3. Pull artifacts:

```bash
ethoko pull --tag v1.0.0
```

## Configuration

Ethoko looks for `ethoko.json` in the current directory and walks up to the filesystem root. You can also pass `--config <path>` to any command.

```json
{
  "project": "my-contracts",
  "compilationOutputPath": "out/build-info",
  "pulledArtifactsPath": ".ethoko",
  "typingsPath": ".ethoko-typings",
  "storage": {
    "type": "local",
    "path": ".ethoko-storage"
  },
  "debug": false
}
```

### AWS storage

```json
{
  "project": "my-contracts",
  "storage": {
    "type": "aws",
    "awsBucketName": "my-ethoko-bucket",
    "awsRegion": "us-east-1"
  }
}
```

## Commands

Each CLI command maps to the Hardhat plugin tasks and uses the same core logic.

```bash
ethoko push --artifact-path out/build-info --tag v1.0.0
ethoko pull --tag v1.0.0
ethoko diff --artifact-path out/build-info --tag v1.0.0
ethoko inspect --tag v1.0.0
ethoko artifacts
ethoko typings
ethoko export --contract Counter --tag v1.0.0
ethoko restore --tag v1.0.0 --output restored-artifacts
```

## Examples

```bash
# Push artifacts after a Foundry build
forge build
ethoko push --artifact-path out/build-info --tag v1.0.0

# Pull in CI and export a contract artifact
ethoko pull --tag v1.0.0
ethoko export --contract Counter --tag v1.0.0 --output Counter.json
```
