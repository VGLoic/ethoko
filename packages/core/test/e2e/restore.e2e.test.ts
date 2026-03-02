import fs from "fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect } from "vitest";
import { pull, push, restore } from "@/cli-client";
import { TEST_CONSTANTS } from "@test/helpers/test-constants";
import { createTestProjectName } from "@test/helpers/test-utils";
import {
  STORAGE_PROVIDER_STRATEGIES,
  storageProviderTest,
} from "@test/helpers/storage-provider-test";

describe.for(STORAGE_PROVIDER_STRATEGIES)(
  "Restore E2E Tests (%s)",
  ([, storageProviderFactory]) => {
    storageProviderTest.scoped({ storageProviderFactory });

    let tempOutputDir: string;

    beforeEach(async () => {
      tempOutputDir = await fs.mkdtemp(
        path.join(os.tmpdir(), TEST_CONSTANTS.PATHS.TEMP_DIR_PREFIX),
      );

      return async () => {
        await fs.rm(tempOutputDir, { recursive: true, force: true });
      };
    });

    describe("generic restore functionality", () => {
      storageProviderTest(
        "restore to absolute path",
        async ({ storageProvider, localStorage }) => {
          const project = createTestProjectName(
            TEST_CONSTANTS.PROJECTS.DEFAULT,
          );
          const tag = TEST_CONSTANTS.TAGS.V1;
          const artifactFixture =
            TEST_CONSTANTS.ARTIFACTS_FIXTURES.HARDHAT_V3_COUNTER;

          await localStorage.ensureProjectSetup(project);

          await push(
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

          const outputPath = path.join(tempOutputDir, "absolute-path-test");
          const result = await restore(
            { project, search: { type: "tag", tag } },
            outputPath,
            storageProvider,
            localStorage,
            { force: false, debug: false, silent: true },
          );

          expect(result.filesRestored.length).toBeGreaterThan(0);
          expect(result.outputPath).toBe(outputPath);

          const stat = await fs.stat(outputPath);
          expect(stat.isDirectory()).toBe(true);
        },
      );

      storageProviderTest(
        "restore to relative path",
        async ({ storageProvider, localStorage }) => {
          const project = createTestProjectName(
            TEST_CONSTANTS.PROJECTS.DEFAULT,
          );
          const tag = TEST_CONSTANTS.TAGS.V1;
          const artifactFixture =
            TEST_CONSTANTS.ARTIFACTS_FIXTURES.HARDHAT_V3_COUNTER;

          await localStorage.ensureProjectSetup(project);

          await push(
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

          const relativeOutputPath = path.join(
            path.relative(process.cwd(), tempOutputDir),
            "relative-path-test",
          );
          const outputPath = path.resolve(relativeOutputPath);
          const result = await restore(
            { project, search: { type: "tag", tag } },
            relativeOutputPath,
            storageProvider,
            localStorage,
            { force: false, debug: false, silent: true },
          );

          expect(result.filesRestored.length).toBeGreaterThan(0);
          expect(result.outputPath).toBe(outputPath);

          const stat = await fs.stat(outputPath);
          expect(stat.isDirectory()).toBe(true);
        },
      );

      storageProviderTest(
        "error: output directory exists without --force",
        async ({ storageProvider, localStorage }) => {
          const project = createTestProjectName(
            TEST_CONSTANTS.PROJECTS.DEFAULT,
          );
          const tag = TEST_CONSTANTS.TAGS.V1;
          const artifactFixture =
            TEST_CONSTANTS.ARTIFACTS_FIXTURES.HARDHAT_V3_COUNTER;

          await localStorage.ensureProjectSetup(project);

          await push(
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

          const outputPath = path.join(tempOutputDir, "existing-dir-test");
          await fs.mkdir(outputPath, { recursive: true });
          await fs.writeFile(path.join(outputPath, "dummy.txt"), "content");

          await expect(
            restore(
              { project, search: { type: "tag", tag } },
              outputPath,
              storageProvider,
              localStorage,
              { force: false, debug: false, silent: true },
            ),
          ).rejects.toThrow(/not empty|overwrite/);
        },
      );

      storageProviderTest(
        "success: output directory exists with --force",
        async ({ storageProvider, localStorage }) => {
          const project = createTestProjectName(
            TEST_CONSTANTS.PROJECTS.DEFAULT,
          );
          const tag = TEST_CONSTANTS.TAGS.V1;
          const artifactFixture =
            TEST_CONSTANTS.ARTIFACTS_FIXTURES.HARDHAT_V3_COUNTER;

          await localStorage.ensureProjectSetup(project);

          await push(
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

          const outputPath = path.join(tempOutputDir, "force-overwrite-test");
          await fs.mkdir(outputPath, { recursive: true });
          await fs.writeFile(path.join(outputPath, "dummy.txt"), "content");

          const result = await restore(
            { project, search: { type: "tag", tag } },
            outputPath,
            storageProvider,
            localStorage,
            { force: true, debug: false, silent: true },
          );

          expect(result.filesRestored.length).toBeGreaterThan(0);
        },
      );

      storageProviderTest(
        "error: artifact not pulled (tag not found locally)",
        async ({ storageProvider, localStorage }) => {
          const project = createTestProjectName(
            TEST_CONSTANTS.PROJECTS.DEFAULT,
          );
          const outputPath = path.join(tempOutputDir, "not-pulled-test");

          await localStorage.ensureProjectSetup(project);

          await expect(
            restore(
              { project, search: { type: "tag", tag: "non-pulled-tag" } },
              outputPath,
              storageProvider,
              localStorage,
              { force: false, debug: false, silent: true },
            ),
          ).rejects.toThrow();
        },
      );

      storageProviderTest(
        "error: invalid project",
        async ({ storageProvider, localStorage }) => {
          const outputPath = path.join(tempOutputDir, "invalid-project-test");

          await expect(
            restore(
              {
                project: "non-existent-project",
                search: { type: "tag", tag: TEST_CONSTANTS.TAGS.V1 },
              },
              outputPath,
              storageProvider,
              localStorage,
              { force: false, debug: false, silent: true },
            ),
          ).rejects.toThrow();
        },
      );
    });

    storageProviderTest.for([
      [
        "Hardhat V3",
        TEST_CONSTANTS.ARTIFACTS_FIXTURES.HARDHAT_V3_COUNTER,
        [
          ...TEST_CONSTANTS.ARTIFACTS_FIXTURES.HARDHAT_V3_COUNTER.buildInfoPaths.flatMap(
            (buildInfoPath) => [
              buildInfoPath,
              buildInfoPath.replace(".json", ".output.json"),
            ],
          ),
          path.resolve(
            TEST_CONSTANTS.ARTIFACTS_FIXTURES.HARDHAT_V3_COUNTER.folderPath,
            "contracts/Counter.sol/Counter.json",
          ),
        ],
      ],
      [
        "Hardhat V2",
        TEST_CONSTANTS.ARTIFACTS_FIXTURES.HARDHAT_V2_COUNTER,
        TEST_CONSTANTS.ARTIFACTS_FIXTURES.HARDHAT_V2_COUNTER.buildInfoPaths,
      ],
      [
        "Forge default",
        TEST_CONSTANTS.ARTIFACTS_FIXTURES.FOUNDRY_COUNTER,
        [
          TEST_CONSTANTS.ARTIFACTS_FIXTURES.FOUNDRY_COUNTER.buildInfoPaths[0],
          path.resolve(
            TEST_CONSTANTS.ARTIFACTS_FIXTURES.FOUNDRY_COUNTER.folderPath,
            "Counter.sol/Counter.json",
          ),
        ],
      ],
      [
        "Forge with build-info",
        TEST_CONSTANTS.ARTIFACTS_FIXTURES.FOUNDRY_BUILD_INFO_COUNTER,
        [
          TEST_CONSTANTS.ARTIFACTS_FIXTURES.FOUNDRY_BUILD_INFO_COUNTER
            .buildInfoPaths[0],
          path.resolve(
            TEST_CONSTANTS.ARTIFACTS_FIXTURES.FOUNDRY_BUILD_INFO_COUNTER
              .folderPath,
            "Counter.sol/Counter.json",
          ),
        ],
      ],
    ] as const)(
      "%s artifacts - restore by tag",
      async (
        [, artifactFixture, expectedOriginalPaths],
        { storageProvider, localStorage },
      ) => {
        const project = createTestProjectName(TEST_CONSTANTS.PROJECTS.DEFAULT);
        const tag = TEST_CONSTANTS.TAGS.V1;

        await localStorage.ensureProjectSetup(project);

        await push(artifactFixture.folderPath, project, tag, storageProvider, {
          force: false,
          debug: false,
          silent: true,
        });

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

        const outputPath = path.join(tempOutputDir, `${tag}-tag-test`);
        const result = await restore(
          { project, search: { type: "tag", tag } },
          outputPath,
          storageProvider,
          localStorage,
          { force: false, debug: false, silent: true },
        );

        expect(result.project).toBe(project);
        expect(result.tag).toBe(tag);
        const expectedPaths = expectedOriginalPaths.map(sanitizePath);

        expect(result.filesRestored.length).toBe(expectedPaths.length);

        for (const expectedPath of expectedPaths) {
          const fullPath = path.join(outputPath, expectedPath);
          const stat = await fs.stat(fullPath);
          expect(stat.isFile()).toBe(true);
        }
      },
    );

    storageProviderTest.for([
      [
        "Hardhat V3",
        TEST_CONSTANTS.ARTIFACTS_FIXTURES.HARDHAT_V3_COUNTER,
        [
          ...TEST_CONSTANTS.ARTIFACTS_FIXTURES.HARDHAT_V3_COUNTER.buildInfoPaths.flatMap(
            (buildInfoPath) => [
              buildInfoPath,
              buildInfoPath.replace(".json", ".output.json"),
            ],
          ),
          path.resolve(
            TEST_CONSTANTS.ARTIFACTS_FIXTURES.HARDHAT_V3_COUNTER.folderPath,
            "contracts/Counter.sol/Counter.json",
          ),
        ],
      ],
      [
        "Hardhat V2",
        TEST_CONSTANTS.ARTIFACTS_FIXTURES.HARDHAT_V2_COUNTER,
        TEST_CONSTANTS.ARTIFACTS_FIXTURES.HARDHAT_V2_COUNTER.buildInfoPaths,
      ],
      [
        "Forge default",
        TEST_CONSTANTS.ARTIFACTS_FIXTURES.FOUNDRY_COUNTER,
        [
          TEST_CONSTANTS.ARTIFACTS_FIXTURES.FOUNDRY_COUNTER.buildInfoPaths[0],
          path.resolve(
            TEST_CONSTANTS.ARTIFACTS_FIXTURES.FOUNDRY_COUNTER.folderPath,
            "Counter.sol/Counter.json",
          ),
        ],
      ],
      [
        "Forge with build-info",
        TEST_CONSTANTS.ARTIFACTS_FIXTURES.FOUNDRY_BUILD_INFO_COUNTER,
        [
          TEST_CONSTANTS.ARTIFACTS_FIXTURES.FOUNDRY_BUILD_INFO_COUNTER
            .buildInfoPaths[0],
          path.resolve(
            TEST_CONSTANTS.ARTIFACTS_FIXTURES.FOUNDRY_BUILD_INFO_COUNTER
              .folderPath,
            "Counter.sol/Counter.json",
          ),
        ],
      ],
    ] as const)(
      "%s artifacts - restore by ID",
      async (
        [, artifactFixture, expectedOriginalPaths],
        { storageProvider, localStorage },
      ) => {
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

        const outputPath = path.join(tempOutputDir, `${artifactId}-id-test`);
        const result = await restore(
          { project, search: { type: "id", id: artifactId } },
          outputPath,
          storageProvider,
          localStorage,
          { force: false, debug: false, silent: true },
        );

        expect(result.project).toBe(project);
        expect(result.tag).toBe(null);
        expect(result.id).toBe(artifactId);
        const expectedPaths = expectedOriginalPaths.map(sanitizePath);

        expect(result.filesRestored.length).toBe(expectedPaths.length);

        for (const expectedPath of expectedPaths) {
          const fullPath = path.join(outputPath, expectedPath);
          const stat = await fs.stat(fullPath);
          expect(stat.isFile()).toBe(true);
        }
      },
    );
  },
);

function sanitizePath(filePath: string): string {
  if (filePath.startsWith("/")) {
    return filePath.substring(1);
  }
  if (filePath.startsWith("./")) {
    return filePath.substring(2);
  }
  return filePath;
}
