import { TEST_CONSTANTS } from "./test-constants";

/**
 * This file centralizes the definition of the artifacts strategies used across multiple test suites
 */
export const ARTIFACTS_STRATEGIES = [
  [
    "COUNTER - Hardhat V3",
    TEST_CONSTANTS.ARTIFACTS_FIXTURES.COUNTER.TARGETS.HARDHAT_V3,
  ],
  [
    "COUNTER - Hardhat V2",
    TEST_CONSTANTS.ARTIFACTS_FIXTURES.COUNTER.TARGETS.HARDHAT_V2,
  ],
  [
    "COUNTER - Forge default",
    TEST_CONSTANTS.ARTIFACTS_FIXTURES.COUNTER.TARGETS.FOUNDRY_DEFAULT,
  ],
  [
    "COUNTER - Forge with build-info",
    TEST_CONSTANTS.ARTIFACTS_FIXTURES.COUNTER.TARGETS.FOUNDRY_BUILD_INFO,
  ],
  [
    "MIX - Hardhat v2",
    TEST_CONSTANTS.ARTIFACTS_FIXTURES.MIX.TARGETS.HARDHAT_V2,
  ],
  [
    "MIX - Foundry",
    TEST_CONSTANTS.ARTIFACTS_FIXTURES.MIX.TARGETS.FOUNDRY_DEFAULT,
  ],
  [
    "MIX - Foundry Build Info",
    TEST_CONSTANTS.ARTIFACTS_FIXTURES.MIX.TARGETS.FOUNDRY_BUILD_INFO,
  ],
  [
    "MIX - Hardhat v3 isolated build",
    TEST_CONSTANTS.ARTIFACTS_FIXTURES.MIX.TARGETS.HARDHAT_V3_ISOLATED_BUILD,
  ],
  [
    "MIX - Hardhat v3 non isolated build",
    TEST_CONSTANTS.ARTIFACTS_FIXTURES.MIX.TARGETS.HARDHAT_V3_NON_ISOLATED_BUILD,
  ],
] as const;
