import { assertType, test } from "vitest";
import { EthokoArtifactOrigin } from "./v0";
import { BuildInfoPaths } from "../supported-origins/map-build-info-to-ethoko-artifact";

test("BuildInfoPaths handled the same format than EthokoArtifactOrigin", () => {
  type EthokoArtifactOriginFormat = EthokoArtifactOrigin["type"];
  type BuildInfoPathsFormat = BuildInfoPaths["format"];
  assertType<EthokoArtifactOriginFormat>(
    {} as unknown as BuildInfoPathsFormat,
  );
});
