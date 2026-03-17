import { describe, expect } from "vitest";
import { inspectArtifact, pull, push } from "@/client/index";
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

    storageProviderTest.for(ARTIFACTS_STRATEGIES)(
      "%s artifacts - inspect artifact by tag",
      async ([, artifactFixture], { storageProvider, pulledArtifactStore }) => {
        const project = createTestProjectName(TEST_CONSTANTS.PROJECTS.DEFAULT);
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

        await pull(
          project,
          { type: "tag", tag },
          storageProvider,
          pulledArtifactStore,
          {
            force: false,
            debug: false,
            logger,
          },
        );

        const inspectResult = await inspectArtifact(
          { project, search: { type: "tag", tag } },
          pulledArtifactStore,
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
      "%s artifacts - inspect artifact by ID",
      async ([, artifactFixture], { storageProvider, pulledArtifactStore }) => {
        const project = createTestProjectName(TEST_CONSTANTS.PROJECTS.DEFAULT);

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

        await pull(
          project,
          { type: "id", id: artifactId },
          storageProvider,
          pulledArtifactStore,
          {
            force: false,
            debug: false,
            logger,
          },
        );

        const inspectResult = await inspectArtifact(
          { project, search: { type: "id", id: artifactId } },
          pulledArtifactStore,
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

    storageProviderTest(
      "inspect non-existent artifact returns error",
      async ({ pulledArtifactStore }) => {
        const project = createTestProjectName(TEST_CONSTANTS.PROJECTS.DEFAULT);

        await pulledArtifactStore.ensureProjectSetup(project);

        await expect(
          inspectArtifact(
            { project, search: { type: "tag", tag: "non-existent-tag" } },
            pulledArtifactStore,
            {
              debug: false,
            },
          ),
        ).rejects.toThrow();
      },
    );
  },
);
