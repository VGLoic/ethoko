import fs from "fs/promises";
import { describe, expect } from "vitest";
import { pull, push, exportContractArtifact } from "@/cli-client/index";
import { TEST_CONSTANTS } from "@test/helpers/test-constants";
import { createTestProjectName } from "@test/helpers/test-utils";
import {
  STORAGE_PROVIDER_STRATEGIES,
  storageProviderTest,
} from "@test/helpers/storage-provider-test";

describe.for(STORAGE_PROVIDER_STRATEGIES)(
  "Export E2E Tests (%s)",
  ([, storageProviderFactory]) => {
    storageProviderTest.scoped({ storageProviderFactory });

    storageProviderTest(
      "export contract artifact by tag",
      async ({ storageProvider, localStorage }) => {
        const project = createTestProjectName(TEST_CONSTANTS.PROJECTS.DEFAULT);
        const tag = TEST_CONSTANTS.TAGS.V1;
        const artifactFixture =
          TEST_CONSTANTS.ARTIFACTS_FIXTURES.HARDHAT_V3_COUNTER;

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
        expect(exportResult._format).toBe("ethoko-contract-artifact-v0");
        expect(exportResult.project).toBe(project);
        expect(exportResult.bytecode.startsWith("0x")).toBe(true);
        expect(exportResult.deployedBytecode.startsWith("0x")).toBe(true);
        expect(exportResult.metadata).toEqual(expect.any(String));
        expect(exportResult.linkReferences).toEqual(expect.any(Object));
        expect(exportResult.deployedLinkReferences).toEqual(expect.any(Object));
        expect(exportResult.evm).toEqual(expect.any(Object));
        const expectedAbi = await fs
          .readFile(exportFixture.abiPath, "utf-8")
          .then(JSON.parse);
        expect(exportResult.abi).toEqual(expectedAbi);
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
      "export contract artifact by ID",
      async ({ storageProvider, localStorage }) => {
        const project = createTestProjectName(TEST_CONSTANTS.PROJECTS.DEFAULT);
        const artifactFixture =
          TEST_CONSTANTS.ARTIFACTS_FIXTURES.HARDHAT_V3_COUNTER;

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
        expect(exportResult._format).toBe("ethoko-contract-artifact-v0");
        expect(exportResult.project).toBe(project);
        expect(exportResult.bytecode.startsWith("0x")).toBe(true);
        expect(exportResult.deployedBytecode.startsWith("0x")).toBe(true);
        expect(exportResult.metadata).toEqual(expect.any(String));
        expect(exportResult.linkReferences).toEqual(expect.any(Object));
        expect(exportResult.deployedLinkReferences).toEqual(expect.any(Object));
        expect(exportResult.evm).toEqual(expect.any(Object));
        const expectedAbi = await fs
          .readFile(exportFixture.abiPath, "utf-8")
          .then(JSON.parse);
        expect(exportResult.abi).toEqual(expectedAbi);
      },
    );

    storageProviderTest(
      "export with non-existent contract returns error",
      async ({ storageProvider, localStorage }) => {
        const project = createTestProjectName(TEST_CONSTANTS.PROJECTS.DEFAULT);

        await localStorage.ensureProjectSetup(project);

        const artifactFixture =
          TEST_CONSTANTS.ARTIFACTS_FIXTURES.HARDHAT_V3_COUNTER;

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
