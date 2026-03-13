#!/bin/bash

# This script resets the example by
# - compiling,
# - pushing to Ethoko using the tag v1.0.1,
# - pulling,
# - generating typings,
# - deploying on sepolia

rm -rf deployments
rm -rf .ethoko
rm -rf .ethoko-typings

pnpm compile

npx ethoko push --tag v1.0.1

npx ethoko pull

npx ethoko typings

npx hardhat deploy --network sepolia --no-compile
