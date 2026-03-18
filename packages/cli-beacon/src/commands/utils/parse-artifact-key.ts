import z from "zod";

export const ArtifactKeySchema = z
  .string(
    "The artifact argument must be a string in the format PROJECT[:TAG|@ID]",
  )
  .min(
    1,
    "The artifact argument cannot be empty. Provide a valid artifact key in the format PROJECT[:TAG|@ID]",
  )
  .transform((str, ctx) => {
    const result = parseArtifactKey(str);
    if (!result.success) {
      ctx.addIssue({
        code: "custom",
        message: result.error,
      });
      return z.NEVER;
    }
    return result.key;
  });

function parseArtifactKey(key: string):
  | {
      success: true;
      key: {
        project: string;
        artifact:
          | { type: "id"; id: string }
          | { type: "tag"; tag: string }
          | null;
      };
    }
  | { success: false; error: string } {
  const hasTagDelimiter = key.includes(":");
  const hasIdDelimiter = key.includes("@");

  if (hasTagDelimiter && hasIdDelimiter) {
    return {
      success: false,
      error: `Invalid artifact key "${key}": cannot contain both ":" and "@" delimiters`,
    };
  }

  if (hasTagDelimiter) {
    const parts = key.split(":");
    if (parts.length !== 2) {
      return {
        success: false,
        error: `Invalid artifact key "${key}": expected format "PROJECT:TAG"`,
      };
    }
    const project = parts[0]?.trim();
    const tag = parts[1]?.trim();
    if (!project) {
      return {
        success: false,
        error: `Invalid artifact key "${key}": project name cannot be empty`,
      };
    }
    if (!tag) {
      return {
        success: false,
        error: `Invalid artifact key "${key}": tag cannot be empty`,
      };
    }
    const tagValidation = validateTag(tag);
    if (!tagValidation.success) {
      return {
        success: false,
        error: `Invalid artifact key "${key}": ${tagValidation.error}`,
      };
    }
    return {
      success: true,
      key: { project, artifact: { type: "tag", tag } },
    };
  }

  if (hasIdDelimiter) {
    const parts = key.split("@");
    if (parts.length !== 2) {
      return {
        success: false,
        error: `Invalid artifact key "${key}": expected format "PROJECT@ID"`,
      };
    }
    const project = parts[0]?.trim();
    const id = parts[1]?.trim();
    if (!project) {
      return {
        success: false,
        error: `Invalid artifact key "${key}": project name cannot be empty`,
      };
    }
    if (!id) {
      return {
        success: false,
        error: `Invalid artifact key "${key}": ID cannot be empty`,
      };
    }
    return {
      success: true,
      key: { project, artifact: { type: "id", id } },
    };
  }

  const project = key.trim();
  if (!project) {
    return {
      success: false,
      error: `Invalid artifact key "${key}": project name cannot be empty`,
    };
  }
  return {
    success: true,
    key: { project, artifact: null },
  };
}

function validateTag(
  value: string,
): { success: true } | { success: false; error: string } {
  if (!value.trim()) {
    return {
      success: false,
      error: "Tag cannot be empty",
    };
  }
  const FORBIDDEN_CHARACTERS = [":", "@", "/", "\\", " "];
  for (const char of FORBIDDEN_CHARACTERS) {
    if (value.includes(char)) {
      return {
        success: false,
        error: `Tag cannot contain '${char}' character`,
      };
    }
  }
  return { success: true };
}
