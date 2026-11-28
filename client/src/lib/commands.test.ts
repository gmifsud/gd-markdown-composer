import { test, expect } from "bun:test";
import { createCommandRegistry, formatKeys, type Command } from "./commands";

const cmd = (id: string, extra: Partial<Command> = {}): Command => ({
  id, title: id, category: "Test", run() {}, ...extra,
});
const noTab = { activeUri: null };
const withTab = { activeUri: "db:1" };

test("register then enabled lists it; unregister removes it", () => {
  const r = createCommandRegistry();
  const off = r.register([cmd("a")]);
  expect(r.enabled(noTab).map(c => c.id)).toEqual(["a"]);
  off();
  expect(r.enabled(noTab)).toEqual([]);
});

test("when filters, and a throwing when counts as disabled", () => {
  const r = createCommandRegistry();
  r.register([
    cmd("tab", { when: ctx => ctx.activeUri !== null }),
    cmd("boom", { when: () => { throw new Error("x"); } }),
  ]);
  expect(r.enabled(noTab).map(c => c.id)).toEqual([]);
  expect(r.enabled(withTab).map(c => c.id)).toEqual(["tab"]);
});

test("duplicate id replaces; the first unregister leaves the replacement", () => {
  const r = createCommandRegistry();
  const offFirst = r.register([cmd("a", { title: "One" })]);
  r.register([cmd("a", { title: "Two" })]);
  expect(r.enabled(noTab).map(c => c.title)).toEqual(["Two"]);
  offFirst();
  expect(r.enabled(noTab).map(c => c.title)).toEqual(["Two"]);
});

test("sorted by category then title", () => {
  const r = createCommandRegistry();
  r.register([
    cmd("1", { category: "View", title: "B" }),
    cmd("2", { category: "File", title: "Z" }),
    cmd("3", { category: "View", title: "A" }),
  ]);
  expect(r.enabled(noTab).map(c => c.id)).toEqual(["2", "3", "1"]);
});

test("version and subscribers change on register and unregister", () => {
  const r = createCommandRegistry();
  let calls = 0;
  r.subscribe(() => { calls++; });
  const v0 = r.version();
  const off = r.register([cmd("a")]);
  expect(r.version()).toBeGreaterThan(v0);
  const v1 = r.version();
  off();
  expect(r.version()).toBeGreaterThan(v1);
  expect(calls).toBe(2);
});

test("formatKeys", () => {
  expect(formatKeys("Mod+Shift+F", false)).toBe("Ctrl+Shift+F");
  expect(formatKeys("Mod+Shift+F", true)).toBe("⌘⇧F");
  expect(formatKeys("F1", true)).toBe("F1");
});
