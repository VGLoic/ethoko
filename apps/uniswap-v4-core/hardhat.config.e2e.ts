import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { configVariable, defineConfig } from "hardhat/config";
import HardhatEthoko from "hardhat-ethoko";

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin, HardhatEthoko],
  ethoko: {
    project: "uniswap-v4-core-ethoko-test",
    pulledArtifactsPath: "./ethoko-e2e/.ethoko",
    typingsPath: "./.ethoko-typings",
    compilationOutputPath: "./out",
    storageConfiguration: {
      type: "local",
      path: "./ethoko-e2e/.storage",
    },
  },
  solidity: {
    // Profiles are mandatory but are not used here since we build with `Forge
    profiles: {
      default: {
        version: "0.8.26",
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
  paths: {
    sources: "./src", // Use ./src rather than ./contracts as Hardhat expects
  },
});
