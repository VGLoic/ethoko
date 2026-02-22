import fs from "fs/promises";
import { beforeEach, describe, expect, test } from "vitest";
import {
  inspectArtifact,
  listPulledArtifacts,
  pull,
  push,
  exportContractAbi,
} from "@/cli-client/index";
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

  test.each([
    [
      "Hardhat V2 Counter",
      TEST_CONSTANTS.ARTIFACTS_FIXTURES.HARDHAT_V2_COUNTER,
    ],
    ["Foundry Counter", TEST_CONSTANTS.ARTIFACTS_FIXTURES.FOUNDRY_COUNTER],
    [
      "Hardhat V3 Counter",
      TEST_CONSTANTS.ARTIFACTS_FIXTURES.HARDHAT_V3_COUNTER,
    ],
    [
      "Foundry Build Info Counter",
      TEST_CONSTANTS.ARTIFACTS_FIXTURES.FOUNDRY_BUILD_INFO_COUNTER,
    ],
  ])(
    "push artifact [%s] without tag → pull by ID",
    async (_, artifactFixture) => {
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

      expect(artifactId).toBeTruthy();
      expect(artifactId).toHaveLength(12);

      const hasArtifact = await storageProvider.hasArtifactById(
        project,
        artifactId,
      );
      expect(hasArtifact).toBe(true);

      const pullResult = await pull(
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

      expect(pullResult.pulledIds).toContain(artifactId);
      expect(pullResult.failedIds).toHaveLength(0);

      const listArtifactsResult = await listPulledArtifacts(localStorage, {
        debug: false,
        silent: true,
      });
      expect(
        listArtifactsResult.some(
          (r) => r.id === artifactId && r.project === project,
        ),
      ).toBe(true);

      const localArtifact = await localStorage.retrieveArtifactById(
        project,
        artifactId,
      );
      const originalContent = await fs.readFile(
        artifactFixture.buildInfoPath,
        "utf-8",
      );
      const originalJson = JSON.parse(originalContent) as { id: string };

      expect(localArtifact.origin.id).toBe(originalJson.id);
    },
  );

  test("push artifact with tag → pull by tag", async () => {
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

    const hasTag = await storageProvider.hasArtifactByTag(project, tag);
    const hasId = await storageProvider.hasArtifactById(project, artifactId);
    expect(hasTag).toBe(true);
    expect(hasId).toBe(true);

    const pullResult = await pull(
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

    expect(pullResult.pulledTags).toContain(tag);
    expect(pullResult.failedTags).toHaveLength(0);

    const listArtifactsResult = await listPulledArtifacts(localStorage, {
      debug: false,
      silent: true,
    });
    expect(
      listArtifactsResult.some(
        (r) => r.tag === tag && r.project === project && r.id === artifactId,
      ),
      `Expected pulled artifacts to contain tag "${tag}" with ID "${artifactId}" for project "${project}", got: ${JSON.stringify(listArtifactsResult)}`,
    ).toBe(true);
  });

  test("pull all artifacts for a project", async () => {
    const project = createTestProjectName(
      TEST_CONSTANTS.PROJECTS.MULTI_ARTIFACT,
    );
    const artifactFixture =
      TEST_CONSTANTS.ARTIFACTS_FIXTURES.HARDHAT_V3_COUNTER;

    await localStorage.ensureProjectSetup(project);

    const tag1 = TEST_CONSTANTS.TAGS.V1;
    const tag2 = TEST_CONSTANTS.TAGS.V2;

    await push(artifactFixture.folderPath, project, tag1, storageProvider, {
      force: false,
      debug: false,
      silent: true,
    });
    await push(artifactFixture.folderPath, project, tag2, storageProvider, {
      force: true,
      debug: false,
      silent: true,
    });

    const pullResult = await pull(
      project,
      null,
      storageProvider,
      localStorage,
      { force: false, debug: false, silent: true },
    );

    expect(pullResult.pulledTags).toHaveLength(2);
    expect(pullResult.pulledTags).toContain(tag1);
    expect(pullResult.pulledTags).toContain(tag2);

    const listArtifactsResult = await listPulledArtifacts(localStorage, {
      debug: false,
      silent: true,
    });
    const pulledTags = listArtifactsResult
      .filter((r) => r.project === project)
      .map((r) => r.tag);
    expect(pulledTags).toContain(tag1);
    expect(pulledTags).toContain(tag2);
  });

  test("force push overwrites existing tag", async () => {
    const project = createTestProjectName(TEST_CONSTANTS.PROJECTS.FORCE_TEST);
    const tag = TEST_CONSTANTS.TAGS.LATEST;
    const artifactFixture =
      TEST_CONSTANTS.ARTIFACTS_FIXTURES.HARDHAT_V3_COUNTER;

    await localStorage.ensureProjectSetup(project);

    const id1 = await push(
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

    await expect(
      push(artifactFixture.folderPath, project, tag, storageProvider, {
        force: false,
        debug: false,
        silent: true,
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
        silent: true,
      },
    );

    expect(id1).toBe(id2);

    const hasTag = await storageProvider.hasArtifactByTag(project, tag);
    expect(hasTag).toBe(true);
  });

  test("pull with force re-downloads existing artifacts", async () => {
    const project = createTestProjectName(TEST_CONSTANTS.PROJECTS.DEFAULT);
    const tag = TEST_CONSTANTS.TAGS.V1;
    const artifactFixture =
      TEST_CONSTANTS.ARTIFACTS_FIXTURES.HARDHAT_V3_COUNTER;

    await localStorage.ensureProjectSetup(project);

    await push(artifactFixture.folderPath, project, tag, storageProvider, {
      force: false,
      debug: false,
      silent: true,
    });
    await pull(project, { type: "tag", tag }, storageProvider, localStorage, {
      force: false,
      debug: false,
      silent: true,
    });

    const result1 = await pull(
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
    expect(result1.pulledTags).toHaveLength(0);

    const result2 = await pull(
      project,
      { type: "tag", tag },
      storageProvider,
      localStorage,
      {
        force: true,
        debug: false,
        silent: true,
      },
    );
    expect(result2.pulledTags).toContain(tag);
  });

  test("pull non-existent artifact returns error", async () => {
    const project = createTestProjectName(TEST_CONSTANTS.PROJECTS.DEFAULT);

    await localStorage.ensureProjectSetup(project);

    await expect(
      pull(
        project,
        { tag: "non-existent-tag", type: "tag" },
        storageProvider,
        localStorage,
        {
          force: false,
          debug: false,
          silent: true,
        },
      ),
    ).rejects.toThrow();
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

  test("export contract ABI by tag", async () => {
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

    const exportFixture = artifactFixture.exportExpectedResult;

    const exportResult = await exportContractAbi(
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
    expect(exportResult.contract.name).toBe(exportFixture.name);
    expect(exportResult.contract.path).toBe(exportFixture.path);
    const expectedAbi = await fs
      .readFile(exportFixture.abiPath, "utf-8")
      .then(JSON.parse);
    expect(exportResult.contract.abi).toEqual(expectedAbi);
  });

  test("export with non-existent artifact returns error", async () => {
    const project = createTestProjectName(TEST_CONSTANTS.PROJECTS.DEFAULT);

    await localStorage.ensureProjectSetup(project);

    await expect(
      exportContractAbi(
        { project, search: { type: "tag", tag: "non-existent-tag" } },
        "Counter",
        localStorage,
        {
          debug: false,
          silent: true,
        },
      ),
    ).rejects.toThrow();
  });

  test("export contract ABI by ID", async () => {
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

    const exportResult = await exportContractAbi(
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
    expect(exportResult.contract.name).toBe(exportFixture.name);
    expect(exportResult.contract.path).toBe(exportFixture.path);
    const expectedAbi = await fs
      .readFile(exportFixture.abiPath, "utf-8")
      .then(JSON.parse);
    expect(exportResult.contract.abi).toEqual(expectedAbi);
  });

  test("export with non-existent contract returns error", async () => {
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
      exportContractAbi(
        { project, search: { type: "id", id: artifactId } },
        "NonExistentContract",
        localStorage,
        {
          debug: false,
          silent: true,
        },
      ),
    ).rejects.toThrow();
  });
});
