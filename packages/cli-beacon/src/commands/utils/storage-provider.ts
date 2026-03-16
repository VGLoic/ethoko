import {
  FilesystemStorageProvider,
  S3BucketProvider,
} from "@/storage-provider";

import type { EthokoStorageConfig } from "../../config/config.js";

export function createStorageProvider(
  storageConfig: EthokoStorageConfig,
  debug?: boolean,
) {
  if (storageConfig.type === "aws") {
    return new S3BucketProvider({
      bucketName: storageConfig.bucketName,
      bucketRegion: storageConfig.region,
      credentials: storageConfig.credentials,
      debug,
    });
  }

  return new FilesystemStorageProvider({
    path: storageConfig.path,
    debug,
  });
}
