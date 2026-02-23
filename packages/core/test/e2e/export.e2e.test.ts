import fs from "fs/promises";
import { beforeEach, describe, expect, test } from "vitest";
import { pull, push, exportContractAbi } from "@/cli-client/index";
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
