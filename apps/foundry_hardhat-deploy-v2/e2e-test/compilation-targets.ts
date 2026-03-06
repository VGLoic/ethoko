import { GlobalFolder } from "./helpers/global-folder.js";

const withBuildInfoWithTestPath = `${GlobalFolder.path}/with-build-info-with-test`;
const withBuildInfoWithoutTestPath = `${GlobalFolder.path}/with-build-info-without-test`;
const withoutBuildInfoWithTestPath = `${GlobalFolder.path}/without-build-info-with-test`;
const withoutBuildInfoWithoutTestPath = `${GlobalFolder.path}/without-build-info-without-test`;
export const COMPILATION_TARGETS = {
  WITH_BUILD_INFO_WITH_TEST: {
    command: `forge build --build-info --out ${withBuildInfoWithTestPath} --cache-path ${withBuildInfoWithTestPath}-cache`,
    outputPath: withBuildInfoWithTestPath,
  },
  WITH_BUILD_INFO_WITHOUT_TEST: {
    command: `forge build --build-info --skip test/**/* --skip src/test/**/* --out ${withBuildInfoWithoutTestPath} --cache-path ${withBuildInfoWithoutTestPath}-cache`,
    outputPath: withBuildInfoWithoutTestPath,
  },
  WITHOUT_BUILD_INFO_WITH_TEST: {
    command: `forge build --use-literal-content --out ${withoutBuildInfoWithTestPath} --cache-path ${withoutBuildInfoWithTestPath}-cache`,
    outputPath: withoutBuildInfoWithTestPath,
  },
  WITHOUT_BUILD_INFO_WITHOUT_TEST: {
    command: `forge build --use-literal-content --skip test/**/* --skip src/test/**/* --out ${withoutBuildInfoWithoutTestPath} --cache-path ${withoutBuildInfoWithoutTestPath}-cache`,
    outputPath: withoutBuildInfoWithoutTestPath,
  },
};
