import { Stream } from "stream";
import {
  GetObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { AssumeRoleCommand, STSClient } from "@aws-sdk/client-sts";
import { NodeJsClient } from "@smithy/types";
import { styleText } from "node:util";
import { LOG_COLORS } from "@/cli-ui/utils";
import {
  EthokoContractOutputArtifact,
  EthokoInputArtifact,
  TagManifest,
  TagManifestSchema,
} from "../utils/ethoko-artifacts-schemas/v0";
import { StorageProvider } from "./storage-provider.interface";
import fs from "fs/promises";

type S3BucketProviderConfig = {
  bucketName: string;
  bucketRegion: string;
  credentials?:
    | {
        type: "static";
        accessKeyId: string;
        secretAccessKey: string;
        role?: {
          roleArn: string;
          externalId?: string;
          sessionName?: string;
          durationSeconds?: number;
        };
      }
    | {
        type: "profile";
        profile: string; // AWS CLI profile name to load credentials from
      };
  endpoint?: string;
  forcePathStyle?: boolean;
  debug?: boolean;
  rootPath?: string;
};

type RoleCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
};

export class S3BucketProvider implements StorageProvider {
  /**
   * S3 storage layout (prefix under rootPath)
   * - {project}/ids/{id}/input.json
   * - {project}/ids/{id}/original/** (original compilation content)
   * - {project}/tags/{tag}.json (manifest: { id })
   */
  private readonly config: S3BucketProviderConfig;
  private client: NodeJsClient<S3Client> | undefined;
  private readonly rootPath: string;

  constructor(config: S3BucketProviderConfig) {
    this.config = config;
    this.rootPath = config.rootPath || "projects";
  }

  private async getClient(): Promise<NodeJsClient<S3Client>> {
    if (this.client) {
      return this.client;
    }

    const credentialsConfig = this.config.credentials;
    if (!credentialsConfig) {
      if (this.config.debug) {
        console.error(
          styleText(
            LOG_COLORS.log,
            "No AWS credentials provided in config, using default credential provider chain",
          ),
        );
      }
      this.client = new S3Client({
        region: this.config.bucketRegion,
        endpoint: this.config.endpoint,
        forcePathStyle: this.config.forcePathStyle,
      });
      return this.client;
    }

    if (credentialsConfig.type === "profile") {
      if (this.config.debug) {
        console.error(
          styleText(
            LOG_COLORS.log,
            `AWS credentials profile "${credentialsConfig.profile}" provided in config, loading credentials from profile`,
          ),
        );
      }
      this.client = new S3Client({
        region: this.config.bucketRegion,
        endpoint: this.config.endpoint,
        forcePathStyle: this.config.forcePathStyle,
        profile: credentialsConfig.profile,
      });
      return this.client;
    }

    if (!credentialsConfig.role) {
      if (this.config.debug) {
        console.error(
          styleText(
            LOG_COLORS.log,
            "No role configuration provided, using static credentials from config",
          ),
        );
      }
      this.client = new S3Client({
        region: this.config.bucketRegion,
        endpoint: this.config.endpoint,
        forcePathStyle: this.config.forcePathStyle,
        credentials: {
          accessKeyId: credentialsConfig.accessKeyId,
          secretAccessKey: credentialsConfig.secretAccessKey,
        },
      });
      return this.client;
    }

    if (this.config.debug) {
      console.error(
        styleText(
          LOG_COLORS.log,
          `Role configuration provided, will attempt to assume role ${credentialsConfig.role.roleArn} before accessing S3`,
        ),
      );
    }
    const roleCredentials = await this.getRoleCredentials();
    this.client = new S3Client({
      region: this.config.bucketRegion,
      endpoint: this.config.endpoint,
      forcePathStyle: this.config.forcePathStyle,
      credentials: {
        accessKeyId: roleCredentials.accessKeyId,
        secretAccessKey: roleCredentials.secretAccessKey,
        sessionToken: roleCredentials.sessionToken,
      },
    });
    return this.client;
  }

