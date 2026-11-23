import { test, expect } from "bun:test";
import { analyzeYaml, jsonDiagnostics, jsonErrorOffset, yamlDiagnostics } from "./structured";

test("jsonErrorOffset reads V8 'at position'", () =>
  expect(jsonErrorOffset("Unexpected token } in JSON at position 15 (line 2 column 3)", "x".repeat(20))).toBe(15));

test("jsonErrorOffset reads line/column", () =>
  expect(jsonErrorOffset("Expected ',' or '}' after property value in JSON at line 2 column 3", '{\n  "a" 1}')).toBe(4));

test("jsonErrorOffset falls back to 0 (JavaScriptCore messages have no position)", () =>
  expect(jsonErrorOffset("JSON Parse error: Expected '}'", "{")).toBe(0));

test("jsonErrorOffset clamps to the text length", () =>
  expect(jsonErrorOffset("at position 99", "abc")).toBe(3));

test("jsonDiagnostics: none for valid or empty", () => {
  expect(jsonDiagnostics('{"a": 1}')).toEqual([]);
  expect(jsonDiagnostics("  ")).toEqual([]);
});

test("jsonDiagnostics: one error inside the text", () => {
  const d = jsonDiagnostics('{"a": }');
  expect(d).toHaveLength(1);
  expect(d[0].severity).toBe("error");
  expect(d[0].from).toBeGreaterThanOrEqual(0);
  expect(d[0].to).toBeLessThanOrEqual(7);
  expect(d[0].to).toBeGreaterThan(d[0].from);
});

test("yamlDiagnostics: error for an unclosed flow sequence", () => {
  const d = yamlDiagnostics("a: 1\nb: [");
  expect(d.length).toBeGreaterThanOrEqual(1);
  expect(d[0].severity).toBe("error");
  expect(d[0].to).toBeLessThanOrEqual(10);
});

test("yamlDiagnostics: apostrophes are fine", () =>
  expect(yamlDiagnostics("a: it's fine\n# it's a comment\n")).toEqual([]));

test("analyzeYaml keeps nesting", () =>
  expect(analyzeYaml("a:\n    b: 1\n").formatted).toBe("a:\n  b: 1\n"));
