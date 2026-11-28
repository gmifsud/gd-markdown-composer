import { test, expect } from "bun:test";
import { RECENT_LIMIT, fileUrisAt, normalizeRecent, pruneRecent, pushRecent, retargetRecent } from "./recent";

const many = (n: number) => Array.from({ length: n }, (_, i) => `file:${i}`);

test("pushRecent moves an existing uri to the front", () =>
  expect(pushRecent(["b", "a"], "a")).toEqual(["a", "b"]));

test("pushRecent caps at 50, dropping the oldest", () => {
  const list = many(RECENT_LIMIT);
  const next = pushRecent(list, "new");
  expect(RECENT_LIMIT).toBe(50);
  expect(next.length).toBe(50);
  expect(next[0]).toBe("new");
  expect(next).not.toContain(list[list.length - 1]);
});

test("pushRecent returns the same array when the uri is already first", () => {
  const list = ["a", "b"];
  expect(pushRecent(list, "a")).toBe(list);
});

test("retargetRecent replaces and dedupes", () =>
  expect(retargetRecent(["x", "from", "to"], "from", "to")).toEqual(["x", "to"]));

test("retargetRecent returns the same array when from is absent", () => {
  const list = ["a"];
  expect(retargetRecent(list, "from", "to")).toBe(list);
});

test("pruneRecent drops entries", () =>
  expect(pruneRecent(["db:1", "file:a", "db:2"], u => u !== "db:2")).toEqual(["db:1", "file:a"]));

test("pruneRecent returns the same array when nothing is removed", () => {
  const list = ["a"];
  expect(pruneRecent(list, () => true)).toBe(list);
});

test("normalizeRecent cleans stored values", () => {
  expect(normalizeRecent(undefined)).toEqual([]);
  expect(normalizeRecent("nope")).toEqual([]);
  expect(normalizeRecent(["a", 3, "a", "b"])).toEqual(["a", "b"]);
  expect(normalizeRecent(many(60)).length).toBe(50);
});

test("fileUrisAt finds a path's file entries however it was written", () => {
  const list = ["file:C:\\Notes\\a.md", "db:1", "file:C:\\Notes\\b.md"];
  expect(fileUrisAt(list, "c:/notes/a.md", true)).toEqual(["file:C:\\Notes\\a.md"]);
  expect(fileUrisAt(list, "c:/notes/a.md", false)).toEqual([]);
});
