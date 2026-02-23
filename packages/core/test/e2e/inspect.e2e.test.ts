import { describe, expect } from "vitest";
import { inspectArtifact, pull, push } from "@/cli-client/index";
import { TEST_CONSTANTS } from "@test/helpers/test-constants";
import { createTestProjectName } from "@test/helpers/test-utils";
import {
  STORAGE_PROVIDER_STRATEGIES,
  storageProviderTest,
} from "@test/helpers/storage-provider-test";

describe.for(STORAGE_PROVIDER_STRATEGIES)(
  "Inspect E2E Tests (%s)",
  ([, storageProviderFactory]) => {
    storageProviderTest.scoped({ storageProviderFactory });

    storageProviderTest(
      "inspect artifact by tag",
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

        const inspectResult = await inspectArtifact(
          { project, search: { type: "tag", tag } },
          localStorage,
          { debug: false, silent: true },
        );

        expect(inspectResult.project).toBe(project);
        expect(inspectResult.tag).toBe(tag);
        expect(inspectResult.id).toBe(artifactId);
        expect(inspectResult.contractsBySource.length).toBeGreaterThan(0);
        expect(inspectResult.sourceFiles.length).toBeGreaterThan(0);
        expect(inspectResult.artifactPath).toContain(`/tags/${tag}.json`);
        expect(inspectResult.fileSize).toBeGreaterThan(0);
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
      "inspect artifact by ID",
      async ({ storageProvider, localStorage }) => {
        const project = createTestProjectName(TEST_CONSTANTS.PROJECTS.DEFAULT);
        const artifactFixture =
          TEST_CONSTANTS.ARTIFACTS_FIXTURES.FOUNDRY_COUNTER;

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

        const inspectResult = await inspectArtifact(
          { project, search: { type: "id", id: artifactId } },
          localStorage,
          { debug: false, silent: true },
        );

        expect(inspectResult.project).toBe(project);
        expect(inspectResult.tag).toBe(null);
        expect(inspectResult.id).toBe(artifactId);
        expect(inspectResult.contractsBySource.length).toBeGreaterThan(0);
        expect(inspectResult.sourceFiles.length).toBeGreaterThan(0);
        expect(inspectResult.fileSize).toBeGreaterThan(0);
        expect(inspectResult.artifactPath).toContain(`/ids/${artifactId}.json`);
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
      async ({ localStorage }) => {
        const project = createTestProjectName(TEST_CONSTANTS.PROJECTS.DEFAULT);

        await localStorage.ensureProjectSetup(project);

        await expect(
          inspectArtifact(
            { project, search: { type: "tag", tag: "non-existent-tag" } },
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
