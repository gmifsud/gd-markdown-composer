import { useSyncExternalStore } from "react";

/** Whether the palette is open and what its input holds; anything can open it with a prefix. */
interface PaletteState {
  open: boolean;
  input: string;
}

/** Something that can take focus back when the palette closes (normally a DOM element). */
export interface FocusTarget {
  readonly isConnected: boolean;
  focus(): void;
}

let state: PaletteState = { open: false, input: "" };
// What had focus before the palette opened. Radix only gives focus back to a
// Dialog.Trigger, and the palette has none, so the palette does it itself.
let returnFocus: FocusTarget | null = null;
const listeners = new Set<() => void>();

function set(next: PaletteState) {
  state = next;
  listeners.forEach(l => l());
}

const focusedElement = (): FocusTarget | null =>
  typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null;

/** Opens the palette with `input` typed in (">" commands, "@" headings, ":" line). */
export function openPalette(input = "", focused: FocusTarget | null = focusedElement()) {
  // Switching modes while open must not replace the remembered target with the palette's own input.
  if (!state.open) returnFocus = focused;
  set({ open: true, input });
}

export function closePalette() {
  if (state.open) set({ ...state, open: false });
}

export function setPaletteInput(input: string) {
  set({ ...state, input });
}

/** The element to give focus back to after closing; returns it once. */
export function takeReturnFocus(): FocusTarget | null {
  const target = returnFocus;
  returnFocus = null;
  return target;
}

export function usePaletteState(): PaletteState {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => state,
  );
}
