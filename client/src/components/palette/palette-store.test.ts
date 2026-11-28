import { test, expect } from "bun:test";
import { closePalette, openPalette, takeReturnFocus } from "./palette-store";

const el = (name: string) => ({ name, isConnected: true, focus() {} });

test("remembers what had focus when the palette opened", () => {
  const editor = el("editor");
  openPalette("", editor);
  closePalette();
  expect(takeReturnFocus()).toBe(editor);
  expect(takeReturnFocus()).toBeNull();
});

test("reopening while open (mode switch) keeps the original focus target", () => {
  const editor = el("editor");
  openPalette("", editor);
  openPalette(">", el("palette input"));
  closePalette();
  expect(takeReturnFocus()).toBe(editor);
});
