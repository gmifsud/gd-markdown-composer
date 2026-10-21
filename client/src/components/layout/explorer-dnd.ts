import { type DragEvent } from "react";
import { useMoveFile } from "@/components/layout/move-file-context";
import { dirName, samePath, useFsStatus } from "@/lib/fs-api";
import { useWorkspaceActions } from "@/lib/workspace";

/**
 * Drag a file onto a folder in the explorer to move it there.
 *
 * Rows carry plain data attributes (data-drag-path on files, data-drop-dir on
 * folders and on a folder's list of children) and the tree handles every drag
 * event once, so a folder with thousands of files gets no per-row handlers or
 * state. Highlighting is a class toggled directly on the one folder in play.
 */

/** A custom type, so text or files dragged in from elsewhere are ignored. */
const DRAG_TYPE = "application/x-mdc-file";
const DROP_CLASS = "mdc-drop-target";
const SPRING_LOAD_MS = 700;

// Only one drag happens at a time. getData() can't be read during dragover, so the dragged path is kept here.
let dragged: string | null = null;
let hovered: Element | null = null;
let springTimer: ReturnType<typeof setTimeout> | undefined;

function setHovered(el: Element | null, openFolder?: (dir: string) => void) {
  if (hovered === el) return;
  hovered?.classList.remove(DROP_CLASS);
  el?.classList.add(DROP_CLASS);
  hovered = el;
  clearTimeout(springTimer);
  // Resting on a collapsed folder opens it, so folders deeper down can be reached.
  const dir = el?.getAttribute("data-drop-dir");
  if (dir && el?.getAttribute("aria-expanded") === "false" && openFolder) {
    springTimer = setTimeout(() => openFolder(dir), SPRING_LOAD_MS);
  }
}

function endDrag() {
  setHovered(null);
  dragged = null;
}

/** Spread the result onto the explorer's tree element. */
export function useExplorerDragDrop() {
  const { moveFile } = useMoveFile();
  const { setExpanded } = useWorkspaceActions();
  const { data: status } = useFsStatus();
  const caseInsensitive = status?.caseInsensitive ?? true;

  /** The folder under the pointer that can take the dragged file (not the one it is already in). */
  const targetOf = (e: DragEvent) => {
    if (!dragged || !(e.target instanceof Element)) return null;
    const el = e.target.closest("[data-drop-dir]");
    const dir = el?.getAttribute("data-drop-dir");
    if (!el || !dir || samePath(dirName(dragged), dir, caseInsensitive)) return null;
    return { el, dir };
  };

  return {
    onDragStart(e: DragEvent) {
      const row = e.target instanceof Element ? e.target.closest("[data-drag-path]") : null;
      const path = row?.getAttribute("data-drag-path");
      if (!path) return;
      dragged = path;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData(DRAG_TYPE, path);
    },
    onDragOver(e: DragEvent) {
      if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
      const target = targetOf(e);
      setHovered(target?.el ?? null, dir => setExpanded(dir, true));
      if (!target) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    },
    onDragLeave(e: DragEvent) {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHovered(null);
    },
    onDrop(e: DragEvent) {
      const target = targetOf(e);
      const from = e.dataTransfer.getData(DRAG_TYPE);
      endDrag();
      if (!target || !from) return;
      e.preventDefault();
      void moveFile(from, target.dir);
    },
    onDragEnd: endDrag,
  };
}
