#!/bin/bash

# This script resets the example by
# - compiling,
# - pushing to Ethoko using the tag 2026-02-04,
# - pulling,
# - generating typings,
# - deploying on sepolia

rm -rf deployments
rm -rf .ethoko
rm -rf .ethoko-typings

pnpm compile

npx ethoko push forge-counter:2026-02-04

npx ethoko pull

npx ethoko typings

npx hardhat deploy --network sepolia --skip-prompts
