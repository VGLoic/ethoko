import { beforeEach, describe, expect, test } from "vitest";
import { inspectArtifact, pull, push } from "@/cli-client/index";
import { createTestLocalStorage } from "@test/helpers/local-storage-factory";
import {
  createTestLocalStorageProvider,
  createTestS3StorageProvider,
} from "@test/helpers/storage-provider-factory";
import { TEST_CONSTANTS } from "@test/helpers/test-constants";
import { createTestProjectName } from "@test/helpers/test-utils";
import type { LocalStorage } from "@/local-storage";
import { StorageProvider } from "@/storage-provider";

describe.each([
  ["Local Storage Provider", createTestLocalStorageProvider],
  ["Amazon S3 Storage Provider", createTestS3StorageProvider],
])("Push-Pull E2E Tests (%s)", (_, createStorageProvider) => {
  let storageProvider: StorageProvider;
  let localStorage: LocalStorage;

  beforeEach(async () => {
    const providerSetup = await createStorageProvider();
    storageProvider = providerSetup.storageProvider;

    const localStorageSetup = await createTestLocalStorage();
    localStorage = localStorageSetup.localStorage;

    return async () => {
      await localStorageSetup.cleanup();
      await providerSetup.cleanup();
    };
  });

  test("inspect artifact by tag", async () => {
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

    await pull(project, { type: "tag", tag }, storageProvider, localStorage, {
      force: false,
      debug: false,
      silent: true,
    });

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
      .map((c) => c.contracts.map((contract) => `${c.sourcePath}:${contract}`))
      .flat();
    expect(new Set(fullyQualifiedPathsResult)).toEqual(
      new Set(artifactFixture.fullyQualifiedContractPaths),
    );
  });

  test("inspect artifact by ID", async () => {
    const project = createTestProjectName(TEST_CONSTANTS.PROJECTS.DEFAULT);
    const artifactFixture = TEST_CONSTANTS.ARTIFACTS_FIXTURES.FOUNDRY_COUNTER;

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
      .map((c) => c.contracts.map((contract) => `${c.sourcePath}:${contract}`))
      .flat();
    expect(new Set(fullyQualifiedPathsResult)).toEqual(
      new Set(artifactFixture.fullyQualifiedContractPaths),
    );
  });

  test("inspect non-existent artifact returns error", async () => {
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
  });
});
