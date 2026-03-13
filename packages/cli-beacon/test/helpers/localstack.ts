import { exec } from "child_process";
import { promisify } from "util";
import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { TEST_CONSTANTS } from "./test-constants";
import { TestSession } from "./test-session";

const execAsync = promisify(exec);

export class LocalStackHelper {
  private s3Client: S3Client | null = null;

  public async start(): Promise<void> {
    const sessionId = TestSession.getInstance().getSessionId();
    console.log(`🔧 Test Session ID: ${sessionId}`);
    console.log("🐳 Starting LocalStack container...");
    await execAsync("docker compose -f compose.test.yml up -d");

    await this.waitForHealthy();

    this.s3Client = new S3Client({
      endpoint: TEST_CONSTANTS.LOCALSTACK.ENDPOINT,
      region: TEST_CONSTANTS.LOCALSTACK.REGION,
      credentials: {
        accessKeyId: TEST_CONSTANTS.LOCALSTACK.ACCESS_KEY_ID,
        secretAccessKey: TEST_CONSTANTS.LOCALSTACK.SECRET_ACCESS_KEY,
      },
      forcePathStyle: true,
    });

    await this.createBucket(TEST_CONSTANTS.BUCKET_NAME);
    console.log(`📦 Created test bucket: ${TEST_CONSTANTS.BUCKET_NAME}`);
  }

  public async stop(): Promise<void> {
    console.log("🛑 Stopping LocalStack container...");
    await execAsync("docker compose -f compose.test.yml down -v");
  }

  public async cleanupSession(): Promise<void> {
    if (!this.s3Client) return;

    const sessionId = TestSession.getInstance().getSessionId();
    console.log(`🧹 Cleaning up session: ${sessionId}`);

    try {
      const listResponse = await this.s3Client.send(
        new ListObjectsV2Command({
          Bucket: TEST_CONSTANTS.BUCKET_NAME,
          Prefix: `projects/${sessionId}-`,
        }),
      );

      const objectsToDelete = (listResponse.Contents || [])
        .map((obj) => obj.Key)
        .filter((key): key is string => Boolean(key));
      if (objectsToDelete.length > 0) {
        const deleteCount = objectsToDelete.length;
        await this.s3Client.send(
          new DeleteObjectsCommand({
            Bucket: TEST_CONSTANTS.BUCKET_NAME,
            Delete: {
              Objects: objectsToDelete.map((key) => ({ Key: key })),
            },
          }),
        );
        console.log(`   Deleted ${deleteCount} objects from session`);
      } else {
        console.log("   No objects to clean up");
      }
    } catch (error) {
      console.error("   Error during cleanup:", error);
    }
  }

  private async createBucket(bucketName: string): Promise<void> {
    if (!this.s3Client) {
      throw new Error("S3 client not initialized");
    }

    try {
      await this.s3Client.send(
        new CreateBucketCommand({
          Bucket: bucketName,
        }),
      );
    } catch (error) {
      const errorName = (error as { name?: string }).name;
      if (
        errorName !== "BucketAlreadyExists" &&
        errorName !== "BucketAlreadyOwnedByYou"
      ) {
        throw error;
      }
    }
  }

  private async waitForHealthy(maxRetries = 60): Promise<void> {
    console.log("⏳ Waiting for LocalStack to be healthy...");
    const healthUrl = `${TEST_CONSTANTS.LOCALSTACK.ENDPOINT}/_localstack/health`;
    const s3Client = new S3Client({
      endpoint: TEST_CONSTANTS.LOCALSTACK.ENDPOINT,
      region: TEST_CONSTANTS.LOCALSTACK.REGION,
      credentials: {
        accessKeyId: TEST_CONSTANTS.LOCALSTACK.ACCESS_KEY_ID,
        secretAccessKey: TEST_CONSTANTS.LOCALSTACK.SECRET_ACCESS_KEY,
      },
      forcePathStyle: true,
    });

    let lastError: unknown;
    for (let i = 0; i < maxRetries; i += 1) {
      try {
        const response = await fetch(healthUrl);
        if (response.ok) {
          const health = (await response.json()) as {
            services?: { s3?: string };
          };
          if (health.services?.s3 === "running") {
            console.log("✅ LocalStack health endpoint is ready");
            return;
          }
        }
      } catch (error) {
        lastError = error;
      }

      try {
        await s3Client.send(
          new ListObjectsV2Command({
            Bucket: TEST_CONSTANTS.BUCKET_NAME,
            MaxKeys: 1,
          }),
        );
        console.log("✅ LocalStack S3 endpoint is ready");
        return;
      } catch (error) {
        lastError = error;
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    throw new Error(
      `LocalStack failed to become healthy within timeout: ${String(lastError)}`,
    );
  }
}
