import type { ExportContractArtifactResult } from "../cli-client/export-contract-artifact";

export function displayExportResult(
  result: ExportContractArtifactResult,
): void {
  console.log(JSON.stringify(result, null, 2));
}
