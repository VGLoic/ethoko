import { describe, expect } from "vitest";
import {
  CliError,
  pruneArtifact,
  pruneOrphanedAndUntaggedArtifacts,
  pruneProjectArtifacts,
  pullArtifact,
  pullProject,
  push,
} from "@/client/index";
import { ARTIFACTS_STRATEGIES } from "@test/helpers/artifacts-strategy";
import {
  STORAGE_PROVIDER_STRATEGIES,
  storageProviderTest,
} from "@test/helpers/storage-provider-test";
import { createTestProjectName } from "@test/helpers/test-utils";
import { CommandLogger } from "@/ui";

const logger = new CommandLogger(true);
const [, artifactFixture] = ARTIFACTS_STRATEGIES[0];
const [, artifactFixture2] = ARTIFACTS_STRATEGIES[1];

describe.for(STORAGE_PROVIDER_STRATEGIES)(
  "Prune E2E Tests (%s)",
  ([, storageProviderFactory]) => {
    storageProviderTest.scoped({ storageProviderFactory });

    // ── pruneOrphanedAndUntaggedArtifacts ────────────────────────────────────

    storageProviderTest(
      "pruneOrphanedAndUntaggedArtifacts - prunes orphaned project",
      async ({ storageProvider, pulledArtifactStore }) => {
        const project = createTestProjectName("prune-orphaned");
        await pulledArtifactStore.ensureProjectSetup(project);
        const tag = "orphaned-tag";
        const artifactId = await push(
          artifactFixture.folderPath,
          project,
          tag,
          storageProvider,
          { force: false, debug: false, logger },
        );
        await pullArtifact(
          { project, type: "tag", tag },
          storageProvider,
          pulledArtifactStore,
          { force: false, debug: false, logger },
        );

        const result = await pruneOrphanedAndUntaggedArtifacts(
          pulledArtifactStore,
          new Set([]),
          { dryRun: false, debug: false, logger },
        );

        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
          project,
          id: artifactId,
          tag,
        });
        expect(await pulledArtifactStore.hasId(project, artifactId)).toBe(
          false,
        );
        expect(await pulledArtifactStore.hasTag(project, tag)).toBe(false);
      },
    );

    storageProviderTest(
      "pruneOrphanedAndUntaggedArtifacts - preserves tagged artifact in configured project",
      async ({ storageProvider, pulledArtifactStore }) => {
        const project = createTestProjectName("prune-configured-tagged");
        await pulledArtifactStore.ensureProjectSetup(project);
        const tag = "v1.0.0";
        const artifactId = await push(
          artifactFixture.folderPath,
          project,
          tag,
          storageProvider,
          { force: false, debug: false, logger },
        );
        await pullArtifact(
          { project, type: "tag", tag },
          storageProvider,
          pulledArtifactStore,
          { force: false, debug: false, logger },
        );

        const result = await pruneOrphanedAndUntaggedArtifacts(
          pulledArtifactStore,
          new Set([project]),
          { dryRun: false, debug: false, logger },
        );

        expect(result).toHaveLength(0);
        expect(await pulledArtifactStore.hasId(project, artifactId)).toBe(true);
        expect(await pulledArtifactStore.hasTag(project, tag)).toBe(true);
      },
    );

    storageProviderTest(
      "pruneOrphanedAndUntaggedArtifacts - prunes untagged artifact from configured project",
      async ({ storageProvider, pulledArtifactStore }) => {
        const project = createTestProjectName("prune-configured-untagged");
        await pulledArtifactStore.ensureProjectSetup(project);
        const artifactId = await push(
          artifactFixture.folderPath,
          project,
          undefined,
          storageProvider,
          { force: false, debug: false, logger },
        );
        await pullArtifact(
          { project, type: "id", id: artifactId },
          storageProvider,
          pulledArtifactStore,
          { force: false, debug: false, logger },
        );

        const result = await pruneOrphanedAndUntaggedArtifacts(
          pulledArtifactStore,
          new Set([project]),
          { dryRun: false, debug: false, logger },
        );

        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({ project, id: artifactId, tag: null });
        expect(await pulledArtifactStore.hasId(project, artifactId)).toBe(
          false,
        );
      },
    );

    storageProviderTest(
      "pruneOrphanedAndUntaggedArtifacts - dry run does not delete",
      async ({ storageProvider, pulledArtifactStore }) => {
        const project = createTestProjectName("prune-ota-dry");
        await pulledArtifactStore.ensureProjectSetup(project);
        const artifactId = await push(
          artifactFixture.folderPath,
          project,
          undefined,
          storageProvider,
          { force: false, debug: false, logger },
        );
        await pullArtifact(
          { project, type: "id", id: artifactId },
          storageProvider,
          pulledArtifactStore,
          { force: false, debug: false, logger },
        );

        const result = await pruneOrphanedAndUntaggedArtifacts(
          pulledArtifactStore,
          new Set([]),
          { dryRun: true, debug: false, logger },
        );

        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({ project, id: artifactId, tag: null });
        expect(await pulledArtifactStore.hasId(project, artifactId)).toBe(true);
      },
    );

    storageProviderTest(
      "pruneOrphanedAndUntaggedArtifacts - empty store returns empty list",
      async ({ pulledArtifactStore }) => {
        const result = await pruneOrphanedAndUntaggedArtifacts(
          pulledArtifactStore,
          new Set([]),
          { dryRun: false, debug: false, logger },
        );
        expect(result).toHaveLength(0);
      },
    );

    // ── pruneProjectArtifacts ────────────────────────────────────────────────

    storageProviderTest(
      "pruneProjectArtifacts - deletes all artifacts",
      async ({ storageProvider, pulledArtifactStore }) => {
        const project = createTestProjectName("prune-project");
        await pulledArtifactStore.ensureProjectSetup(project);
        const tag = "v1.0.0";

        // tagged artifact
        const taggedId = await push(
          artifactFixture.folderPath,
          project,
          tag,
          storageProvider,
          { force: false, debug: false, logger },
        );

        // untagged artifact (different content to produce a different ID)
        const untaggedId = await push(
          artifactFixture2.folderPath,
          project,
          undefined,
          storageProvider,
          { force: false, debug: false, logger },
        );
        await pullProject(project, storageProvider, pulledArtifactStore, {
          force: false,
          debug: false,
          logger,
        });

        const result = await pruneProjectArtifacts(
          project,
          pulledArtifactStore,
          {
            dryRun: false,
            debug: false,
            logger,
          },
        );

        expect(result.map((r) => r.id)).toEqual(
          expect.arrayContaining([taggedId, untaggedId]),
        );
        // tagged artifact - both tag and ID should be deleted
        expect(await pulledArtifactStore.hasTag(project, tag)).toBe(false);
        expect(await pulledArtifactStore.hasId(project, taggedId)).toBe(false);
        // untagged artifact - only ID should be deleted
        expect(await pulledArtifactStore.hasId(project, untaggedId)).toBe(
          false,
        );
      },
    );

    storageProviderTest(
      "pruneProjectArtifacts - dry run does not delete",
      async ({ storageProvider, pulledArtifactStore }) => {
        const project = createTestProjectName("prune-project-dry");
        await pulledArtifactStore.ensureProjectSetup(project);
        const artifactId = await push(
          artifactFixture.folderPath,
          project,
          undefined,
          storageProvider,
          { force: false, debug: false, logger },
        );
        await pullArtifact(
          { project, type: "id", id: artifactId },
          storageProvider,
          pulledArtifactStore,
          { force: false, debug: false, logger },
        );

        const result = await pruneProjectArtifacts(
          project,
          pulledArtifactStore,
          {
            dryRun: true,
            debug: false,
            logger,
          },
        );

        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({ project, id: artifactId, tag: null });
        expect(await pulledArtifactStore.hasId(project, artifactId)).toBe(true);
      },
    );

    // ── pruneArtifactById ────────────────────────────────────────────────────

    storageProviderTest(
      "pruneArtifact - by ID - deletes artifact",
      async ({ storageProvider, pulledArtifactStore }) => {
        const project = createTestProjectName("prune-by-id");
        await pulledArtifactStore.ensureProjectSetup(project);
        const artifactId = await push(
          artifactFixture.folderPath,
          project,
          undefined,
          storageProvider,
          { force: false, debug: false, logger },
        );
        await pullArtifact(
          { project, type: "id", id: artifactId },
          storageProvider,
          pulledArtifactStore,
          { force: false, debug: false, logger },
        );

        const result = await pruneArtifact(
          { project, type: "id", id: artifactId },
          pulledArtifactStore,
          { dryRun: false, debug: false, logger },
        );

        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({ project, id: artifactId, tag: null });
        expect(await pulledArtifactStore.hasId(project, artifactId)).toBe(
          false,
        );
      },
    );

    storageProviderTest(
      "pruneArtifact - by ID - dry run does not delete",
      async ({ storageProvider, pulledArtifactStore }) => {
        const project = createTestProjectName("prune-by-id-dry");
        await pulledArtifactStore.ensureProjectSetup(project);
        const artifactId = await push(
          artifactFixture.folderPath,
          project,
          undefined,
          storageProvider,
          { force: false, debug: false, logger },
        );
        await pullArtifact(
          { project, type: "id", id: artifactId },
          storageProvider,
          pulledArtifactStore,
          { force: false, debug: false, logger },
        );

        const result = await pruneArtifact(
          { project, type: "id", id: artifactId },
          pulledArtifactStore,
          { dryRun: true, debug: false, logger },
        );

        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({ project, id: artifactId, tag: null });
        expect(await pulledArtifactStore.hasId(project, artifactId)).toBe(true);
      },
    );

    storageProviderTest(
      "pruneArtifact - by ID - throws CliError when ID not found",
      async ({ pulledArtifactStore }) => {
        const project = createTestProjectName("prune-by-id-missing");
        await pulledArtifactStore.ensureProjectSetup(project);

        await expect(
          pruneArtifact(
            { project, type: "id", id: "nonexistentid" },
            pulledArtifactStore,
            {
              dryRun: false,
              debug: false,
              logger,
            },
          ),
        ).rejects.toThrow(CliError);
      },
    );

    // ── pruneArtifactByTag ───────────────────────────────────────────────────

    storageProviderTest(
      "pruneArtifact - by tag - deletes artifact",
      async ({ storageProvider, pulledArtifactStore }) => {
        const project = createTestProjectName("prune-by-tag");
        await pulledArtifactStore.ensureProjectSetup(project);
        const tag = "v1.0.0";
        const artifactId = await push(
          artifactFixture.folderPath,
          project,
          tag,
          storageProvider,
          { force: false, debug: false, logger },
        );
        await pullArtifact(
          { project, type: "tag", tag },
          storageProvider,
          pulledArtifactStore,
          { force: false, debug: false, logger },
        );

        const result = await pruneArtifact(
          { project, type: "tag", tag },
          pulledArtifactStore,
          { dryRun: false, debug: false, logger },
        );

        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({ project, id: artifactId, tag });
        expect(await pulledArtifactStore.hasId(project, artifactId)).toBe(
          false,
        );
      },
    );

    storageProviderTest(
      "pruneArtifact - by tag - dry run does not delete",
      async ({ storageProvider, pulledArtifactStore }) => {
        const project = createTestProjectName("prune-by-tag-dry");
        await pulledArtifactStore.ensureProjectSetup(project);
        const tag = "v1.0.0";
        const artifactId = await push(
          artifactFixture.folderPath,
          project,
          tag,
          storageProvider,
          { force: false, debug: false, logger },
        );
        await pullArtifact(
          { project, type: "tag", tag },
          storageProvider,
          pulledArtifactStore,
          { force: false, debug: false, logger },
        );

        const result = await pruneArtifact(
          { project, type: "tag", tag },
          pulledArtifactStore,
          { dryRun: true, debug: false, logger },
        );

        expect(result).toHaveLength(1);
        expect(await pulledArtifactStore.hasTag(project, tag)).toBe(true);
        expect(await pulledArtifactStore.hasId(project, artifactId)).toBe(true);
      },
    );

    storageProviderTest(
      "pruneArtifact - by tag - throws CliError when tag not found",
      async ({ pulledArtifactStore }) => {
        const project = createTestProjectName("prune-by-tag-missing");
        await pulledArtifactStore.ensureProjectSetup(project);

        await expect(
          pruneArtifact(
            { project, type: "tag", tag: "nonexistent-tag" },
            pulledArtifactStore,
            {
              dryRun: false,
              debug: false,
              logger,
            },
          ),
        ).rejects.toThrow(CliError);
      },
    );
  },
);
