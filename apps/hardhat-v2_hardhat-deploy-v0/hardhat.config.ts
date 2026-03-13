import { HardhatUserConfig } from "hardhat/config";
import "hardhat-deploy";
import "@nomicfoundation/hardhat-toolbox";
import "hardhat-deploy";
import "dotenv/config";

export const config: HardhatUserConfig =
  {
    namedAccounts: {
      deployer: {
        default: 0, // First account is taken as deployer
      },
    },
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
