import { useRef, useState } from "react";
import { Download, Save } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const HOLD_MS = 450;

interface SaveButtonProps {
  /** There are unsaved changes (the button is highlighted and clicking saves). */
  canSave: boolean;
  onSave(): void;
  onSaveAs(): void;
  compact?: boolean;
}

/**
 * One small Save button. Click saves; press and hold (or right-click, or
 * ArrowDown) opens a menu with Save As, which downloads a copy.
 */
export function SaveButton({ canSave, onSave, onSaveAs, compact = false }: SaveButtonProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openedByHold = useRef(false);

  const clearHold = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  };

  return (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={`relative overflow-hidden flex items-center gap-1.5 rounded-full font-semibold transition-colors select-none ${
            compact ? "h-7 px-2.5 text-[11px]" : "h-7 px-3 text-xs"
          } ${canSave ? "bg-gray-900 text-white hover:bg-gray-800" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}
          title={canSave ? "Save (Ctrl+S) · hold for Save As" : "Saved · hold for Save As"}
          aria-haspopup="menu"
          data-testid="button-save"
          // Take over from the menu trigger: a short press saves, a long press opens the menu.
          onPointerDown={(e) => {
            e.preventDefault();
            if (e.button !== 0) return;
            openedByHold.current = false;
            setHolding(true);
            timer.current = setTimeout(() => {
              openedByHold.current = true;
              setHolding(false);
              setMenuOpen(true);
            }, HOLD_MS);
          }}
          onPointerUp={() => {
            const wasShortPress = !!timer.current && !openedByHold.current;
            clearHold();
            if (wasShortPress && canSave) onSave();
          }}
          onPointerLeave={clearHold}
          onPointerCancel={clearHold}
          onContextMenu={(e) => { e.preventDefault(); clearHold(); setMenuOpen(true); }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (canSave) onSave(); }
            if (e.key === "ArrowDown") { e.preventDefault(); setMenuOpen(true); }
          }}
        >
          {/* Fills while the button is held, hinting at the menu. */}
          <span
            aria-hidden
            className={`absolute inset-y-0 left-0 bg-white/25 ${holding ? "w-full transition-[width] ease-linear" : "w-0"}`}
            style={holding ? { transitionDuration: `${HOLD_MS}ms` } : undefined}
          />
          <Save className="relative w-3.5 h-3.5" />
          <span className="relative">Save</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onSelect={onSaveAs} data-testid="menu-save-as">
          <Download className="w-3.5 h-3.5 mr-2" /> Save As… <span className="ml-auto text-[11px] text-gray-400">download a copy</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
