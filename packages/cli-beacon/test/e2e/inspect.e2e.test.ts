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
import { runInspectCommand } from "@/commands/inspect";
import { runPullCommand } from "@/commands/pull";

describe.for(STORAGE_PROVIDER_STRATEGIES)(
  "Inspect E2E Tests (%s)",
  ([, storageProviderFactory]) => {
    const logger = new CommandLogger(true);
    storageProviderTest.scoped({ storageProviderFactory });

    describe.for([[false], [true]] as const)(
      "artifact already pulled: %s",
      ([artifactAlreadyPulled]) => {
        storageProviderTest.for(ARTIFACTS_STRATEGIES)(
          "%s artifacts - inspect pulled artifact by tag",
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
                debug: true,
              },
            );

            if (!artifactAlreadyPulled) {
              await runPullCommand(
                { project, type: "tag", tag },
                { storageProvider, localArtifactStore, logger },
                {
                  force: false,
                  debug: false,
                },
              );
            }

            const inspectResult = await runInspectCommand(
              { project, type: "tag", tag },
              {
                storageProvider,
                localArtifactStore,
                logger,
              },
              { debug: false },
            );

            expect(inspectResult.project).toBe(project);
            expect(inspectResult.tag).toBe(tag);
            expect(inspectResult.id).toBe(artifactId);
            expect(inspectResult.contractsBySource.length).toBeGreaterThan(0);
            expect(inspectResult.sourceFiles.length).toBeGreaterThan(0);
            const fullyQualifiedPathsResult = inspectResult.contractsBySource
              .map((c) =>
                c.contracts.map((contract) => `${c.sourcePath}:${contract}`),
              )
              .flat();
            expect(new Set(fullyQualifiedPathsResult)).toEqual(
              new Set(artifactFixture.fullyQualifiedContractPaths),
            );
          },
        );

        storageProviderTest.for(ARTIFACTS_STRATEGIES)(
          "%s artifacts - inspect pulled artifact by ID",
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

            if (!artifactAlreadyPulled) {
              await runPullCommand(
                { project, type: "id", id: artifactId },
                { storageProvider, localArtifactStore, logger },
                {
                  force: false,
                  debug: false,
                },
              );
            }

            const inspectResult = await runInspectCommand(
              { project, type: "id", id: artifactId },
              {
                storageProvider,
                localArtifactStore,
                logger,
              },
              { debug: false },
            );

            expect(inspectResult.project).toBe(project);
            expect(inspectResult.tag).toBe(null);
            expect(inspectResult.id).toBe(artifactId);
            expect(inspectResult.contractsBySource.length).toBeGreaterThan(0);
            expect(inspectResult.sourceFiles.length).toBeGreaterThan(0);
            const fullyQualifiedPathsResult = inspectResult.contractsBySource
              .map((c) =>
                c.contracts.map((contract) => `${c.sourcePath}:${contract}`),
              )
              .flat();
            expect(new Set(fullyQualifiedPathsResult)).toEqual(
              new Set(artifactFixture.fullyQualifiedContractPaths),
            );
          },
        );
      },
    );

    storageProviderTest(
      "inspect non-existent artifact returns error",
      async ({ localArtifactStore, storageProvider }) => {
        const project = createTestProjectName(TEST_CONSTANTS.PROJECTS.DEFAULT);

        await localArtifactStore.ensureProjectSetup(project);

        await expect(
          runInspectCommand(
            { project, type: "tag", tag: "non-existent-tag" },
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
