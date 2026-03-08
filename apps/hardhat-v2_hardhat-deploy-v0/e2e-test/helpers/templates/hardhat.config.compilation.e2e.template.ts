import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

export const config: HardhatUserConfig = {
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
  paths: {
    cache: "CACHE_PATH",
    artifacts: "ARTIFACTS_PATH",
    sources: "./src",
  },
};

export default config;
