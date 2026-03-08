import { GlobalFolder } from "./helpers/global-folder.js";

const buildPath = `${GlobalFolder.path}/build`;
export const COMPILATION_TARGETS = {
  DEFAULT: {
    command: `npx hardhat compile --no-typechain`,
    outputPath: buildPath,
  },
};
