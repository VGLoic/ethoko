import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { defineConfig } from "hardhat/config";
import HardhatEthoko from "hardhat-ethoko";
import HardhatDeploy from "hardhat-deploy";

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin, HardhatEthoko, HardhatDeploy],
  ethoko: {
    project: "curious-counter",
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
    artifacts: "ARTIFACTS_PATH",
    cache: "CACHE_PATH",
  },
});
