import fs from "fs/promises";
import { describe, expect } from "vitest";
import { TEST_CONSTANTS } from "@test/helpers/test-constants";
import { createTestProjectName } from "@test/helpers/test-utils";
import {
  STORAGE_PROVIDER_STRATEGIES,
  storageProviderTest,
} from "@test/helpers/storage-provider-test";
import { ARTIFACTS_STRATEGIES } from "@test/helpers/artifacts-strategy";
import { CommandLogger } from "@/ui";
import { runPushCommand } from "@/commands/push";
import { runExportCommand } from "@/commands/export";
import { runPullCommand } from "@/commands/pull";

describe.for(STORAGE_PROVIDER_STRATEGIES)(
  "Export E2E Tests (%s)",
  ([, storageProviderFactory]) => {
    const logger = new CommandLogger(true);
    storageProviderTest.scoped({ storageProviderFactory });

    describe.for([[false], [true]] as const)(
      "artifact already pulled: %s",
      ([artifactAlreadyPulled]) => {
        storageProviderTest.for(ARTIFACTS_STRATEGIES)(
          "%s artifacts - export contract artifact by tag",
          async (
            [, artifactFixture],
            { storageProvider, localArtifactStore },
          ) => {
            const project = createTestProjectName(
              TEST_CONSTANTS.PROJECTS.DEFAULT,
            );
            const tag = TEST_CONSTANTS.TAGS.V1;

            await localArtifactStore.ensureProjectSetup(project);

            const artifactId = await runPushCommand(
              artifactFixture.folderPath,
              {
                project,
                tag,
              },
              {
                storageProvider,
                logger,
              },
              {
                force: false,
                debug: false,
              },
            );

            if (!artifactAlreadyPulled) {
              await runPullCommand(
                { project, type: "tag", tag },
                {
                  storageProvider,
                  localArtifactStore,
                  logger,
                },
                {
                  force: false,
                  debug: false,
                },
              );
            }

            const exportFixture = artifactFixture.exportExpectedResult;

            const exportResult = await runExportCommand(
              { project, type: "tag", tag },
              exportFixture.name,
              {
                storageProvider,
                localArtifactStore,
                logger,
              },
              { debug: false },
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
            expect(exportResult.deployedLinkReferences).toEqual(
              expect.any(Object),
            );
            expect(exportResult.evm).toEqual(expect.any(Object));
            const expectedAbi = (await fs
              .readFile(artifactFixture.abiPath.resolvedPath, "utf-8")
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              .then(JSON.parse)) as any[];
            expect(exportResult.abi.sort(sortAbiItem)).toEqual(
              expectedAbi.sort(sortAbiItem),
            );
          },
        );

        storageProviderTest.for(ARTIFACTS_STRATEGIES)(
          "%s artifacts - export contract artifact by ID",
          async (
            [, artifactFixture],
            { storageProvider, localArtifactStore },
          ) => {
            const project = createTestProjectName(
              TEST_CONSTANTS.PROJECTS.DEFAULT,
            );

            await localArtifactStore.ensureProjectSetup(project);

            const artifactId = await runPushCommand(
              artifactFixture.folderPath,
              {
                project,
                tag: undefined,
              },
              {
                storageProvider,
                logger,
              },
              {
                force: false,
                debug: false,
              },
            );

            await runPullCommand(
              { project, type: "id", id: artifactId },
              { storageProvider, localArtifactStore, logger },
              {
                force: false,
                debug: false,
              },
            );

            const exportFixture = artifactFixture.exportExpectedResult;

            const exportResult = await runExportCommand(
              { project, type: "id", id: artifactId },
              exportFixture.name,
              {
                storageProvider,
                localArtifactStore,
                logger,
              },
              { debug: false },
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
            expect(exportResult.deployedLinkReferences).toEqual(
              expect.any(Object),
            );
            expect(exportResult.evm).toEqual(expect.any(Object));
            const expectedAbi = (await fs
              .readFile(artifactFixture.abiPath.resolvedPath, "utf-8")
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              .then(JSON.parse)) as any[];
            expect(exportResult.abi.sort(sortAbiItem)).toEqual(
              expectedAbi.sort(sortAbiItem),
            );
          },
        );
      },
    );

    storageProviderTest(
      "export with non-existent artifact returns error",
      async ({ localArtifactStore, storageProvider }) => {
        const project = createTestProjectName(TEST_CONSTANTS.PROJECTS.DEFAULT);

        await localArtifactStore.ensureProjectSetup(project);

        await expect(
          runExportCommand(
            { project, type: "tag", tag: "non-existent-tag" },
            "Counter",
            {
              storageProvider,
              localArtifactStore,
              logger,
            },
            { debug: false },
          ),
        ).rejects.toThrow();
      },
    );

    storageProviderTest(
      "export with non-existent contract returns error",
      async ({ storageProvider, localArtifactStore }) => {
        const project = createTestProjectName(TEST_CONSTANTS.PROJECTS.DEFAULT);

        await localArtifactStore.ensureProjectSetup(project);

        const artifactFixture =
          TEST_CONSTANTS.ARTIFACTS_FIXTURES.COUNTER.TARGETS.HARDHAT_V3;

        const artifactId = await runPushCommand(
          artifactFixture.folderPath,
          {
            project,
            tag: undefined,
          },
          {
            storageProvider,
            logger,
          },
          {
            force: false,
            debug: false,
          },
        );

        await runPullCommand(
          { project, type: "id", id: artifactId },
          { storageProvider, localArtifactStore, logger },
          {
            force: false,
            debug: false,
          },
        );

        await expect(
          runExportCommand(
            { project, type: "id", id: artifactId },
            "NonExistentContract",
            {
              storageProvider,
              localArtifactStore,
              logger,
            },
            { debug: false },
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
