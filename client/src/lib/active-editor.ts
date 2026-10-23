import { useSyncExternalStore } from "react";

/**
 * Shared state of the editor that is currently shown: its live (possibly
 * unsaved) text for the Outline panel, and "jump to" requests from the
 * Outline and search results.
 */

export interface ActiveEditorInfo {
  /** Tab URI (db:<id> or file:<path>). */
  uri: string;
  fileType: "md" | "json" | "yaml" | "drawio" | "html" | "text";
  title: string;
  content: string;
}

export interface RevealTarget {
  /** 0-based line in the source. */
  line: number;
  /** Text to select on that line (a search match). */
  query?: string;
  /** A heading to scroll the preview to: its text and which occurrence of that text. */
  heading?: { text: string; occurrence: number };
}

type RevealHandler = (target: RevealTarget) => void;

let active: ActiveEditorInfo | null = null;
const listeners = new Set<() => void>();
let handler: { uri: string; reveal: RevealHandler } | null = null;
const pending = new Map<string, RevealTarget>();

function emit() {
  listeners.forEach(l => l());
}

export function publishActiveEditor(info: ActiveEditorInfo) {
  active = info;
  emit();
}

export function clearActiveEditor(uri: string) {
  if (active?.uri === uri) {
    active = null;
    emit();
  }
}

export function useActiveEditor() {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => active,
  );
}

/** The mounted editor registers how to scroll/select; returns an unregister function. */
export function registerRevealHandler(uri: string, reveal: RevealHandler) {
  handler = { uri, reveal };
  const queued = pending.get(uri);
  if (queued) {
    pending.delete(uri);
    // Let the editor finish mounting before scrolling (a timer also runs in background windows).
    setTimeout(() => reveal(queued), 30);
  }
  return () => {
    if (handler?.uri === uri) handler = null;
  };
}

/** Jumps to a place in a document; if it isn't open yet, it happens when its editor mounts. */
export function requestReveal(uri: string, target: RevealTarget) {
  if (handler?.uri === uri) handler.reveal(target);
  else pending.set(uri, target);
}
