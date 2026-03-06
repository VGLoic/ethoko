import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "hardhat-deploy";
import "hardhat-v2-ethoko";
import { EthokoHardhatUserConfig } from "hardhat-v2-ethoko";

const ethokoConfig: EthokoHardhatUserConfig = {
  project: "PROJECT_NAME",
  pulledArtifactsPath: "PULLED_ARTIFACTS_PATH",
  typingsPath: "TYPINGS_PATH",
  storageConfiguration: {
    type: "local",
    path: "STORAGE_PATH",
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
