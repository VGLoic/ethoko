import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { defineConfig } from "hardhat/config";
import HardhatEthoko from "hardhat-ethoko";
import HardhatDeploy from "hardhat-deploy";

/**
 * This is a template Hardhat config file for the E2E tests. The actual config file used in the tests is generated from this template by replacing the placeholders with the appropriate values.
 */
export default defineConfig({
  plugins: [hardhatToolboxViemPlugin, HardhatEthoko, HardhatDeploy],
  ethoko: {
    project: "PROJECT_NAME",
    pulledArtifactsPath: "PULLED_ARTIFACTS_PATH",
    typingsPath: "TYPINGS_PATH",
    storageConfiguration: {
      type: "local",
      path: "STORAGE_PATH",
    },
  },
  solidity: {
    profiles: {
      default: {
        version: "0.8.28",
      },
      production: {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    },
  },
  networks: {
    hardhatMainnet: {
      type: "edr-simulated",
      chainType: "l1",
    },
    hardhatOp: {
      type: "edr-simulated",
      chainType: "op",
    },
  },
  paths: {
    sources: "./../src", // Use ./../src as we are in the `.ethoko-e2e` folder
  },
});
