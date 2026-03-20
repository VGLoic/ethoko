import path from "path";
import z from "zod";

/**
 * A utility class for handling absolute paths.
 */
export class AbsolutePath {
  public resolvedPath: string;
  /**
   * Creates an AbsolutePath instance from the given paths. The paths will be resolved to an absolute path.
   * @example
   * ```typescript
   * const absPath1 = new AbsolutePath("/foo/bar");
   * console.log(absPath1.resolvedPath); // Output: "/foo/bar"
   * const absPath2 = new AbsolutePath("foo/bar");
   * console.log(absPath2.resolvedPath); // Output: "/current/working/directory/foo/bar"
   * ```
   */
  public constructor(...from: string[]) {
    const resolvedPath = path.resolve(...from);
    this.resolvedPath = resolvedPath;
  }

  /**
   * Returns the directory name of the path.
   * @example
   * ```typescript
   * const absPath = new AbsolutePath("/foo/bar/baz");
   * const dirName = absPath.dirname();
   * console.log(dirName.resolvedPath); // Output: "/foo/bar"
   * ```
   */
  public dirname(): AbsolutePath {
    return new AbsolutePath(path.dirname(this.resolvedPath));
  }

  /**
   * Joins the path with the given paths.
   * @example
   * ```typescript
   * const absPath = new AbsolutePath("/foo");
   * const joinedPath = absPath.join("bar", "baz");
   * console.log(joinedPath.resolvedPath); // Output: "/foo/bar/baz"
   * ```
   */
  public join(...tos: (string | RelativePath)[]): AbsolutePath {
    const toPath = tos.map((to) =>
      to instanceof RelativePath ? to.relativePath : to,
    );
    const joinedPath = path.join(this.resolvedPath, ...toPath);
    return new AbsolutePath(joinedPath);
  }

  /**
   * Returns the relative path from the base path to the current path.
   * @example
   * ```typescript
   * const absPath = new AbsolutePath("/foo/bar/baz");
   * const basePath = new AbsolutePath("/foo");
   * const relativePath = absPath.relativeTo(basePath);
   * console.log(relativePath.relativePath); // Output: "bar/baz"
   * ```
   */
  public relativeTo(base: AbsolutePath): RelativePath {
    const relativePath = path.relative(base.resolvedPath, this.resolvedPath);
    return RelativePath.unsafeFrom(relativePath);
  }

  /**
   * Returns true if the current path is a child path of the given parent path.
   * A child path means that
   *  - the current path is located within the directory tree of the parent path,
   *  - but is not the same as the parent path itself.
   */
  public isChildOf(parent: AbsolutePath): boolean {
    return (
      parent.resolvedPath !== this.resolvedPath &&
      this.resolvedPath.startsWith(parent.resolvedPath + path.sep)
    );
  }

  /**
   * Returns true if the current path is the same as the other path.
   */
  public eq(other: AbsolutePath): boolean {
    return this.resolvedPath === other.resolvedPath;
  }

  /**
   * Method meant for debugging purposes. It returns the resolved absolute path as a string.
   * @deprecated Use `AbsolutePath.resolvedPath` instead.
   */
  public toString(): string {
    return this.resolvedPath;
  }
}

/**
 * A utility class for handling relative paths.
 * The only way to create an instance is through the `unsafeFrom` static method, which ensures that the created path is indeed a relative path.
 */
export class RelativePath {
  public relativePath: string;

  private constructor(relativePath: string) {
    this.relativePath = relativePath;
  }

  /**
   * Creates a RelativePath instance from the given paths. The paths will be joined and validated to ensure that the resulting path is not absolute.
   * @example
   * ```typescript
   * const relativePath = RelativePath.unsafeFrom("foo", "bar");
   * console.log(relativePath.relativePath); // Output: "foo/bar"
   * ```
   * @throws Will throw an error if the joined path is absolute.
   */
  public static unsafeFrom(...from: string[]): RelativePath {
    // Protect against traversal vulnerabilities by ensuring no segment of the path is ".."
    if (from.some((segment) => segment === ".." || segment.includes(".."))) {
      throw new Error(
        `RelativePath cannot contain '..' segments: ${from.join("/")}`,
      );
    }

    const joinedPath = path.join(...from);
    if (path.isAbsolute(joinedPath)) {
      throw new Error(`RelativePath cannot be an absolute path: ${joinedPath}`);
    }
    return new RelativePath(joinedPath);
  }

  /**
   * Method meant for debugging purposes. It returns the relative path as a string.
   * @deprecated Use `RelativePath.relativePath` instead.
   */
  public toString(): string {
    return this.relativePath;
  }
}

export function generateAbsolutePathSchema(
  basePathResolver: () => AbsolutePath,
) {
  return z
    .string()
    .min(1)
    .transform((pathStr) => {
      // If the path is relative, resolve it against the base path.
      // Else, return the path as is
      const relativePathResult = RelativePathSchema.safeParse(pathStr);
      if (!relativePathResult.success) {
        return new AbsolutePath(pathStr);
      }
      return basePathResolver().join(relativePathResult.data);
    });
}

export const AbsolutePathSchema = z
  .string()
  .min(1)
  .refine((pathStr) => path.isAbsolute(pathStr), "Invalid absolute path");

const RelativePathSchema = z.string().transform((str, ctx) => {
  try {
    return RelativePath.unsafeFrom(str);
  } catch (error) {
    ctx.addIssue({
      code: "custom",
      message: `Invalid relative path: ${error instanceof Error ? error.message : String(error)}`,
    });
    return z.NEVER;
  }
});
