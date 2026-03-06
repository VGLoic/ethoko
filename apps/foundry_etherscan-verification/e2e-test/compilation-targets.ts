import { GlobalFolder } from "./helpers/global-folder.js";

const withoutBuildInfoWithoutTestPath = `${GlobalFolder.path}/without-build-info-without-test`;
export const COMPILATION_TARGETS = {
  WITHOUT_BUILD_INFO_WITHOUT_TEST: {
    command: `forge build --skip test/**/* --skip src/test/**/* --use-literal-content --out ${withoutBuildInfoWithoutTestPath} --cache-path ${withoutBuildInfoWithoutTestPath}-cache`,
    outputPath: withoutBuildInfoWithoutTestPath,
  },
};
