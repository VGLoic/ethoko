import z from "zod";

/**
 * The Ethoko Hardhat user configuration
 */
export type EthokoHardhatUserConfig = {
  /**
   * The project name
   */
  project: string;
  /**
   * The local path in which artifacts will be pulled
   *
   * Default to `.ethoko`
   */
  pulledArtifactsPath?: string;
  /**
   * The local path in which typings will be generated
   *
   * Default to `.ethoko-typings`
   */
  typingsPath?: string;
  /**
   * The path to compilation output artifacts
   *
   * E.g. "./artifacts" for Hardhat, "./out" for Foundry
   *
   * When set, makes the --artifact-path flag optional for push and diff commands
   */
  compilationOutputPath?: string;
  /**
   * Configuration of the storage where the artifacts will be stored
   */
  storageConfiguration:
    | {
        type: "aws";
        awsRegion: string;
        awsBucketName: string;
        credentials?:
          | {
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
              profile: string;
            };
      }
    | {
        type: "local";
        path: string;
      };
  /**
   * Enable debug mode for all tasks
   *
   * Default to `false`
   */
  debug?: boolean;
};

const StaticAwsCredentialsSchema = z
  .object({
    accessKeyId: z.string().min(1),
    secretAccessKey: z.string().min(1),
    role: z
      .object({
        roleArn: z.string().min(1),
        externalId: z.string().min(1).optional(),
        sessionName: z.string().min(1).default("ethoko-hardhat-session"),
        durationSeconds: z.number().int().min(900).max(43200).default(3600),
      })
      .optional(),
  })
  .transform((creds) => {
    return {
      type: "static" as const,
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
      role: creds.role,
    };
  });

const ProfileAwsCredentialsSchema = z
  .object({
    profile: z.string().min(1),
  })
  .transform((creds) => {
    return {
      type: "profile" as const,
      profile: creds.profile,
    };
  });

export const EthokoHardhatConfigSchema = z.object({
  project: z.string().min(1),
  pulledArtifactsPath: z.string().default(".ethoko"),
  typingsPath: z.string().default(".ethoko-typings"),
  compilationOutputPath: z.string().optional(),
  storageConfiguration: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("aws"),
      awsRegion: z.string().min(1),
      awsBucketName: z.string().min(1),
      credentials: z
        .union([StaticAwsCredentialsSchema, ProfileAwsCredentialsSchema])
        .optional(),
    }),
    z.object({
      type: z.literal("local"),
      path: z.string().min(1),
    }),
  ]),
  debug: z.boolean().default(false),
});
