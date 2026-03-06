export const E2E_FOLDER_PATH = ".ethoko-e2e";

const outputPath = `${E2E_FOLDER_PATH}/out-2026-forge`;
export const BUILD = {
  command: `forge build --skip test/**/* --skip src/test/**/* --use-literal-content --out ${outputPath} --cache-path ${outputPath}-cache`,
  outputPath,
};
