import {
  LocalStorageProvider,
  S3BucketProvider,
} from "@ethoko/core/storage-provider";

import type { EthokoCliConfig } from "../config.js";

export function createStorageProvider(config: EthokoCliConfig) {
  if (config.storage.type === "aws") {
    const credentials =
      config.storage.awsAccessKeyId && config.storage.awsSecretAccessKey
        ? {
            accessKeyId: config.storage.awsAccessKeyId,
            secretAccessKey: config.storage.awsSecretAccessKey,
            role: config.awsRole
              ? {
                  roleArn: config.awsRole.awsRoleArn,
                  externalId: config.awsRole.awsRoleExternalId,
                  sessionName: config.awsRole.awsRoleSessionName,
                  durationSeconds: config.awsRole.awsRoleDurationSeconds,
                }
              : undefined,
          }
        : undefined;

    return new S3BucketProvider({
      bucketName: config.storage.awsBucketName,
      bucketRegion: config.storage.awsRegion,
      credentials,
      debug: config.debug,
    });
  }

  return new LocalStorageProvider({
    path: config.storage.path,
    debug: config.debug,
  });
}
