import { AbsolutePath, generateAbsolutePathSchema } from "@/utils/path";
import { z } from "zod";

const AwsStorageSchema = z
  .object({
    type: z.literal("aws"),
    awsRegion: z
      .string('The "awsRegion" field must be a string when "type" is "aws"')
      .min(
        1,
        'The "awsRegion" field is required when "type" is "aws". Provide a valid AWS region like "eu-west-3".',
      ),
    awsProfile: z
      .string('The "awsProfile" field must be a string when "type" is "aws"')
      .min(
        1,
        'If provided, the "awsProfile" field must not be an empty string when "type" is "aws". Provide the name of the AWS CLI profile to use for credentials.',
      )
      .optional(),
    awsBucketName: z
      .string('The "awsBucketName" field must be a string when "type" is "aws"')
      .min(
        1,
        'The "awsBucketName" field is required when "type" is "aws". Provide the name of the S3 bucket to use for storage.',
      ),
    awsAccessKeyId: z
      .string(
        'The "awsAccessKeyId" field must be a string when "type" is "aws"',
      )
      .min(
        1,
        'If provided, the "awsAccessKeyId" field must not be an empty string when "type" is "aws". Provide a valid AWS access key ID.',
      )
      .optional(),
    awsSecretAccessKey: z
      .string(
        'The "awsSecretAccessKey" field must be a string when "type" is "aws"',
      )
      .min(
        1,
        'If provided, the "awsSecretAccessKey" field must not be an empty string when "type" is "aws". Provide a valid AWS secret access key.',
      )
      .optional(),
    awsRoleArn: z
      .string('The "awsRoleArn" field must be a string when "type" is "aws"')
      .min(
        1,
        'If provided, the "awsRoleArn" field must not be an empty string when "type" is "aws"',
      )
      .optional(),
    awsRoleExternalId: z
      .string(
        'The "awsRoleExternalId" field must be a string when "type" is "aws"',
      )
      .min(
        1,
        'If provided, the "awsRoleExternalId" field must not be an empty string when "type" is "aws"',
      )
      .optional(),
    awsRoleSessionName: z
      .string(
        'The "awsRoleSessionName" field must be a string when "type" is "aws"',
      )
      .min(
        1,
        'If provided, the "awsRoleSessionName" field must not be an empty string when "type" is "aws"',
      )
      .optional(),
    awsRoleDurationSeconds: z
      .number(
        'The "awsRoleDurationSeconds" field must be a number when "type" is "aws"',
      )
      .int(
        'If provided, the "awsRoleDurationSeconds" field must be an integer when "type" is "aws"',
      )
      .min(
        900,
        'If provided, the "awsRoleDurationSeconds" field must be at least 900 seconds when "type" is "aws"',
      )
      .max(
        43200,
        'If provided, the "awsRoleDurationSeconds" field must be at most 43200 seconds when "type" is "aws"',
      )
      .optional(),
  })
  .transform((data, ctx) => {
    // If AWS profile is provided, use profile based credentials
    if (data.awsProfile) {
      // When using profile based credentials, role configuration fields must be empty
      if (
        data.awsAccessKeyId ||
        data.awsSecretAccessKey ||
        data.awsRoleArn ||
        data.awsRoleExternalId ||
        data.awsRoleSessionName ||
        data.awsRoleDurationSeconds
      ) {
        ctx.addIssue({
          code: "custom",
          message:
            'When "awsProfile" is provided, credential fields ("awsAccessKeyId", "awsSecretAccessKey") and role configuration fields ("awsRoleArn", "awsRoleExternalId", "awsRoleSessionName", "awsRoleDurationSeconds") must be empty',
          input: data,
        });
        return z.NEVER;
      }
      return {
        type: "aws" as const,
        region: data.awsRegion,
        bucketName: data.awsBucketName,
        credentials: {
          type: "profile" as const,
          profile: data.awsProfile,
        },
      };
    }

    // For static configuration, access key and secret must be provided together
    const accessKey = data.awsAccessKeyId;
    const secretKey = data.awsSecretAccessKey;
    if (accessKey && secretKey) {
      let roleConfig:
        | {
            roleArn: string;
            externalId?: string;
            sessionName?: string;
            durationSeconds?: number;
          }
        | undefined = undefined;

      if (data.awsRoleArn) {
        roleConfig = {
          roleArn: data.awsRoleArn,
          externalId: data.awsRoleExternalId,
          sessionName: data.awsRoleSessionName,
          durationSeconds: data.awsRoleDurationSeconds,
        };
      } else {
        // If no role ARN provided, all the role related fields must be empty
        if (
          data.awsRoleExternalId ||
          data.awsRoleSessionName ||
          data.awsRoleDurationSeconds
        ) {
          ctx.addIssue({
            code: "custom",
            message:
              'When "awsRoleArn" is not provided, role configuration fields ("awsRoleExternalId", "awsRoleSessionName", "awsRoleDurationSeconds") must be empty',
            input: data,
          });
          return z.NEVER;
        }
      }

      return {
        type: "aws" as const,
        region: data.awsRegion,
        bucketName: data.awsBucketName,
        credentials: {
          type: "static" as const,
          accessKeyId: accessKey,
          secretAccessKey: secretKey,
          role: roleConfig,
        },
      };
    }
    if (accessKey || secretKey) {
      ctx.addIssue({
        code: "custom",
        message:
          'Both "awsAccessKeyId" and "awsSecretAccessKey" must be provided together when "type" is "aws"',
        input: data,
      });
      return z.NEVER;
    }

    // Else, no credentials are provided, all the role related fields must be empty
    if (
      data.awsRoleArn ||
      data.awsRoleExternalId ||
      data.awsRoleSessionName ||
      data.awsRoleDurationSeconds
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          'When no AWS credentials are provided, role configuration fields ("awsRoleArn", "awsRoleExternalId", "awsRoleSessionName", "awsRoleDurationSeconds") must be empty',
        input: data,
      });
      return z.NEVER;
    }

    return {
      type: "aws" as const,
      region: data.awsRegion,
      bucketName: data.awsBucketName,
    };
  });

function generateFilesystemStorageSchema(basePathResolver: () => AbsolutePath) {
  return z.object({
    type: z.literal("filesystem"),
    path: z
      .string('The "path" field must be a string when "type" is "filesystem"')
      .min(
        1,
        'The "path" field can not be an empty string when "type" is "filesystem". Provide a valid path or set it to "." to use the current directory or leave it empty to default to "./.ethoko-storage"',
      )
      .default("./.ethoko-storage")
      .pipe(generateAbsolutePathSchema(basePathResolver)),
  });
}

export function generateProjectConfigSchema(
  basePathResolver: () => AbsolutePath,
) {
  return z.object({
    name: z
      .string('"name" field must be a string')
      .min(1, '"name" field must be a non-empty string'),
    storage: z.discriminatedUnion(
      "type",
      [AwsStorageSchema, generateFilesystemStorageSchema(basePathResolver)],
      '"storage" field must be a valid storage configuration object. Start with specifying the "type" field as either "aws" or "filesystem" and provide the corresponding configuration fields.',
    ),
  });
}

export type ProjectConfig = z.infer<
  ReturnType<typeof generateProjectConfigSchema>
>;
