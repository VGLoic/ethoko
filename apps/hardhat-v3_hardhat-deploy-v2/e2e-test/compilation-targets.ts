import { GlobalFolder } from "./helpers/global-folder.js";

const isolatedBuildPath = `${GlobalFolder.path}/isolated`;
const nonIsolatedBuildPath = `${GlobalFolder.path}/non-isolated`;
export const COMPILATION_TARGETS = {
  ISOLATED_BUILD: {
    command: `npx hardhat build --build-profile production`,
    outputPath: isolatedBuildPath,
  },
  NON_ISOLATED_BUILD: {
    command: `npx hardhat build`,
    outputPath: nonIsolatedBuildPath,
  },
};
