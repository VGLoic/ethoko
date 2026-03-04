import { assertType, test } from "vitest";
import { EthokoArtifactOrigin } from "./v0";
import { OriginalBuildInfoPaths } from "../supported-origins/map-original-artifact-to-ethoko-artifact";

test("OriginalBuildInfoPaths handled the same format than EthokoArtifactOrigin", () => {
  type EthokoArtifactOriginFormat = EthokoArtifactOrigin["type"];
  type OriginalBuildInfoPathsFormat = OriginalBuildInfoPaths["format"];
  assertType<EthokoArtifactOriginFormat>(
    {} as unknown as OriginalBuildInfoPathsFormat,
  );
});
