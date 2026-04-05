import fs from "fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect } from "vitest";
import { pullArtifact, push, restore } from "@/client";
import { TEST_CONSTANTS } from "@test/helpers/test-constants";
import { createTestProjectName } from "@test/helpers/test-utils";
import {
  STORAGE_PROVIDER_STRATEGIES,
  storageProviderTest,
} from "@test/helpers/storage-provider-test";
import { ARTIFACTS_STRATEGIES } from "@test/helpers/artifacts-strategy";
import { deriveAllAbsolutePathsInDirectory } from "@test/helpers/derive-all-paths-in-directory";
import { CommandLogger } from "@/ui";
import { AbsolutePath } from "@/utils/path";

describe.for(STORAGE_PROVIDER_STRATEGIES)(
  "Restore E2E Tests (%s)",
  ([, storageProviderFactory]) => {
    const logger = new CommandLogger(true);
    storageProviderTest.scoped({ storageProviderFactory });

    let tempOutputDir: AbsolutePath;

    beforeEach(async () => {
      const tempOutputDirName = await fs.mkdtemp(
        path.join(os.tmpdir(), TEST_CONSTANTS.PATHS.TEMP_DIR_PREFIX),
      );
      tempOutputDir = new AbsolutePath(tempOutputDirName);

      return async () => {
        await fs.rm(tempOutputDir.resolvedPath, {
          recursive: true,
          force: true,
        });
      };
    });

    describe("generic restore functionality", () => {
      storageProviderTest(
        "restore to absolute path",
        async ({ storageProvider, pulledArtifactStore }) => {
          const project = createTestProjectName(
            TEST_CONSTANTS.PROJECTS.DEFAULT,
          );
          const tag = TEST_CONSTANTS.TAGS.V1;
          const artifactFixture =
            TEST_CONSTANTS.ARTIFACTS_FIXTURES.COUNTER.TARGETS.HARDHAT_V3;

          await pulledArtifactStore.ensureProjectSetup(project);

          await push(
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

          const outputPath = tempOutputDir.join("absolute-path-test");
          const result = await restore(
            { project, type: "tag", tag },
            outputPath,
            storageProvider,
            pulledArtifactStore,
            { force: false, debug: false, logger },
          );

          expect(result.filesRestored.length).toBeGreaterThan(0);
          expect(result.outputPath).toBe(outputPath);

          const stat = await fs.stat(outputPath.resolvedPath);
          expect(stat.isDirectory()).toBe(true);
        },
      );

      storageProviderTest(
        "error: output directory exists without --force",
        async ({ storageProvider, pulledArtifactStore }) => {
          const project = createTestProjectName(
            TEST_CONSTANTS.PROJECTS.DEFAULT,
          );
          const tag = TEST_CONSTANTS.TAGS.V1;
          const artifactFixture =
            TEST_CONSTANTS.ARTIFACTS_FIXTURES.COUNTER.TARGETS.HARDHAT_V3;

          await pulledArtifactStore.ensureProjectSetup(project);

          await push(
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

          const outputPath = tempOutputDir.join("existing-dir-test");
          await fs.mkdir(outputPath.resolvedPath, { recursive: true });
          await fs.writeFile(
            outputPath.join("dummy.txt").resolvedPath,
            "content",
          );

          await expect(
            restore(
              { project, type: "tag", tag },
              outputPath,
              storageProvider,
              pulledArtifactStore,
              { force: false, debug: false, logger },
            ),
          ).rejects.toThrow(/not empty|overwrite/);
        },
      );

      storageProviderTest(
        "success: output directory exists with --force",
        async ({ storageProvider, pulledArtifactStore }) => {
          const project = createTestProjectName(
            TEST_CONSTANTS.PROJECTS.DEFAULT,
          );
          const tag = TEST_CONSTANTS.TAGS.V1;
          const artifactFixture =
            TEST_CONSTANTS.ARTIFACTS_FIXTURES.COUNTER.TARGETS.HARDHAT_V3;

          await pulledArtifactStore.ensureProjectSetup(project);

          await push(
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

          const outputPath = tempOutputDir.join("force-overwrite-test");
          await fs.mkdir(outputPath.resolvedPath, { recursive: true });
          await fs.writeFile(
            outputPath.join("dummy.txt").resolvedPath,
            "content",
          );

          const result = await restore(
            { project, type: "tag", tag },
            outputPath,
            storageProvider,
            pulledArtifactStore,
            { force: true, debug: false, logger },
          );

          expect(result.filesRestored.length).toBeGreaterThan(0);
        },
      );

      storageProviderTest(
        "error: artifact not existing",
        async ({ storageProvider, pulledArtifactStore }) => {
          const project = createTestProjectName(
            TEST_CONSTANTS.PROJECTS.DEFAULT,
          );
          const outputPath = tempOutputDir.join("not-existing-tag-test");

          await pulledArtifactStore.ensureProjectSetup(project);

          await expect(
            restore(
              { project, type: "tag", tag: "non-existing-tag" },
              outputPath,
              storageProvider,
              pulledArtifactStore,
              { force: false, debug: false, logger },
            ),
          ).rejects.toThrow();
        },
      );

      storageProviderTest(
        "error: invalid project",
        async ({ storageProvider, pulledArtifactStore }) => {
          const outputPath = tempOutputDir.join("invalid-project-test");

          await expect(
            restore(
              {
                project: "non-existent-project",
                type: "tag",
                tag: TEST_CONSTANTS.TAGS.V1,
              },
              outputPath,
              storageProvider,
              pulledArtifactStore,
              { force: false, debug: false, logger },
            ),
          ).rejects.toThrow();
        },
      );
    });

    describe.for([[false], [true]] as const)(
      "artifact already pulled: %s",
      ([artifactAlreadyPulled]) => {
        storageProviderTest.for(ARTIFACTS_STRATEGIES)(
          "%s artifacts - restore by tag",
          async (
            [, artifactFixture],
            { storageProvider, pulledArtifactStore },
          ) => {
            const project = createTestProjectName(
              TEST_CONSTANTS.PROJECTS.DEFAULT,
            );
            const tag = TEST_CONSTANTS.TAGS.V1;

            await pulledArtifactStore.ensureProjectSetup(project);

            await push(
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

            const outputPath = tempOutputDir.join(`${tag}-tag-test`);
            const result = await restore(
              { project, type: "tag", tag },
              outputPath,
              storageProvider,
              pulledArtifactStore,
              { force: false, debug: false, logger },
            );

            expect(result.project).toBe(project);
            expect(result.tag).toBe(tag);
            const expectedOriginalAbsolutePaths =
              await deriveAllAbsolutePathsInDirectory(
                artifactFixture.folderPath,
              );
            const expectedRelativePaths = expectedOriginalAbsolutePaths.map(
              (p) => p.relativeTo(artifactFixture.folderPath),
            );

            expect(result.filesRestored.length).toBe(
              expectedRelativePaths.length,
            );

            for (const expectedRelativePath of expectedRelativePaths) {
              const fullPath = outputPath.join(expectedRelativePath);
              const stat = await fs.stat(fullPath.resolvedPath);
              expect(stat.isFile()).toBe(true);
            }
          },
        );

        storageProviderTest.for(ARTIFACTS_STRATEGIES)(
          "%s artifacts - restore by ID",
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

            const outputPath = tempOutputDir.join(`${artifactId}-id-test`);
            const result = await restore(
              { project, type: "id", id: artifactId },
              outputPath,
              storageProvider,
              pulledArtifactStore,
              { force: false, debug: false, logger },
            );

            expect(result.project).toBe(project);
            expect(result.tag).toBe(null);
            expect(result.id).toBe(artifactId);
            const expectedOriginalAbsolutePaths =
              await deriveAllAbsolutePathsInDirectory(
                artifactFixture.folderPath,
              );
            const expectedRelativePaths = expectedOriginalAbsolutePaths.map(
              (p) => p.relativeTo(artifactFixture.folderPath),
            );

            expect(result.filesRestored.length).toBe(
              expectedRelativePaths.length,
            );

            for (const expectedRelativePath of expectedRelativePaths) {
              const fullPath = outputPath.join(expectedRelativePath);
              const stat = await fs.stat(fullPath.resolvedPath);
              expect(stat.isFile()).toBe(true);
            }
          },
        );
      },
    );
  },
);
