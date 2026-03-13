import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "hardhat-deploy";

export const config: HardhatUserConfig  =
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
  };

export default config;