  private async getRoleCredentials(): Promise<RoleCredentials> {
    const credentialsConfig = this.config.credentials;
    if (!credentialsConfig || credentialsConfig.type !== "static") {
      throw new Error("Role credentials configuration is missing or invalid");
    }
    const role = credentialsConfig.role;
    if (!role) {
      throw new Error("Role configuration is missing");
    }

    const stsClient = new STSClient({
      region: this.config.bucketRegion,
      endpoint: this.config.endpoint,
      credentials: {
        accessKeyId: credentialsConfig.accessKeyId,
        secretAccessKey: credentialsConfig.secretAccessKey,
      },
    });

    const sessionName = role.sessionName || "ethoko-hardhat-session";

    const assumeRoleCommand = new AssumeRoleCommand({
      RoleArn: role.roleArn,
      RoleSessionName: sessionName,
      ExternalId: role.externalId,
      DurationSeconds: role.durationSeconds,
    });

    let response;
    try {
      response = await stsClient.send(assumeRoleCommand);
    } catch (error) {
      throw new Error(
        `Failed to assume role "${role.roleArn}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const credentials = response.Credentials;
    if (
      !credentials ||
      !credentials.AccessKeyId ||
      !credentials.SecretAccessKey ||
      !credentials.SessionToken
    ) {
      throw new Error(
        `Failed to assume role "${role.roleArn}": missing credentials`,
      );
    }

    if (this.config.debug) {
      console.error(
        styleText(
          LOG_COLORS.log,
          `Assumed role ${role.roleArn} with session ${sessionName} (access key ${credentials.AccessKeyId}, expires ${credentials.Expiration})`,
        ),
      );
    }

    return {
      accessKeyId: credentials.AccessKeyId,
      secretAccessKey: credentials.SecretAccessKey,
      sessionToken: credentials.SessionToken,
    };
  }

  public async listIds(project: string): Promise<string[]> {
    const client = await this.getClient();
    const prefix = `${this.rootPath}/${project}/ids/`;
    const listCommand = new ListObjectsV2Command({
      Bucket: this.config.bucketName,
      Prefix: prefix,
      Delimiter: "/",
    });
    const listResult = await client.send(listCommand);
    const commonPrefixes = listResult.CommonPrefixes || [];
    return commonPrefixes
      .map((entry) => entry.Prefix)
      .filter((entry): entry is string => entry !== undefined)
      .map((entry) => entry.replace(prefix, "").replace("/", ""));
  }

  public async listOriginalContent(
    project: string,
    id: string,
  ): Promise<string[]> {
    const client = await this.getClient();
    const prefix = `${this.rootPath}/${project}/ids/${id}/original/`;
    const paths: string[] = [];
    let continuationToken: string | undefined;

    do {
      const listCommand = new ListObjectsV2Command({
        Bucket: this.config.bucketName,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      });
      const listResult = await client.send(listCommand);
      const contents = listResult.Contents;
      if (contents) {
        for (const content of contents) {
          const key = content.Key;
          if (!key) continue;
          const relativeKey = key.replace(prefix, "");
          if (relativeKey.length > 0) {
            paths.push(relativeKey);
          }
        }
      }
      continuationToken = listResult.IsTruncated
        ? listResult.NextContinuationToken
        : undefined;
    } while (continuationToken);

    return paths;
  }

  public async listTags(project: string): Promise<string[]> {
    const client = await this.getClient();
    const listCommand = new ListObjectsV2Command({
      Bucket: this.config.bucketName,
      Prefix: `${this.rootPath}/${project}/tags/`,
    });
    const listResult = await client.send(listCommand);
    const contents = listResult.Contents;
    if (!contents) {
      return [];
    }
    const tags = [];
    for (const content of contents) {
      const key = content.Key;
      if (!key) continue;
      const tag = key
        .replace(`${this.rootPath}/${project}/tags/`, "")
        .replace(".json", "");
      tags.push(tag);
    }
    return tags;
  }

  public async hasArtifactByTag(
    project: string,
    tag: string,
  ): Promise<boolean> {
    const client = await this.getClient();
    const headCommand = new GetObjectCommand({
      Bucket: this.config.bucketName,
      Key: `${this.rootPath}/${project}/tags/${tag}.json`,
    });
    const headResult = await client.send(headCommand).catch((err) => {
      if (err instanceof NoSuchKey) {
        return null;
      }
      throw err;
    });
    return Boolean(headResult);
  }

  public async hasArtifactById(project: string, id: string): Promise<boolean> {
    const client = await this.getClient();
    const listCommand = new ListObjectsV2Command({
      Bucket: this.config.bucketName,
      Prefix: `${this.rootPath}/${project}/ids/${id}/`,
      MaxKeys: 1,
    });
    const listResult = await client.send(listCommand);
    return (listResult.Contents?.length ?? 0) > 0;
  }

  public async uploadArtifact(
    project: string,
    inputArtifact: EthokoInputArtifact,
    contractOutputArtifacts: EthokoContractOutputArtifact[],
    tag: string | undefined,
    originalContentPaths: string[],
  ): Promise<void> {
    const client = await this.getClient();
    const inputKey = `${this.rootPath}/${project}/ids/${inputArtifact.id}/input.json`;
    const contractUploads = contractOutputArtifacts.map((contractArtifact) => {
      const contractKey = `${this.rootPath}/${project}/ids/${inputArtifact.id}/outputs/${contractArtifact.sourceName}/${contractArtifact.contract}.json`;
      return client.send(
        new PutObjectCommand({
          Bucket: this.config.bucketName,
          Key: contractKey,
          Body: JSON.stringify(contractArtifact),
        }),
      );
    });
    await Promise.all([
      ...contractUploads,
      client.send(
        new PutObjectCommand({
          Bucket: this.config.bucketName,
          Key: inputKey,
          Body: JSON.stringify(inputArtifact),
        }),
      ),
    ]);

    if (tag) {
      const manifest: TagManifest = { id: inputArtifact.id };
      const putTagCommand = new PutObjectCommand({
        Bucket: this.config.bucketName,
        Key: `${this.rootPath}/${project}/tags/${tag}.json`,
        Body: JSON.stringify(manifest),
      });
      await client.send(putTagCommand);
    }

    // Upload original content files as well, using the artifact ID as reference
    // These files are stored under `${this.rootPath}/${project}/ids/${inputArtifact.id}/original/` prefix, so they don't interfere with the main artifact JSON file and can be easily retrieved when downloading the artifact
    for (const originalContentPath of originalContentPaths) {
      const content = await fs.readFile(originalContentPath);
      let sanitizedPath = originalContentPath;
      // We remove any leading `/` or `./` from the path to avoid creating unnecessary folders in the storage and to ensure the key is valid
      if (sanitizedPath.startsWith("/")) {
        sanitizedPath = sanitizedPath.substring(1);
      }
      if (sanitizedPath.startsWith("./")) {
        sanitizedPath = sanitizedPath.substring(2);
      }
      const putCommand = new PutObjectCommand({
        Bucket: this.config.bucketName,
        Key: `${this.rootPath}/${project}/ids/${inputArtifact.id}/original/${sanitizedPath}`,
        Body: content,
      });
      await client.send(putCommand);
    }
  }

  public async downloadArtifactById(
    project: string,
    id: string,
  ): Promise<{
    input: Stream;
    contractOutputArtifacts: {
      sourceName: string;
      contractName: string;
      stream: Stream;
    }[];
  }> {
    const client = await this.getClient();
    const inputCommand = new GetObjectCommand({
      Bucket: this.config.bucketName,
      Key: `${this.rootPath}/${project}/ids/${id}/input.json`,
    });
    const inputResult = await client.send(inputCommand);
    if (!inputResult.Body) {
      throw new Error(
        `Artifact corrupted on remote storage for ID ${id}, requires attention`,
      );
    }
    const contractArtifacts = await this.listContractOutputArtifacts(
      project,
      id,
    );
    const contractOutputArtifacts = await Promise.all(
      contractArtifacts.map(({ sourceName, contractName }) =>
        this.downloadContractOutputArtifact(
          project,
          id,
          sourceName,
          contractName,
        ).then((stream) => ({
          sourceName,
          contractName,
          stream,
        })),
      ),
    );
    return {
      input: inputResult.Body as Stream,
      contractOutputArtifacts,
    };
  }

  public async downloadArtifactByTag(
    project: string,
    tag: string,
  ): Promise<{
    id: string;
    input: Stream;
    contractOutputArtifacts: {
      sourceName: string;
      contractName: string;
      stream: Stream;
    }[];
  }> {
    const client = await this.getClient();
    const getObjectCommand = new GetObjectCommand({
      Bucket: this.config.bucketName,
      Key: `${this.rootPath}/${project}/tags/${tag}.json`,
    });
    const getObjectResult = await client.send(getObjectCommand);
    if (!getObjectResult.Body) {
      throw new Error(
        `Tag manifest corrupted on remote storage for tag ${tag}, requires attention`,
      );
    }
    const manifestContent = await getObjectResult.Body.transformToString();
    const manifest = TagManifestSchema.parse(JSON.parse(manifestContent));
    const streams = await this.downloadArtifactById(project, manifest.id);
    return {
      id: manifest.id,
      ...streams,
    };
  }

  public async downloadOriginalContent(
    project: string,
    id: string,
    relativePath: string,
  ): Promise<Stream> {
    const client = await this.getClient();
    const getObjectCommand = new GetObjectCommand({
      Bucket: this.config.bucketName,
      Key: `${this.rootPath}/${project}/ids/${id}/original/${relativePath}`,
    });
    const getObjectResult = await client.send(getObjectCommand);
    if (!getObjectResult.Body) {
      throw new Error("Error fetching the original content");
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return getObjectResult.Body.transformToWebStream() as any;
  }

  private async downloadContractOutputArtifact(
    project: string,
    id: string,
    sourceName: string,
    contractName: string,
  ): Promise<Stream> {
    const client = await this.getClient();
    const getObjectCommand = new GetObjectCommand({
      Bucket: this.config.bucketName,
      Key: `${this.rootPath}/${project}/ids/${id}/outputs/${sourceName}/${contractName}.json`,
    });
    const getObjectResult = await client.send(getObjectCommand);
    if (!getObjectResult.Body) {
      throw new Error(
        `Contract artifact not found for ${sourceName}:${contractName}`,
      );
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return getObjectResult.Body.transformToWebStream() as any;
  }

  private async listContractOutputArtifacts(
    project: string,
    id: string,
  ): Promise<
    {
      sourceName: string;
      contractName: string;
    }[]
  > {
    const client = await this.getClient();
    const prefix = `${this.rootPath}/${project}/ids/${id}/outputs/`;
    const paths: {
      sourceName: string;
      contractName: string;
    }[] = [];
    let continuationToken: string | undefined;

    do {
      const listCommand = new ListObjectsV2Command({
        Bucket: this.config.bucketName,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      });
      const listResult = await client.send(listCommand);
      const contents = listResult.Contents;
      if (contents) {
        for (const content of contents) {
          const key = content.Key;
          if (!key) continue;
          const relativeKey = key.replace(prefix, "");
          const items = relativeKey.split("/");
          const contractNameWithExtension = items.pop();
          if (!contractNameWithExtension) continue;
          const contractName = contractNameWithExtension.replace(".json", "");
          if (items.length === 0) continue;
          const sourceName = items.join("/");
          paths.push({ sourceName, contractName });
        }
      }
      continuationToken = listResult.IsTruncated
        ? listResult.NextContinuationToken
        : undefined;
    } while (continuationToken);

    return paths;
  }
}
