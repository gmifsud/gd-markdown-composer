/**
 * Files that normally open read-only (plain text, diagrams) but that the user
 * unlocked or just created in this session, so they reopen ready to edit.
 */
const unlocked = new Set<string>();

export function markUnlocked(path: string) {
  unlocked.add(path);
}

export function isUnlocked(path: string) {
  return unlocked.has(path);
}
