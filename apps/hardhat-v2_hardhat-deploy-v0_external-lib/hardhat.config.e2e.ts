import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "hardhat-deploy";
import "hardhat-v2-ethoko";
import "dotenv/config";
import { EthokoHardhatUserConfig } from "hardhat-v2-ethoko";

const ethokoConfig: EthokoHardhatUserConfig = {
  project: "doubtful-counter",
  pulledArtifactsPath: "./.ethoko-e2e/.ethoko",
  typingsPath: "./.ethoko-typings",
  compilationOutputPath: "./artifacts",
  storageConfiguration: {
    type: "local",
    path: "./.ethoko-e2e/.storage",
  },
};

// Issue with hardhat config typing and module augmentation
// It works fine when importing the build package directly but does not work in the monorepo setup
// As a workaround, we cast the config to include the ethoko field
export const config: HardhatUserConfig & { ethoko?: EthokoHardhatUserConfig } =
  {
    namedAccounts: {
      deployer: {
        default: 0, // First account is taken as deployer
      },
    },
    ethoko: ethokoConfig,
    networks: {
      localhost: {
        chainId: 31337,
      },
      sepolia: {
        chainId: 11155111,
        url: process.env.SEPOLIA_RPC_URL || "",
        accounts: { mnemonic: process.env.SEPOLIA_MNEMONIC || "" },
        verify: {
          etherscan: {
            apiKey: process.env.ETHERSCAN_API_KEY || "",
          },
        },
      },
    },
    etherscan: {
      apiKey: {
        sepolia: process.env.ETHERSCAN_API_KEY || "",
      },
    },
    solidity: {
      version: "0.8.28",
      settings: {
        optimizer: {
          enabled: true,
          runs: 200,
        },
      },
    },
    paths: {
      sources: "./src", // Use ./src rather than ./contracts as Hardhat expects
    },
  };

export default config;
