import fs from "fs/promises";
import { describe, expect } from "vitest";
import { pull, push, exportContractArtifact } from "@/client/index";
import { TEST_CONSTANTS } from "@test/helpers/test-constants";
import { createTestProjectName } from "@test/helpers/test-utils";
import {
  STORAGE_PROVIDER_STRATEGIES,
  storageProviderTest,
} from "@test/helpers/storage-provider-test";
import { ARTIFACTS_STRATEGIES } from "@test/helpers/artifacts-strategy";

describe.for(STORAGE_PROVIDER_STRATEGIES)(
  "Export E2E Tests (%s)",
  ([, storageProviderFactory]) => {
    storageProviderTest.scoped({ storageProviderFactory });

    storageProviderTest.for(ARTIFACTS_STRATEGIES)(
      "%s artifacts - export contract artifact by tag",
      async ([, artifactFixture], { storageProvider, localStorage }) => {
        const project = createTestProjectName(TEST_CONSTANTS.PROJECTS.DEFAULT);
        const tag = TEST_CONSTANTS.TAGS.V1;

        await localStorage.ensureProjectSetup(project);

        const artifactId = await push(
          artifactFixture.folderPath,
          project,
          tag,
          storageProvider,
          {
            force: false,
            debug: false,
            silent: true,
          },
        );

        await pull(
          project,
          { type: "tag", tag },
          storageProvider,
          localStorage,
          {
            force: false,
            debug: false,
            silent: true,
          },
        );

        const exportFixture = artifactFixture.exportExpectedResult;

        const exportResult = await exportContractArtifact(
          { project, search: { type: "tag", tag } },
          exportFixture.name,
          localStorage,
          {
            debug: false,
            silent: true,
          },
        );

        expect(exportResult.project).toBe(project);
        expect(exportResult.tag).toBe(tag);
        expect(exportResult.id).toBe(artifactId);
        expect(exportResult.contractName).toBe(exportFixture.name);
        expect(exportResult.sourceName).toBe(exportFixture.path);
        expect(exportResult._format).toBe(
          "exported-ethoko-contract-artifact-v0",
        );
        expect(exportResult.project).toBe(project);
        expect(exportResult.bytecode.startsWith("0x")).toBe(true);
        expect(exportResult.deployedBytecode.startsWith("0x")).toBe(true);
        expect(exportResult.metadata).toEqual(expect.any(String));
        expect(exportResult.linkReferences).toEqual(expect.any(Object));
        expect(exportResult.deployedLinkReferences).toEqual(expect.any(Object));
        expect(exportResult.evm).toEqual(expect.any(Object));
        const expectedAbi = (await fs
          .readFile(artifactFixture.abiPath, "utf-8")
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .then(JSON.parse)) as any[];
        expect(exportResult.abi.sort(sortAbiItem)).toEqual(
          expectedAbi.sort(sortAbiItem),
        );
      },
    );

    storageProviderTest.for(ARTIFACTS_STRATEGIES)(
      "%s artifacts - export contract artifact by ID",
      async ([, artifactFixture], { storageProvider, localStorage }) => {
        const project = createTestProjectName(TEST_CONSTANTS.PROJECTS.DEFAULT);

        await localStorage.ensureProjectSetup(project);

        const artifactId = await push(
          artifactFixture.folderPath,
          project,
          undefined,
          storageProvider,
          {
            force: false,
            debug: false,
            silent: true,
          },
        );

        await pull(
          project,
          { type: "id", id: artifactId },
          storageProvider,
          localStorage,
          {
            force: false,
            debug: false,
            silent: true,
          },
        );

        const exportFixture = artifactFixture.exportExpectedResult;

        const exportResult = await exportContractArtifact(
          { project, search: { type: "id", id: artifactId } },
          exportFixture.name,
          localStorage,
          {
            debug: false,
            silent: true,
          },
        );

        expect(exportResult.project).toBe(project);
        expect(exportResult.tag).toBe(null);
        expect(exportResult.id).toBe(artifactId);
        expect(exportResult.contractName).toBe(exportFixture.name);
        expect(exportResult.sourceName).toBe(exportFixture.path);
        expect(exportResult._format).toBe(
          "exported-ethoko-contract-artifact-v0",
        );
        expect(exportResult.project).toBe(project);
        expect(exportResult.bytecode.startsWith("0x")).toBe(true);
        expect(exportResult.deployedBytecode.startsWith("0x")).toBe(true);
        expect(exportResult.metadata).toEqual(expect.any(String));
        expect(exportResult.linkReferences).toEqual(expect.any(Object));
        expect(exportResult.deployedLinkReferences).toEqual(expect.any(Object));
        expect(exportResult.evm).toEqual(expect.any(Object));
        const expectedAbi = (await fs
          .readFile(artifactFixture.abiPath, "utf-8")
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .then(JSON.parse)) as any[];
        expect(exportResult.abi.sort(sortAbiItem)).toEqual(
          expectedAbi.sort(sortAbiItem),
        );
      },
    );

    storageProviderTest(
      "export with non-existent artifact returns error",
      async ({ localStorage }) => {
        const project = createTestProjectName(TEST_CONSTANTS.PROJECTS.DEFAULT);

        await localStorage.ensureProjectSetup(project);

        await expect(
          exportContractArtifact(
            { project, search: { type: "tag", tag: "non-existent-tag" } },
            "Counter",
            localStorage,
            {
              debug: false,
              silent: true,
            },
          ),
        ).rejects.toThrow();
      },
    );

    storageProviderTest(
      "export with non-existent contract returns error",
      async ({ storageProvider, localStorage }) => {
        const project = createTestProjectName(TEST_CONSTANTS.PROJECTS.DEFAULT);

        await localStorage.ensureProjectSetup(project);

        const artifactFixture =
          TEST_CONSTANTS.ARTIFACTS_FIXTURES.COUNTER.TARGETS.HARDHAT_V3;

        const artifactId = await push(
          artifactFixture.folderPath,
          project,
          undefined,
          storageProvider,
          {
            force: false,
            debug: false,
            silent: true,
          },
        );

        await pull(
          project,
          { type: "id", id: artifactId },
          storageProvider,
          localStorage,
          {
            force: false,
            debug: false,
            silent: true,
          },
        );

        await expect(
          exportContractArtifact(
            { project, search: { type: "id", id: artifactId } },
            "NonExistentContract",
            localStorage,
            {
              debug: false,
              silent: true,
            },
          ),
        ).rejects.toThrow();
      },
    );
  },
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sortAbiItem(a: any, b: any): number {
  if (a.name < b.name) {
    return -1;
  }
  if (a.name > b.name) {
    return 1;
  }
  if (a.type < b.type) {
    return -1;
  }
  if (a.type > b.type) {
    return 1;
  }
  return 0;
}
