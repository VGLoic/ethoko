import fs from "fs/promises";
import { describe, expect } from "vitest";
import {
  listPulledArtifacts,
  pullArtifact,
  pullProject,
  push,
} from "@/client/index";
import { TEST_CONSTANTS } from "@test/helpers/test-constants";
import { createTestProjectName } from "@test/helpers/test-utils";
import {
  STORAGE_PROVIDER_STRATEGIES,
  storageProviderTest,
} from "@test/helpers/storage-provider-test";
import { ARTIFACTS_STRATEGIES } from "@test/helpers/artifacts-strategy";
import { deriveAllAbsolutePathsInDirectory } from "@test/helpers/derive-all-paths-in-directory";
import { CommandLogger } from "@/ui";

describe.for(STORAGE_PROVIDER_STRATEGIES)(
  "Push-Pull E2E Tests (%s)",
  ([, storageProviderFactory]) => {
    const logger = new CommandLogger(true);
    storageProviderTest.scoped({ storageProviderFactory });

    storageProviderTest.for(ARTIFACTS_STRATEGIES)(
      "push artifact [%s] without tag → pull by ID",
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

        expect(artifactId).toBeTruthy();
        expect(artifactId).toHaveLength(12);

        const hasArtifact = await storageProvider.hasArtifactById(
          project,
          artifactId,
        );
        expect(hasArtifact).toBe(true);

        const pullResult = await pullArtifact(
          { project, type: "id", id: artifactId },
          storageProvider,
          pulledArtifactStore,
          {
            force: false,
            debug: false,
            logger,
          },
        );

        expect(pullResult.pulledIds).toContain(artifactId);
        expect(pullResult.failedIds).toHaveLength(0);

        const listArtifactsResult = await listPulledArtifacts(
          pulledArtifactStore,
          {
            debug: false,
          },
        );
        expect(
          listArtifactsResult.some(
            (r) => r.id === artifactId && r.project === project,
          ),
        ).toBe(true);

        const localArtifact = await pulledArtifactStore.retrieveInputArtifact(
          project,
          artifactId,
        );

        const expectedBuildInfoPaths = await deriveAllAbsolutePathsInDirectory(
          artifactFixture.folderPath.join("build-info"),
        );
        const expectedOriginalIds = await Promise.all(
          expectedBuildInfoPaths.map((path) =>
            fs
              .readFile(path.resolvedPath, "utf-8")
              .then((c) => JSON.parse(c) as { id: string })
              .then((json) => json.id),
          ),
        );
        const originalIdsInArtifact =
          localArtifact.origin.type === "hardhat-v3"
            ? localArtifact.origin.pairs.map((p) => p.id)
            : [localArtifact.origin.id];
        expect(originalIdsInArtifact.toSorted()).toEqual(
          Array.from(new Set(expectedOriginalIds)).toSorted(),
        );
      },
    );

    storageProviderTest(
      "push artifact with tag → pull by tag",
      async ({ storageProvider, pulledArtifactStore }) => {
        const project = createTestProjectName(TEST_CONSTANTS.PROJECTS.DEFAULT);
        const tag = TEST_CONSTANTS.TAGS.V1;
        const artifactFixture =
          TEST_CONSTANTS.ARTIFACTS_FIXTURES.COUNTER.TARGETS.HARDHAT_V3;

        await pulledArtifactStore.ensureProjectSetup(project);

        const artifactId = await push(
          artifactFixture.folderPath,
          project,
          tag,
          storageProvider,
          {
            force: false,
            debug: false,
            logger,
          },
        );

        const hasTag = await storageProvider.hasArtifactByTag(project, tag);
        const hasId = await storageProvider.hasArtifactById(
          project,
          artifactId,
        );
        expect(hasTag).toBe(true);
        expect(hasId).toBe(true);

        const pullResult = await pullArtifact(
          { project, type: "tag", tag },
          storageProvider,
          pulledArtifactStore,
          {
            force: false,
            debug: false,
            logger,
          },
        );

        expect(pullResult.pulledTags).toContain(tag);
        expect(pullResult.failedTags).toHaveLength(0);

        const listArtifactsResult = await listPulledArtifacts(
          pulledArtifactStore,
          {
            debug: false,
          },
        );
        expect(
          listArtifactsResult.some(
            (r) =>
              r.tag === tag && r.project === project && r.id === artifactId,
          ),
          `Expected pulled artifacts to contain tag "${tag}" with ID "${artifactId}" for project "${project}", got: ${JSON.stringify(listArtifactsResult)}`,
        ).toBe(true);
      },
    );

    storageProviderTest(
      "pull all artifacts for a project",
      async ({ storageProvider, pulledArtifactStore }) => {
        const project = createTestProjectName(
          TEST_CONSTANTS.PROJECTS.MULTI_ARTIFACT,
        );
        const artifactFixture =
          TEST_CONSTANTS.ARTIFACTS_FIXTURES.COUNTER.TARGETS.HARDHAT_V3;

        await pulledArtifactStore.ensureProjectSetup(project);

        const tag1 = TEST_CONSTANTS.TAGS.V1;
        const tag2 = TEST_CONSTANTS.TAGS.V2;

        await push(artifactFixture.folderPath, project, tag1, storageProvider, {
          force: false,
          debug: false,
          logger,
        });
        await push(artifactFixture.folderPath, project, tag2, storageProvider, {
          force: true,
          debug: false,
          logger,
        });

        const pullResult = await pullProject(
          project,
          storageProvider,
          pulledArtifactStore,
          { force: false, debug: false, logger },
        );

        expect(pullResult.pulledTags).toHaveLength(2);
        expect(pullResult.pulledTags).toContain(tag1);
        expect(pullResult.pulledTags).toContain(tag2);

        const listArtifactsResult = await listPulledArtifacts(
          pulledArtifactStore,
          {
            debug: false,
          },
        );
        const pulledTags = listArtifactsResult
          .filter((r) => r.project === project)
          .map((r) => r.tag);
        expect(pulledTags).toContain(tag1);
        expect(pulledTags).toContain(tag2);
      },
    );

    storageProviderTest(
      "force push overwrites existing tag",
      async ({ storageProvider, pulledArtifactStore }) => {
        const project = createTestProjectName(
          TEST_CONSTANTS.PROJECTS.FORCE_TEST,
        );
        const tag = TEST_CONSTANTS.TAGS.LATEST;
        const artifactFixture =
          TEST_CONSTANTS.ARTIFACTS_FIXTURES.COUNTER.TARGETS.HARDHAT_V3;

        await pulledArtifactStore.ensureProjectSetup(project);

        const id1 = await push(
          artifactFixture.folderPath,
          project,
          tag,
          storageProvider,
          {
            force: false,
            debug: false,
            logger,
          },
        );

        await expect(
          push(artifactFixture.folderPath, project, tag, storageProvider, {
            force: false,
            debug: false,
            logger,
          }),
        ).rejects.toThrow(/already exists/);

        const id2 = await push(
          artifactFixture.folderPath,
          project,
          tag,
          storageProvider,
          {
            force: true,
            debug: false,
            logger,
          },
        );

        expect(id1).toBe(id2);

        const hasTag = await storageProvider.hasArtifactByTag(project, tag);
        expect(hasTag).toBe(true);
      },
    );

    storageProviderTest(
      "pull with force re-downloads existing artifacts",
      async ({ storageProvider, pulledArtifactStore }) => {
        const project = createTestProjectName(TEST_CONSTANTS.PROJECTS.DEFAULT);
        const tag = TEST_CONSTANTS.TAGS.V1;
        const artifactFixture =
          TEST_CONSTANTS.ARTIFACTS_FIXTURES.COUNTER.TARGETS.HARDHAT_V3;

        await pulledArtifactStore.ensureProjectSetup(project);

        await push(artifactFixture.folderPath, project, tag, storageProvider, {
          force: false,
          debug: false,
          logger,
        });
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

        const result1 = await pullArtifact(
          { project, type: "tag", tag },
          storageProvider,
          pulledArtifactStore,
          {
            force: false,
            debug: false,
            logger,
          },
        );
        expect(result1.pulledTags).toHaveLength(0);

        const result2 = await pullArtifact(
          { project, type: "tag", tag },
          storageProvider,
          pulledArtifactStore,
          {
            force: true,
            debug: false,
            logger,
          },
        );
        expect(result2.pulledTags).toContain(tag);
      },
    );

    storageProviderTest(
      "pull non-existent artifact returns error",
      async ({ storageProvider, pulledArtifactStore }) => {
        const project = createTestProjectName(TEST_CONSTANTS.PROJECTS.DEFAULT);

        await pulledArtifactStore.ensureProjectSetup(project);

        await expect(
          pullArtifact(
            { project, type: "tag", tag: "non-existent-tag" },
            storageProvider,
            pulledArtifactStore,
            {
              force: false,
              debug: false,
              logger,
            },
          ),
        ).rejects.toThrow();
      },
    );
  },
);
