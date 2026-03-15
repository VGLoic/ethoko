import { test } from "vitest";
import {
  StorageProviderFactory,
  TestFilesystemStorageProviderFactory,
  TestS3StorageProviderFactory,
} from "./storage-provider-factory";
import { StorageProvider } from "@/storage-provider/storage-provider.interface";
import { PulledArtifactStore } from "@/pulled-artifact-store/pulled-artifact-store";
import { createTestPulledArtifactStore } from "./local-storage-factory";

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
 * Vitest test helper that provides storage provider and pulled artifact store fixtures.
 *
 * This extends the base `test` function with automatic setup/cleanup for:
 * - `storageProvider`: Storage backend (Filesystem or S3) for remote artifact storage
 * - `pulledArtifactStore`: Local filesystem storage for pulled artifacts
 * - `storageProviderFactory`: Factory for creating storage providers (can be scoped)
 *
 * @example Basic usage
 * ```typescript
 * storageProviderTest("my test", async ({ storageProvider, pulledArtifactStore }) => {
 *   // storageProvider and pulledArtifactStore are automatically set up and cleaned up
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
 *     storageProviderTest("test name", async ({ storageProvider, pulledArtifactStore }) => {
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
 *   async ([name, data], { storageProvider, pulledArtifactStore }) => {
 *     // Test runs for each data item
 *   }
 * );
 * ```
 */
export const storageProviderTest = test.extend<{
  storageProvider: StorageProvider;
  pulledArtifactStore: PulledArtifactStore;
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
  pulledArtifactStore: async ({}, use) => {
    const pulledArtifactStoreSetup = await createTestPulledArtifactStore();
    const pulledArtifactStore = pulledArtifactStoreSetup.pulledArtifactStore;
    await use(pulledArtifactStore);
    await pulledArtifactStoreSetup.cleanup();
  },
});
