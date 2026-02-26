import { assertType, test } from "vitest";
import type {
  EthokoContractArtifact as TypingsEthokoContractArtifact,
  EthokoBuildInfo,
} from "./typings";
import type {
  EthokoContractArtifact,
  EthokoInputArtifact,
  EthokoOutputArtifact,
} from "@/utils/artifacts-schemas/ethoko-v0";

test("EthokoBuildInfo in generated typings is ok with Ethoko artifacts", () => {
  assertType<EthokoBuildInfo>(
    {} as unknown as EthokoInputArtifact & EthokoOutputArtifact,
  );
});

test("EthokoContractArtifact matches ContractArtifact in typings", () => {
  assertType<TypingsEthokoContractArtifact>(
    {} as unknown as EthokoContractArtifact,
  );
});
