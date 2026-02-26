import { assertType, test } from "vitest";
import type { EthokoBuildInfo } from "./typings";
import type {
  EthokoInputArtifact,
  EthokoOutputArtifact,
} from "@/utils/artifacts-schemas/ethoko-v0";

test("EthokoBuildInfo in generated typings is ok with Ethoko artifacts", () => {
  assertType<EthokoBuildInfo>(
    {} as unknown as EthokoInputArtifact & EthokoOutputArtifact,
  );
});
