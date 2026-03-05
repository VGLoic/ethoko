#!/bin/bash

# This script resets the example by
# - compiling,
# - pushing to Ethoko using the tag 2026-02-04,
# - pulling,
# - generating typings,
# - deploying on sepolia

rm -rf ignition/deployments
rm -rf .ethoko
rm -rf .ethoko-typings
rm -rf .ethoko-storage

pnpm compile

npx hardhat ethoko push --tag 2026-02-02

npx hardhat ethoko pull

npx hardhat ethoko typings

npx hardhat ignition deploy ./ignition/modules/release-2026-02-02.ts --network sepolia

