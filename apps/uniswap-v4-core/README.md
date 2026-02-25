# Uniswap v4 Core - Ethoko Test

This repository is a manual fork of the Uniswap v4 Core contracts, created to test the integration of Ethoko in the Uniswap v4 Core project.

The full `src` directory has been copied from the [Uniswap v4 Core repository](https://github.com/Uniswap/v4-core). The `src/test` folder has been removed.

The Foundry setup has also been copied.

End to end tests have been added in order to test a basic push and pull of artifacts using Ethoko.

## Running the tests

Install dependencies:

```bash
pnpm install
```

Run the end to end tests:

```bash
pnpm test:e2e
```
