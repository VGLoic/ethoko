import {
  EthokoInputArtifact,
  EthokoOutputArtifact,
} from "@/utils/artifacts-schemas/ethoko-v0";
import fs from "fs/promises";
import { CliError } from "../error";
import { toAsyncResult, toResult } from "@/utils/result";
import { HardhatV2CompilerOutputSchema } from "@/utils/artifacts-schemas/hardhat-v2";
import {
  ForgeCompilerDefaultOutputSchema,
  ForgeCompilerOutputWithBuildInfoOptionSchema,
} from "@/utils/artifacts-schemas/forge-v1";
import { deriveEthokoArtifactId } from "@/utils/derive-ethoko-artifact-id";
import type { BuildInfoPath } from "./look-for-build-info-json-file";
import { forgeArtifactsToEthokoArtifact } from "./format-specific-mappers/forge-artifacts-to-ethoko-artifact";
import { retrieveForgeContractArtifactsPaths } from "./format-specific-mappers/retrieve-forge-contract-artifacts-paths";
import { hardhatV3ArtifactsToEthokoArtifact } from "./format-specific-mappers/hardhat-v3-artifacts-to-ethoko-artifact";

/**
 * Given a path to a candidate build info JSON file, try to output Ethoko artifacts.
 *
 * This function is meant to be used in other CLI client methods, since it throws a CliError, it can be used without any wrapping, i.e.
 * ```ts
 * const {inputArtifact, outputArtifact, originalContentPaths} = await mapBuildInfoToEthokoArtifact(buildInfoPath);
 * ```
 *
 * The format of the build info has already been detected previously by the caller.
 * According to the detected format, this function will fully satisfy the build info content, validate it and map it to the Ethoko artifact format.
 *
 * @param buildInfoPath The candidate build info path to parse and map to Ethoko artifacts, it contains both the format and the path to the build info JSON files
 * @param debug Whether to enable debug logging
 * @return The Ethoko artifacts mapped from the build info JSON file and the paths to the original content files
 * @throws A CliError if the file cannot be parsed, if the build info is not valid or if the mapping fails
 */
