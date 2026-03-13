import { LocalStorageProvider, S3BucketProvider } from "@/storage-provider";

import type { EthokoCliConfig } from "../config.js";

export function createStorageProvider(config: EthokoCliConfig) {
  if (config.storage.type === "aws") {
    return new S3BucketProvider({
      bucketName: config.storage.bucketName,
      bucketRegion: config.storage.region,
      credentials: config.storage.credentials,
      debug: config.debug,
    });
  }

  return new LocalStorageProvider({
    path: config.storage.path,
    debug: config.debug,
  });
}
