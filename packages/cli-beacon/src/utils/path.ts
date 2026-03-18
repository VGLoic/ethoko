import path from "path";
import z from "zod";

/**
 * A utility class for handling absolute paths.
 */
export class AbsolutePath {
  public resolvedPath: string;
  private constructor(resolvedPath: string) {
    this.resolvedPath = resolvedPath;
  }

  /**
   * Returns the directory name of the path.
   * @example
   * ```typescript
   * const absPath = AbsolutePath.from("/foo/bar/baz");
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
   * const absPath = AbsolutePath.from("/foo");
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
   * const absPath = AbsolutePath.from("/foo/bar/baz");
   * const basePath = AbsolutePath.from("/foo");
   * const relativePath = absPath.relativeTo(basePath);
   * console.log(relativePath.relativePath); // Output: "bar/baz"
   * ```
   */
  public relativeTo(base: AbsolutePath): RelativePath {
    const relativePath = path.relative(base.resolvedPath, this.resolvedPath);
    return RelativePath.unsafeFrom(relativePath);
  }

  /**
   * Creates an AbsolutePath instance from the given paths. The paths will be resolved to an absolute path.
   * @example
   * ```typescript
   * const absPath1 = AbsolutePath.from("/foo/bar");
   * console.log(absPath1.resolvedPath); // Output: "/foo/bar"
   * const absPath2 = AbsolutePath.from("foo/bar");
   * console.log(absPath2.resolvedPath); // Output: "/current/working/directory/foo/bar"
   * ```
   */
  public static from(...from: string[]): AbsolutePath {
    const resolvedPath = path.resolve(...from);
    return new AbsolutePath(resolvedPath);
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
