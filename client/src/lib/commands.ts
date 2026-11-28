import { useEffect, useSyncExternalStore, type DependencyList } from "react";

/**
 * Command registry: every app action the palette can run. Components that
 * own an action register it with `useRegisterCommands`, so its `run` closes
 * over that component's live state. Shortcuts themselves are still handled
 * by the components' own key listeners; `keys` is the label shown.
 */

export interface CommandContext {
  activeUri: string | null;
}

export interface Command {
  id: string;
  title: string;
  category: string;
  /** Shortcut label in "Mod+Shift+F" form; Mod is Ctrl, or Cmd on macOS. */
  keys?: string;
  when?(ctx: CommandContext): boolean;
  run(ctx: CommandContext): void;
}

export interface CommandRegistry {
  /** Adds commands; an existing id is replaced. Returns a function that removes only what this call added and still owns. */
  register(commands: Command[]): () => void;
  /** Commands whose `when` passes (missing = enabled, throwing = disabled), sorted by category, then title. */
  enabled(ctx: CommandContext): Command[];
  subscribe(listener: () => void): () => void;
  /** Increments on every register/unregister. */
  version(): number;
}

export function createCommandRegistry(): CommandRegistry {
  const entries = new Map<string, { command: Command; owner: symbol }>();
  const listeners = new Set<() => void>();
  let version = 0;
  const changed = () => {
    version++;
    listeners.forEach(l => l());
  };

  const isEnabled = (command: Command, ctx: CommandContext) => {
    try {
      return command.when ? command.when(ctx) : true;
    } catch {
      return false;
    }
  };

  return {
    register(commands) {
      const owner = Symbol("registration");
      commands.forEach(command => entries.set(command.id, { command, owner }));
      changed();
      return () => {
        let removed = false;
        commands.forEach(command => {
          if (entries.get(command.id)?.owner === owner) {
            entries.delete(command.id);
            removed = true;
          }
        });
        if (removed) changed();
      };
    },
    enabled(ctx) {
      return Array.from(entries.values(), e => e.command)
        .filter(c => isEnabled(c, ctx))
        .sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    version: () => version,
  };
}

/** The app's registry. */
export const commandRegistry = createCommandRegistry();

/** Registers `commands` while the component is mounted; re-registers when `deps` change. */
export function useRegisterCommands(commands: Command[], deps: DependencyList) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => commandRegistry.register(commands), deps);
}

/** Re-renders the caller whenever commands are added or removed. */
export function useCommandRegistryVersion() {
  return useSyncExternalStore(commandRegistry.subscribe, commandRegistry.version);
}

export const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

const MAC_SYMBOLS: Record<string, string> = { Mod: "⌘", Shift: "⇧", Alt: "⌥", Ctrl: "⌃" };

/** "Mod+Shift+F" → "Ctrl+Shift+F", or "⌘⇧F" on macOS. */
export function formatKeys(keys: string, mac: boolean) {
  const parts = keys.split("+");
  return mac
    ? parts.map(p => MAC_SYMBOLS[p] ?? p).join("")
    : parts.map(p => (p === "Mod" ? "Ctrl" : p)).join("+");
}
