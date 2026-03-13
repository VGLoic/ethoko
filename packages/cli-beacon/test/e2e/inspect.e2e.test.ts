import { describe, expect } from "vitest";
import { inspectArtifact, pull, push } from "@/cli-client/index";
import { TEST_CONSTANTS } from "@test/helpers/test-constants";
import { createTestProjectName } from "@test/helpers/test-utils";
import {
  STORAGE_PROVIDER_STRATEGIES,
  storageProviderTest,
} from "@test/helpers/storage-provider-test";
import { ARTIFACTS_STRATEGIES } from "@test/helpers/artifacts-strategy";

describe.for(STORAGE_PROVIDER_STRATEGIES)(
  "Inspect E2E Tests (%s)",
  ([, storageProviderFactory]) => {
    storageProviderTest.scoped({ storageProviderFactory });

    storageProviderTest.for(ARTIFACTS_STRATEGIES)(
      "%s artifacts - inspect artifact by tag",
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
            debug: true,
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
