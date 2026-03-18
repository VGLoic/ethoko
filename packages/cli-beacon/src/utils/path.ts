import path from "path";
import z from "zod";

export class AbsolutePath {
  public resolvedPath: string;
  private constructor(resolvedPath: string) {
    this.resolvedPath = resolvedPath;
  }

  public dirname(): AbsolutePath {
    return new AbsolutePath(path.dirname(this.resolvedPath));
  }

  public join(...tos: (string | RelativePath)[]): AbsolutePath {
    const toPath = tos.map((to) =>
      to instanceof RelativePath ? to.relativePath : to,
    );
    const joinedPath = path.join(this.resolvedPath, ...toPath);
    return new AbsolutePath(joinedPath);
  }

  public relativeTo(base: AbsolutePath): RelativePath {
    const relativePath = path.relative(base.resolvedPath, this.resolvedPath);
    return RelativePath.unsafeFrom(relativePath);
  }

  public static from(...from: string[]): AbsolutePath {
    const resolvedPath = path.resolve(...from);
    return new AbsolutePath(resolvedPath);
  }

  public toString(): string {
    return this.resolvedPath;
  }
}

export class RelativePath {
  public relativePath: string;

  private constructor(relativePath: string) {
    this.relativePath = relativePath;
  }

  public static unsafeFrom(...from: string[]): RelativePath {
    const joinedPath = path.join(...from);
    if (path.isAbsolute(joinedPath)) {
      throw new Error(`RelativePath cannot be an absolute path: ${joinedPath}`);
    }
    return new RelativePath(joinedPath);
  }

  public toString(): string {
    return this.relativePath;
  }
}

export const AbsolutePathSchema = z.string().transform((str, ctx) => {
  try {
    return AbsolutePath.from(str);
  } catch (error) {
    ctx.addIssue({
      code: "custom",
      message: `Invalid absolute path: ${error instanceof Error ? error.message : String(error)}`,
    });
    return z.NEVER;
  }
});
