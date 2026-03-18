import { describe, expect, test } from "vitest";
import { ArtifactKeySchema } from "./parse-artifact-key";

describe("ArtifactKeySchema", () => {
  test("should parse valid artifact key with tag", () => {
    expect(ArtifactKeySchema.safeParse("my-project:latest")).toEqual({
      success: true,
      data: {
        project: "my-project",
        artifact: { type: "tag", tag: "latest" },
      },
    });
  });
  test("should parse valid artifact key with id", () => {
    expect(ArtifactKeySchema.safeParse("my-project@12345")).toEqual({
      success: true,
      data: {
        project: "my-project",
        artifact: { type: "id", id: "12345" },
      },
    });
  });

  test("should parse valid artifact key with project only", () => {
    expect(ArtifactKeySchema.safeParse("my-project")).toEqual({
      success: true,
      data: {
        project: "my-project",
        artifact: null,
      },
    });
  });

  const INVALID_KEYS = [
    "", // Empty string
    null, // Null value
    ":", // Missing project and tag/id
    "@", // Missing project and id
    "my-project:", // Missing tag
    "my-project@", // Missing id
    "my:project:latest", // Too many colons
    "my@project@12345", // Too many at symbols
    "my-project:latest@12345", // Both delimiters
    "my-project:my-tag/invalid", // Invalid characters in tag
    "my-project:my-tag\\invalid", // Invalid characters in tag
    "my-project:my-tag invalid", // Invalid characters in tag
  ];

  INVALID_KEYS.forEach((key) => {
    test(`should fail to parse invalid artifact key: ${key}`, () => {
      expect(ArtifactKeySchema.safeParse(key).success).toBe(false);
    });
  });
});
