import fs from "fs/promises";
import os from "os";
import path from "path";
import {
  LocalStorageProvider,
  StorageProvider,
  S3BucketProvider,
} from "@/storage-provider";
import { TEST_CONSTANTS } from "./test-constants";

export abstract class StorageProviderFactory<
  T extends StorageProvider = StorageProvider,
> {
  abstract create(): Promise<TestStorageProvider<T>>;
}
interface TestStorageProvider<T extends StorageProvider = StorageProvider> {
  storageProvider: T;
  cleanup: () => Promise<void>;
}

export class TestLocalStorageProviderFactory extends StorageProviderFactory<LocalStorageProvider> {
  constructor(private debug: boolean = false) {
    super();
  }

  async create(): Promise<TestStorageProvider<LocalStorageProvider>> {
    const tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), TEST_CONSTANTS.PATHS.TEMP_DIR_PREFIX),
    );

    const storageProvider = new LocalStorageProvider({
      path: tempDir,
      debug: this.debug,
    });

    const cleanup = async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
    };

    return { storageProvider, cleanup };
  }
}

export class TestS3StorageProviderFactory extends StorageProviderFactory<S3BucketProvider> {
  constructor(private debug: boolean = false) {
    super();
  }

  async create(): Promise<TestStorageProvider<S3BucketProvider>> {
    const storageProvider = new S3BucketProvider({
      bucketName: TEST_CONSTANTS.BUCKET_NAME,
      bucketRegion: TEST_CONSTANTS.LOCALSTACK.REGION,
      credentials: {
        type: "static",
        accessKeyId: TEST_CONSTANTS.LOCALSTACK.ACCESS_KEY_ID,
        secretAccessKey: TEST_CONSTANTS.LOCALSTACK.SECRET_ACCESS_KEY,
      },
      endpoint: TEST_CONSTANTS.LOCALSTACK.ENDPOINT,
      forcePathStyle: true,
      debug: this.debug,
      rootPath: "projects",
    });

    const cleanup = async () => {
      // No cleanup needed for S3 provider in this test setup
    };

    return { storageProvider, cleanup };
  }
}
