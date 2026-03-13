import { assertType, test } from "vitest";
import type * as EthokoTypings from "./typings";
import type {
  EthokoContractOutputArtifact,
  EthokoInputArtifact,
} from "@/ethoko-artifacts/v0";
import { ExportContractArtifactResult } from "@/client";

test("EthokoInputArtifact in generated typings is ok with Ethoko artifacts", () => {
  assertType<EthokoTypings.EthokoInputArtifact>(
    {} as unknown as EthokoInputArtifact,
  );
});
test("EthokoContractOutputArtifact in generated typings is ok with Ethoko artifacts", () => {
  assertType<EthokoTypings.EthokoOutputContractArtifact>(
    {} as unknown as EthokoContractOutputArtifact,
  );
});

test("ExportContractArtifactResult matches EthokoContractArtifact in typings", () => {
  assertType<EthokoTypings.EthokoContractArtifact>(
    {} as unknown as ExportContractArtifactResult,
  );
});

test("EthokoContractArtifact ABI can be narrowed", () => {
  const artifact = {} as EthokoTypings.EthokoContractArtifact<
    readonly [{ readonly type: "function"; readonly name: "increment" }]
  >;
  assertType<
    readonly [{ readonly type: "function"; readonly name: "increment" }]
  >(artifact.abi);
  assertType<
    readonly [{ readonly type: "function"; readonly name: "increment" }]
  >(
    {} as EthokoTypings.AbiForContract<
      "doubtful-counter",
      "v1.0.1",
      "src/Counter.sol:Counter"
    >,
  );
});
