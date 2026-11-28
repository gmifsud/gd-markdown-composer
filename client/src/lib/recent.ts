/**
 * Recently opened tab URIs, most recent first. Every helper returns the same
 * array when nothing changes, so the workspace reducer can skip a re-render.
 */

import { samePath } from "@/lib/fs-api";

export const RECENT_LIMIT = 50;

export function pushRecent(list: string[], uri: string): string[] {
  if (list[0] === uri) return list;
  return [uri, ...list.filter(u => u !== uri)].slice(0, RECENT_LIMIT);
}

export function retargetRecent(list: string[], from: string, to: string): string[] {
  if (!list.includes(from)) return list;
  const mapped = list.map(u => (u === from ? to : u));
  return mapped.filter((u, i) => mapped.indexOf(u) === i);
}

export function pruneRecent(list: string[], keep: (uri: string) => boolean): string[] {
  const kept = list.filter(keep);
  return kept.length === list.length ? list : kept;
}

/** The `file:` entries of `list` that point at `path`, whatever separators or case they were written with. */
export function fileUrisAt(list: string[], path: string, caseInsensitive: boolean): string[] {
  return list.filter(u => u.startsWith("file:") && samePath(u.slice(5), path, caseInsensitive));
}

/** A value read from storage, as a clean list (anything malformed is dropped). */
export function normalizeRecent(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const strings = value.filter((u): u is string => typeof u === "string");
  return strings.filter((u, i) => strings.indexOf(u) === i).slice(0, RECENT_LIMIT);
}
