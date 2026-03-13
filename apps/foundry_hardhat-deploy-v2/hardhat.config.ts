import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { configVariable, defineConfig } from "hardhat/config";
import HardhatEthoko from "hardhat-ethoko";
import HardhatDeploy from "hardhat-deploy";
import "dotenv/config";

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin, HardhatEthoko, HardhatDeploy],
  ethoko: {
    project: "forge-counter",
    compilationOutputPath: "./out",
    storageConfiguration: {
      type: "aws",
      awsRegion: process.env.AWS_REGION || "abc",
      awsBucketName: process.env.AWS_S3_BUCKET || "abc",
      credentials: {
        profile: "ethoko"
      }
    },
    debug: false,
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
  paths: {
    sources: "./src", // Use ./src rather than ./contracts as Hardhat expects
  },
});
