import { describe, expect } from "vitest";
import { inspectArtifact, pullArtifact, push } from "@/client";
import { TEST_CONSTANTS } from "@test/helpers/test-constants";
import { createTestProjectName } from "@test/helpers/test-utils";
import {
  STORAGE_PROVIDER_STRATEGIES,
  storageProviderTest,
} from "@test/helpers/storage-provider-test";
import { ARTIFACTS_STRATEGIES } from "@test/helpers/artifacts-strategy";
import { CommandLogger } from "@/ui";

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
            { storageProvider, pulledArtifactStore },
          ) => {
            const project = createTestProjectName(
              TEST_CONSTANTS.PROJECTS.DEFAULT,
            );
            const tag = TEST_CONSTANTS.TAGS.V1;

            await pulledArtifactStore.ensureProjectSetup(project);

            const artifactId = await push(
              artifactFixture.folderPath,
              project,
              tag,
              storageProvider,
              {
                force: false,
                debug: true,
                logger,
              },
            );

            if (!artifactAlreadyPulled) {
              await pullArtifact(
                { project, type: "tag", tag },
                storageProvider,
                pulledArtifactStore,
                {
                  force: false,
                  debug: false,
                  logger,
                },
              );
            }

            const inspectResult = await inspectArtifact(
              { project, type: "tag", tag },
              storageProvider,
              pulledArtifactStore,
              { debug: false, logger },
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
            { storageProvider, pulledArtifactStore },
          ) => {
            const project = createTestProjectName(
              TEST_CONSTANTS.PROJECTS.DEFAULT,
            );

            await pulledArtifactStore.ensureProjectSetup(project);

            const artifactId = await push(
              artifactFixture.folderPath,
              project,
              undefined,
              storageProvider,
              {
                force: false,
                debug: false,
                logger,
              },
            );

            if (!artifactAlreadyPulled) {
              await pullArtifact(
                { project, type: "id", id: artifactId },
                storageProvider,
                pulledArtifactStore,
                {
                  force: false,
                  debug: false,
                  logger,
                },
              );
            }

            const inspectResult = await inspectArtifact(
              { project, type: "id", id: artifactId },
              storageProvider,
              pulledArtifactStore,
              { debug: false, logger },
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
      async ({ pulledArtifactStore, storageProvider }) => {
        const project = createTestProjectName(TEST_CONSTANTS.PROJECTS.DEFAULT);

        await pulledArtifactStore.ensureProjectSetup(project);

        await expect(
          inspectArtifact(
            { project, type: "tag", tag: "non-existent-tag" },
            storageProvider,
            pulledArtifactStore,
            {
              debug: false,
              logger,
            },
          ),
        ).rejects.toThrow();
      },
    );
  },
);
