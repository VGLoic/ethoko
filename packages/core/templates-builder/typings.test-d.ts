import { assertType, test } from "vitest";
import type {
  EthokoContractArtifact as TypingsEthokoContractArtifact,
  EthokoBuildInfoInput,
  EthokoBuildInfoOutput,
} from "./typings";
import type {
  EthokoContractArtifact,
  EthokoInputArtifact,
  EthokoOutputArtifact,
} from "@/utils/ethoko-artifacts-schemas/v0";

test("EthokoBuildInfoInput in generated typings is ok with Ethoko artifacts", () => {
  assertType<EthokoBuildInfoInput>({} as unknown as EthokoInputArtifact);
});
test("EthokoBuildInfoOutput in generated typings is ok with Ethoko artifacts", () => {
  assertType<EthokoBuildInfoOutput>({} as unknown as EthokoOutputArtifact);
});

test("EthokoContractArtifact matches ContractArtifact in typings", () => {
  assertType<TypingsEthokoContractArtifact>(
    {} as unknown as EthokoContractArtifact,
  );
});

test("EthokoContractArtifact ABI can be narrowed", () => {
  const artifact = {} as TypingsEthokoContractArtifact<
    readonly [{ readonly type: "function"; readonly name: "increment" }]
  >;
  assertType<
    readonly [{ readonly type: "function"; readonly name: "increment" }]
  >(artifact.abi);
});
