import fs from "fs/promises";
import { describe, expect } from "vitest";
import { listPulledArtifacts } from "@/client/index";
import { TEST_CONSTANTS } from "@test/helpers/test-constants";
import { createTestProjectName } from "@test/helpers/test-utils";
import {
  STORAGE_PROVIDER_STRATEGIES,
  storageProviderTest,
} from "@test/helpers/storage-provider-test";
import { ARTIFACTS_STRATEGIES } from "@test/helpers/artifacts-strategy";
import { deriveAllAbsolutePathsInDirectory } from "@test/helpers/derive-all-paths-in-directory";
import { CommandLogger } from "@/ui";
import { runPushCommand } from "@/commands/push";
import { runPullCommand } from "@/commands/pull";

describe.for(STORAGE_PROVIDER_STRATEGIES)(
  "Push-Pull E2E Tests (%s)",
  ([, storageProviderFactory]) => {
    const logger = new CommandLogger(true);
    storageProviderTest.scoped({ storageProviderFactory });

    storageProviderTest.for(ARTIFACTS_STRATEGIES)(
      "push artifact [%s] without tag → pull by ID",
      async ([, artifactFixture], { storageProvider, localArtifactStore }) => {
        const project = createTestProjectName(TEST_CONSTANTS.PROJECTS.DEFAULT);

        await localArtifactStore.ensureProjectSetup(project);

        const artifactId = await runPushCommand(
          artifactFixture.folderPath,
          { project, tag: undefined },
          { storageProvider, logger },
          { force: false, debug: false },
        );

        expect(artifactId).toBeTruthy();
        expect(artifactId).toHaveLength(12);

        const hasArtifact = await storageProvider.hasArtifactById(
          project,
          artifactId,
        );
        expect(hasArtifact).toBe(true);

        const pullResult = await runPullCommand(
          { project, type: "id", id: artifactId },
          { storageProvider, localArtifactStore, logger },
          {
            force: false,
            debug: false,
          },
        );

        expect(pullResult.pulledIds[0]).toEqual(artifactId);
        expect(pullResult.pulledIds.length).toBe(1);

        const listArtifactsResult = await listPulledArtifacts(
          { localArtifactStore, logger: logger.toDebugLogger() },
          {
            debug: false,
          },
        );
        expect(
          listArtifactsResult.some(
            (r) => r.id === artifactId && r.project === project,
          ),
        ).toBe(true);

        const localArtifact = await localArtifactStore.retrieveInputArtifact(
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
      async ({ storageProvider, localArtifactStore }) => {
        const project = createTestProjectName(TEST_CONSTANTS.PROJECTS.DEFAULT);
        const tag = TEST_CONSTANTS.TAGS.V1;
        const artifactFixture =
          TEST_CONSTANTS.ARTIFACTS_FIXTURES.COUNTER.TARGETS.HARDHAT_V3;

        await localArtifactStore.ensureProjectSetup(project);

        const artifactId = await runPushCommand(
          artifactFixture.folderPath,
          { project, tag },
          { storageProvider, logger },
          { force: false, debug: false },
        );

        const hasTag = await storageProvider.hasArtifactByTag(project, tag);
        const hasId = await storageProvider.hasArtifactById(
          project,
          artifactId,
        );
        expect(hasTag).toBe(true);
        expect(hasId).toBe(true);

        const pullResult = await runPullCommand(
          { project, type: "tag", tag },
          { storageProvider, localArtifactStore, logger },
          {
            force: false,
            debug: false,
          },
        );

        expect(pullResult.pulledTags[0]).toEqual(tag);
        expect(pullResult.pulledIds[0]).toEqual(artifactId);
        expect(pullResult.pulledTags.length).toBe(1);
        expect(pullResult.pulledIds.length).toBe(1);

        const listArtifactsResult = await listPulledArtifacts(
          { localArtifactStore, logger: logger.toDebugLogger() },
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
      async ({ storageProvider, localArtifactStore }) => {
        const project = createTestProjectName(
          TEST_CONSTANTS.PROJECTS.MULTI_ARTIFACT,
        );
        const artifactFixture =
          TEST_CONSTANTS.ARTIFACTS_FIXTURES.COUNTER.TARGETS.HARDHAT_V3;

        await localArtifactStore.ensureProjectSetup(project);

        const tag1 = TEST_CONSTANTS.TAGS.V1;
        const tag2 = TEST_CONSTANTS.TAGS.V2;

        await runPushCommand(
          artifactFixture.folderPath,
          { project, tag: tag1 },
          { storageProvider, logger },
          { force: false, debug: false },
        );

        await runPushCommand(
          artifactFixture.folderPath,
          { project, tag: tag2 },
          { storageProvider, logger },
          { force: true, debug: false },
        );

        const pullResult = await runPullCommand(
          { project, type: "project" },
          { storageProvider, localArtifactStore, logger },
          { force: false, debug: false },
        );

        expect(pullResult.pulledTags).toHaveLength(2);
        expect(pullResult.pulledTags).toContain(tag1);
        expect(pullResult.pulledTags).toContain(tag2);

        const listArtifactsResult = await listPulledArtifacts(
          { localArtifactStore, logger: logger.toDebugLogger() },
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
      async ({ storageProvider, localArtifactStore }) => {
        const project = createTestProjectName(
          TEST_CONSTANTS.PROJECTS.FORCE_TEST,
        );
        const tag = TEST_CONSTANTS.TAGS.LATEST;
        const artifactFixture =
          TEST_CONSTANTS.ARTIFACTS_FIXTURES.COUNTER.TARGETS.HARDHAT_V3;

        await localArtifactStore.ensureProjectSetup(project);

        const id1 = await runPushCommand(
          artifactFixture.folderPath,
          { project, tag },
          { storageProvider, logger },
          { force: false, debug: false },
        );

        await expect(
          runPushCommand(
            artifactFixture.folderPath,
            { project, tag },
            { storageProvider, logger },
            { force: false, debug: false },
          ),
        ).rejects.toThrow(/already exists/);

        const id2 = await runPushCommand(
          artifactFixture.folderPath,
          { project, tag },
          { storageProvider, logger },
          { force: true, debug: false },
        );

        expect(id1).toBe(id2);

        const hasTag = await storageProvider.hasArtifactByTag(project, tag);
        expect(hasTag).toBe(true);
      },
    );

    storageProviderTest(
      "pull with force re-downloads existing artifacts",
      async ({ storageProvider, localArtifactStore }) => {
        const project = createTestProjectName(TEST_CONSTANTS.PROJECTS.DEFAULT);
        const tag = TEST_CONSTANTS.TAGS.V1;
        const artifactFixture =
          TEST_CONSTANTS.ARTIFACTS_FIXTURES.COUNTER.TARGETS.HARDHAT_V3;

        await localArtifactStore.ensureProjectSetup(project);

        await runPushCommand(
          artifactFixture.folderPath,
          { project, tag },
          { storageProvider, logger },
          { force: false, debug: false },
        );
        await runPullCommand(
          { project, type: "tag", tag },
          { storageProvider, localArtifactStore, logger },
          {
            force: false,
            debug: false,
          },
        );

        const result1 = await runPullCommand(
          { project, type: "tag", tag },
          { storageProvider, localArtifactStore, logger },
          {
            force: false,
            debug: false,
          },
        );
        expect(result1.pulledTags.length).toBe(0);

        const result2 = await runPullCommand(
          { project, type: "tag", tag },
          { storageProvider, localArtifactStore, logger },
          {
            force: true,
            debug: false,
          },
        );
        expect(result2.pulledTags[0]).toEqual(tag);
        expect(result2.pulledTags.length).toBe(1);
      },
    );

    storageProviderTest(
      "pull non-existent artifact returns error",
      async ({ storageProvider, localArtifactStore }) => {
        const project = createTestProjectName(TEST_CONSTANTS.PROJECTS.DEFAULT);

        await localArtifactStore.ensureProjectSetup(project);

        await expect(
          runPullCommand(
            { project, type: "tag", tag: "non-existent-tag" },
            { storageProvider, localArtifactStore, logger },
            {
              force: false,
              debug: false,
            },
          ),
        ).rejects.toThrow();
      },
    );
  },
);
