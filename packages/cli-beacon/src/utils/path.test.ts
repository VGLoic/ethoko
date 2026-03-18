import { describe, expect, test } from "vitest";
import path from "path";
import { AbsolutePath, RelativePath } from "./path";

describe("absolute path utils", () => {
  test("AbsolutePath.from should resolve absolute paths from absolute paths", () => {
    const absPath = AbsolutePath.from("/foo/bar");
    expect(absPath.resolvedPath).toBe("/foo/bar");
  });

  test("AbsolutePath.from should resolve absolute paths from relative paths", () => {
    const absPath = AbsolutePath.from("foo/bar");
    expect(absPath.resolvedPath).toBe(path.resolve("foo/bar"));
  });

  test("AbsolutePath.dirname should return the directory name of the path", () => {
    const absPath = AbsolutePath.from("/foo/bar/baz");
    const dirName = absPath.dirname();
    expect(dirName.resolvedPath).toBe("/foo/bar");
  });

  test("AbsolutePath.join should join the path with the given paths", () => {
    const absPath = AbsolutePath.from("/foo");
    const joinedPath = absPath.join("bar", "baz");
    expect(joinedPath.resolvedPath).toBe("/foo/bar/baz");
  });

  test("AbsolutePath.relativeTo should return the relative path from the base path", () => {
    const absPath = AbsolutePath.from("/foo/bar/baz");
    const basePath = AbsolutePath.from("/foo");
    const relativePath = absPath.relativeTo(basePath);
    expect(relativePath.relativePath).toBe("bar/baz");
  });
});

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
