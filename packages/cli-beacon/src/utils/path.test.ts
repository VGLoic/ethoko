import { describe, expect, test } from "vitest";
import path from "path";
import { AbsolutePath, RelativePath } from "./path";

describe("absolute path utils", () => {
  test("new AbsolutePath should resolve absolute paths from absolute paths", () => {
    const absPath = new AbsolutePath("/foo/bar");
    expect(absPath.resolvedPath).toBe("/foo/bar");
  });

  test("new AbsolutePath should resolve absolute paths from relative paths", () => {
    const absPath = new AbsolutePath("foo/bar");
    expect(absPath.resolvedPath).toBe(path.resolve("foo/bar"));
  });

  test("AbsolutePath.dirname should return the directory name of the path", () => {
    const absPath = new AbsolutePath("/foo/bar/baz");
    const dirName = absPath.dirname();
    expect(dirName.resolvedPath).toBe("/foo/bar");
  });

  test("AbsolutePath.join should join the path with the given paths", () => {
    const absPath = new AbsolutePath("/foo");
    const joinedPath = absPath.join("bar", "baz");
    expect(joinedPath.resolvedPath).toBe("/foo/bar/baz");
  });

  test("AbsolutePath.relativeTo should return the relative path from the base path", () => {
    const absPath = new AbsolutePath("/foo/bar/baz");
    const basePath = new AbsolutePath("/foo");
    const relativePath = absPath.relativeTo(basePath);
    expect(relativePath.relativePath).toBe("bar/baz");
  });

  test("Case #0 absolute path - AbsolutePath.isChildOf should return true if the current path is a child of the given parent path", () => {
    const parentPath = new AbsolutePath("/foo/bar");

    expect(new AbsolutePath("/foo/bar/baz").isChildOf(parentPath)).toBe(true);
    expect(new AbsolutePath("/foo/bar").isChildOf(parentPath)).toBe(false);
    expect(new AbsolutePath("/foo/bar/").isChildOf(parentPath)).toBe(false);
    expect(new AbsolutePath("/foo").isChildOf(parentPath)).toBe(false);
    expect(parentPath.isChildOf(new AbsolutePath("/foo"))).toBe(true);
    expect(parentPath.isChildOf(new AbsolutePath("/foo/"))).toBe(true);
    expect(parentPath.isChildOf(new AbsolutePath("/foo/bar"))).toBe(false);
    expect(parentPath.isChildOf(new AbsolutePath("/foo/bar/"))).toBe(false);
  });

  test("Case #1 absolute path with separator - AbsolutePath.isChildOf should return true if the current path is a child of the given parent path", () => {
    const parentPath = new AbsolutePath("/foo/bar/");

    expect(new AbsolutePath("/foo/bar/baz").isChildOf(parentPath)).toBe(true);
    expect(new AbsolutePath("/foo/bar").isChildOf(parentPath)).toBe(false);
    expect(new AbsolutePath("/foo/bar/").isChildOf(parentPath)).toBe(false);
    expect(new AbsolutePath("/foo").isChildOf(parentPath)).toBe(false);
    expect(parentPath.isChildOf(new AbsolutePath("/foo"))).toBe(true);
    expect(parentPath.isChildOf(new AbsolutePath("/foo/"))).toBe(true);
    expect(parentPath.isChildOf(new AbsolutePath("/foo/bar"))).toBe(false);
    expect(parentPath.isChildOf(new AbsolutePath("/foo/bar/"))).toBe(false);
  });

  test("Case #2 relative path - AbsolutePath.isChildOf should return true if the current path is a child of the given parent path", () => {
    const parentPath = new AbsolutePath("foo/bar");

    expect(new AbsolutePath("foo/bar/baz").isChildOf(parentPath)).toBe(true);
    expect(new AbsolutePath("foo/bar").isChildOf(parentPath)).toBe(false);
    expect(new AbsolutePath("foo/bar/").isChildOf(parentPath)).toBe(false);
    expect(new AbsolutePath("foo").isChildOf(parentPath)).toBe(false);
    expect(parentPath.isChildOf(new AbsolutePath("foo"))).toBe(true);
    expect(parentPath.isChildOf(new AbsolutePath("foo/"))).toBe(true);
    expect(parentPath.isChildOf(new AbsolutePath("foo/bar"))).toBe(false);
    expect(parentPath.isChildOf(new AbsolutePath("foo/bar/"))).toBe(false);
  });

  test("Case #3 relative path with separator - AbsolutePath.isChildOf should return true if the current path is a child of the given parent path", () => {
    const parentPath = new AbsolutePath("foo/bar/");

    expect(new AbsolutePath("foo/bar/baz").isChildOf(parentPath)).toBe(true);
    expect(new AbsolutePath("foo/bar").isChildOf(parentPath)).toBe(false);
    expect(new AbsolutePath("foo/bar/").isChildOf(parentPath)).toBe(false);
    expect(new AbsolutePath("foo").isChildOf(parentPath)).toBe(false);
    expect(parentPath.isChildOf(new AbsolutePath("foo"))).toBe(true);
    expect(parentPath.isChildOf(new AbsolutePath("foo/"))).toBe(true);
    expect(parentPath.isChildOf(new AbsolutePath("foo/bar"))).toBe(false);
    expect(parentPath.isChildOf(new AbsolutePath("foo/bar/"))).toBe(false);
  });
});
// typingsPath: '/Users/slourp/personal/ethoko/ethoko-monorepo/packages/cli-beacon/path/to/',
//   localArtifactStorePath: '/Users/slourp/personal/ethoko/ethoko-monorepo/packages/cli-beacon/path/to/typings',

describe("relative path utils", () => {
  const VALID_RELATIVE_PATHS = [
    ["foo"],
    ["foo", "bar"],
    ["foo", "bar", "baz"],
    ["./foo"],
    ["./foo", "bar"],
    ["./foo", "bar", "baz"],
  ];
  test.each(VALID_RELATIVE_PATHS)(
    "RelativePath.unsafeFrom should create a relative path from the given path %s",
    (...paths) => {
      const relativePath = RelativePath.unsafeFrom(...paths);
      expect(relativePath.relativePath).toBe(path.join(...paths));
    },
  );

  test("RelativePath.unsafeFrom should throw an error if the joined path is absolute", () => {
    expect(() => RelativePath.unsafeFrom("/foo")).toThrowError();
  });

  const INVALID_TRAVERSAL_PATHS = [
    ["foo", "..", "bar"],
    ["foo", "bar", ".."],
    ["..", "foo", "bar"],
    ["foo", ".."],
    ["..", "foo"],
    ["./../foo"],
    ["../foo"],
    ["foo/.."],
  ];
  test.each(INVALID_TRAVERSAL_PATHS)(
    "RelativePath.unsafeFrom should throw an error if the joined path contains '..' segments",
    (...paths) => {
      expect(() => RelativePath.unsafeFrom(...paths)).toThrowError();
    },
  );
});