export async function mapBuildInfoToEthokoArtifact(
  buildInfoPath: BuildInfoPath,
  debug: boolean,
): Promise<{
  inputArtifact: EthokoInputArtifact;
  outputArtifact: EthokoOutputArtifact;
  originalContentPaths: string[];
}> {
  // Hardhat v3 is not using a single build info JSON file so we take it as a special case
  if (buildInfoPath.format === "hardhat-v3") {
    const mappingResult = await toAsyncResult(
      hardhatV3ArtifactsToEthokoArtifact(buildInfoPath.paths, debug),
      { debug },
    );
    if (!mappingResult.success) {
      throw new CliError(
        `Hardhat v3 compilation artifacts have been identified but the mapping to Ethoko artifact format failed. Please provide valid Hardhat v3 compilation files or contact us. Run with debug mode for more info.`,
      );
    }

    return {
      inputArtifact: mappingResult.value.inputArtifact,
      outputArtifact: mappingResult.value.outputArtifact,
      originalContentPaths: mappingResult.value.originalArtifactPaths,
    };
  }

  // @dev readJsonFile throws a CliError so it is safe to use it directly without wrapping it in a try catch block
  const jsonContent = await readJsonFile(
    buildInfoPath.path,
    "build info",
    debug,
  );

  // We validate the content and map it to the Ethoko artifact format based on the previously detected format
  if (buildInfoPath.format === "hardhat-v2") {
    const parsingResult = HardhatV2CompilerOutputSchema.safeParse(jsonContent);
    if (!parsingResult.success) {
      if (debug) {
        console.error(
          `Failed to parse the build info file "${buildInfoPath.path}" as a Hardhat V2 build info format. Error: ${parsingResult.error}`,
        );
      }
      throw new CliError(
        `The provided build info file "${buildInfoPath.path}" seems to be in the Hardhat V2 format but we failed to validate it. Please provide a valid Hardhat V2 build info JSON file. Run with debug mode for more info.`,
      );
    }
    const id = deriveEthokoArtifactId(parsingResult.data.input);
    const inputArtifact: EthokoInputArtifact = {
      id,
      _format: "ethoko-input-v0",
      origin: {
        type: "hardhat-v2",
        id: parsingResult.data.id,
        format: parsingResult.data._format,
      },
      solcLongVersion: parsingResult.data.solcLongVersion,
      input: parsingResult.data.input,
    };
    const outputArtifact: EthokoOutputArtifact = {
      id,
      _format: "ethoko-output-v0",
      output: parsingResult.data.output,
    };
    return {
      inputArtifact,
      outputArtifact,
      originalContentPaths: [buildInfoPath.path],
    };
  }

  if (buildInfoPath.format === "forge-with-build-info-option") {
    const parsingResult =
      ForgeCompilerOutputWithBuildInfoOptionSchema.safeParse(jsonContent);
    if (!parsingResult.success) {
      if (debug) {
        console.error(
          `Failed to parse the build info file "${buildInfoPath.path}" as a Forge build info format with the build info option. Error: ${parsingResult.error}`,
        );
      }
      throw new CliError(
        `The provided build info file "${buildInfoPath.path}" seems to be in the Forge format with the build info option but we failed to validate it. Please provide a valid Forge build info JSON file with the build info option. Run with debug mode for more info.`,
      );
    }

    const contractArtifactsPathsResult = await toAsyncResult(
      retrieveForgeContractArtifactsPaths(
        buildInfoPath.path,
        parsingResult.data.source_id_to_path,
        debug,
      ),
      { debug },
    );
    if (!contractArtifactsPathsResult.success) {
      throw new CliError(
        `Failed to identify the contract artifacts related to the compilation. Please provide valid compilation files or contact us. Run with debug mode for more info.`,
      );
    }

    const id = deriveEthokoArtifactId(parsingResult.data.input);
    const inputArtifact: EthokoInputArtifact = {
      id,
      _format: "ethoko-input-v0",
      origin: {
        type: "forge-v1.6-build-info",
        id: parsingResult.data.id,
        format: parsingResult.data._format,
      },
      solcLongVersion: parsingResult.data.solcLongVersion,
      input: parsingResult.data.input,
    };
    const outputArtifact: EthokoOutputArtifact = {
      id,
      _format: "ethoko-output-v0",
      output: parsingResult.data.output,
    };
    return {
      inputArtifact,
      outputArtifact,
      originalContentPaths: [
        buildInfoPath.path,
        ...contractArtifactsPathsResult.value,
      ],
    };
  }

  if (buildInfoPath.format === "forge-default") {
    const parsingResult =
      ForgeCompilerDefaultOutputSchema.safeParse(jsonContent);
    if (!parsingResult.success) {
      if (debug) {
        console.error(
          `Failed to parse the build info file "${buildInfoPath.path}" as a Forge build info format without the build info option. Error: ${parsingResult.error}`,
        );
      }
      throw new CliError(
        `The provided build info file "${buildInfoPath.path}" seems to be in the Forge format without the build info option but we failed to validate it. Please provide a valid Forge build info JSON file without the build info option. Run with debug mode for more info.`,
      );
    }
    // The mapping is not straightforward as we need to reconstruct the input and output from the scattered contract pieces
    const mappingResult = await toAsyncResult(
      forgeArtifactsToEthokoArtifact(
        buildInfoPath.path,
        parsingResult.data,
        debug,
      ),
      { debug },
    );
    if (!mappingResult.success) {
      throw new CliError(
        `The provided build info file "${buildInfoPath.path}" seems to be in the Foundry default format but we failed to validate it, please try to build with the "--build-info" option or file an issue with the error details.`,
      );
    }
    return {
      inputArtifact: mappingResult.value.inputArtifact,
      outputArtifact: mappingResult.value.outputArtifact,
      originalContentPaths: mappingResult.value.additionalArtifactsPaths.concat(
        buildInfoPath.path,
      ),
    };
  }

  buildInfoPath.format satisfies never; // to ensure we covered all the cases

  throw new CliError(
    `The provided build info file "${buildInfoPath.path}" does not match any of the supported formats. Please provide a valid build info JSON file. Run with debug mode for more info.`,
  );
}

async function readJsonFile(
  path: string,
  displayName: string,
  debug: boolean,
): Promise<unknown> {
  const contentResult = await toAsyncResult(fs.readFile(path, "utf-8"), {
    debug,
  });
  if (!contentResult.success) {
    throw new CliError(
      `The provided ${displayName} path "${path}" could not be read. Please check the permissions and try again. Run with debug mode for more info.`,
    );
  }
  const jsonContentResult = await toResult(
    () => JSON.parse(contentResult.value),
    { debug },
  );
  if (!jsonContentResult.success) {
    throw new CliError(
      `The provided ${displayName} file "${path}" could not be parsed as JSON. Please provide a valid JSON file. Run with debug mode for more info.`,
    );
  }
  return jsonContentResult.value;
}
