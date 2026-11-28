import { test, expect } from "bun:test";
import { currentFolderFiles } from "./use-folder-file-search";

const result = { query: "rea", files: ["/docs/README.md"], loading: false, truncated: false };

test("results are shown for the query that produced them", () =>
  expect(currentFolderFiles(result, "rea")).toEqual(["/docs/README.md"]));

test("results from an earlier query are hidden while the new search runs", () =>
  expect(currentFolderFiles({ ...result, loading: true }, "readx")).toEqual([]));

test("surrounding spaces don't count as a different query", () =>
  expect(currentFolderFiles(result, " rea ")).toEqual(["/docs/README.md"]));
