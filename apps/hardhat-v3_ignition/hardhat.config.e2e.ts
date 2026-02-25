import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { configVariable, defineConfig } from "hardhat/config";
import HardhatEthoko from "hardhat-ethoko";
import "dotenv/config";

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin, HardhatEthoko],
  ethoko: {
    project: "ignited-counter",
    pulledArtifactsPath: "./.ethoko-e2e/.ethoko",
    typingsPath: "./.ethoko-typings",
    compilationOutputPath: "./artifacts",
    storageConfiguration: {
      type: "local",
      path: "./.ethoko-e2e/.storage",
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
    sepolia: {
      type: "http",
      chainType: "l1",
      url: configVariable("SEPOLIA_RPC_URL"),
      accounts: {
        mnemonic: configVariable("SEPOLIA_MNEMONIC"),
      },
    },
  },
});
