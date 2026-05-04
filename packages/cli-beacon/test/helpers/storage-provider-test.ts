import { test } from "vitest";
import {
  StorageProviderFactory,
  TestFilesystemStorageProviderFactory,
  TestS3StorageProviderFactory,
} from "./storage-provider-factory";
import { StorageProvider } from "@/storage-provider/storage-provider.interface";
import { LocalArtifactStore } from "@/local-artifact-store";
import { createTestLocalArtifactStore } from "./local-storage-factory";

/**
 * Available storage provider strategies for E2E testing.
 * Each strategy consists of a display name and a factory instance.
 *
 * Strategies:
 * - Filesystem Storage Provider: Uses filesystem-based storage (fast, no external deps)
 * - Amazon S3 Storage Provider: Uses LocalStack S3 mock (realistic, requires LocalStack)
 */
export const STORAGE_PROVIDER_STRATEGIES = [
  ["Filesystem Storage Provider", new TestFilesystemStorageProviderFactory()],
  ["Amazon S3 Storage Provider", new TestS3StorageProviderFactory()],
] as const;

/**
 * Vitest test helper that provides storage provider and local artifact store fixtures.
 *
 * This extends the base `test` function with automatic setup/cleanup for:
 * - `storageProvider`: Storage backend (Filesystem or S3) for remote artifact storage
 * - `localArtifactStore`: Local Artifact Store on the local filesystem
 * - `storageProviderFactory`: Factory for creating storage providers (can be scoped)
 *
 * @example Basic usage
 * ```typescript
 * storageProviderTest("my test", async ({ storageProvider, localArtifactStore }) => {
 *   // storageProvider and localArtifactStore are automatically set up and cleaned up
 *   await push(artifactPath, project, tag, storageProvider, { ... });
 * });
 * ```
 *
 * @example Testing across multiple storage providers
 * ```typescript
 * describe.for(STORAGE_PROVIDER_STRATEGIES)(
 *   "My Test Suite (%s)",
 *   ([, storageProviderFactory]) => {
 *     storageProviderTest.scoped({ storageProviderFactory });
 *
 *     storageProviderTest("test name", async ({ storageProvider, localArtifactStore }) => {
 *       // Test runs once for Filesystem Storage, once for S3
 *     });
 *   }
 * );
 * ```
 *
 * @example Parameterized tests with test.for
 * ```typescript
 * storageProviderTest.for([
 *   ["Test Case 1", someData1],
 *   ["Test Case 2", someData2],
 * ] as const)(
 *   "test: %s",
 *   async ([name, data], { storageProvider, localArtifactStore }) => {
 *     // Test runs for each data item
 *   }
 * );
 * ```
 */
export const storageProviderTest = test.extend<{
  storageProvider: StorageProvider;
  localArtifactStore: LocalArtifactStore;
  storageProviderFactory: StorageProviderFactory;
}>({
  // The destructuring is required by vitest
  // eslint-disable-next-line no-empty-pattern
  storageProviderFactory: ({}, use) =>
    use(new TestFilesystemStorageProviderFactory()), // default, can be overridden by storageProvider.scoped({ storageProviderFactory: ... })
  storageProvider: async ({ storageProviderFactory }, use) => {
    const providerSetup = await storageProviderFactory.create();
    const storageProvider = providerSetup.storageProvider;
    await use(storageProvider);
    await providerSetup.cleanup();
  },
  // The destructuring is required by vitest
  // eslint-disable-next-line no-empty-pattern
  localArtifactStore: async ({}, use) => {
    const localArtifactStoreSetup = await createTestLocalArtifactStore();
    const localArtifactStore = localArtifactStoreSetup.localArtifactStore;
    await use(localArtifactStore);
    await localArtifactStoreSetup.cleanup();
  },
});
