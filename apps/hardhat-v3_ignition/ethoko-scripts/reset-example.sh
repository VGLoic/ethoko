#!/bin/bash

# This script resets the example by
# - compiling,
# - pushing to Ethoko using the tag 2026-02-02,
# - pulling,
# - generating typings,
# - deploying on sepolia

rm -rf ignition/deployments
rm -rf .ethoko
rm -rf .ethoko-typings
rm -rf ethoko-storage

pnpm compile

npx ethoko push ignited-counter:2026-02-02

npx ethoko pull ignited-counter:2026-02-02

npx ethoko typings ignited-counter:2026-02-02

npx hardhat ignition deploy ./ignition/modules/counter-2026-02-02.ts --network sepolia
