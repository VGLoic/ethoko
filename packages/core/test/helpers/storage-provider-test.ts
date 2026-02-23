import { test } from "vitest";
import {
  StorageProviderFactory,
  TestLocalStorageProviderFactory,
  TestS3StorageProviderFactory,
} from "./storage-provider-factory";
import { StorageProvider } from "@/storage-provider/storage-provider.interface";
import { LocalStorage } from "@/local-storage";
import { createTestLocalStorage } from "./local-storage-factory";

export const STORAGE_PROVIDER_STRATEGIES = [
  ["Local Storage Provider", new TestLocalStorageProviderFactory()],
  ["Amazon S3 Storage Provider", new TestS3StorageProviderFactory()],
] as const;

export const storageProviderTest = test.extend<{
  storageProvider: StorageProvider;
  localStorage: LocalStorage;
  storageProviderFactory: StorageProviderFactory;
}>({
  // The destructuring is required by vitest
  // eslint-disable-next-line no-empty-pattern
  storageProviderFactory: ({}, use) =>
    use(new TestLocalStorageProviderFactory()), // default, can be overridden by storageProvider.scoped({ storageProviderFactory: ... })
  storageProvider: async ({ storageProviderFactory }, use) => {
    const providerSetup = await storageProviderFactory.create();
    const storageProvider = providerSetup.storageProvider;
    await use(storageProvider);
    await providerSetup.cleanup();
  },
  // The destructuring is required by vitest
  // eslint-disable-next-line no-empty-pattern
  localStorage: async ({}, use) => {
    const localStorageSetup = await createTestLocalStorage();
    const localStorage = localStorageSetup.localStorage;
    await use(localStorage);
    await localStorageSetup.cleanup();
  },
});
