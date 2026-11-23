import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { copyText, desktop } from "@/lib/fs-api";
import { APP_NAME, APP_VERSION, BUILD_DATE, BUILD_NUMBER, GIT_SHA } from "@/lib/version";

/** The "M↓" mark from electron/icons/icon.svg. */
export function AppLogo({ className = "h-3.5 w-auto" }: { className?: string }) {
  return (
    <svg viewBox="0 0 208 128" className={className} aria-hidden>
      <rect x="5" y="5" width="198" height="118" rx="12" fill="none" stroke="currentColor" strokeWidth="12" />
      <path fill="currentColor" d="M30 98V30h20l20 25 20-25h20v68H90V59L70 84 50 59v39zm125 0l-30-33h20V30h20v35h20z" />
    </svg>
  );
}

function formatBuildDate(iso: string): string {
  if (!iso) return "unknown";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

interface AboutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AboutDialog({ open, onOpenChange }: AboutDialogProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const runtimeLabel = desktop
    ? desktop.versions?.electron
      ? `Desktop (Electron ${desktop.versions.electron})`
      : "Desktop (Electron)"
    : "Web Browser";

  const rows: { label: string; value: string; mono?: boolean }[] = [
    { label: "Version", value: `v${APP_VERSION}`, mono: true },
    { label: "Build", value: BUILD_NUMBER || "dev", mono: true },
    { label: "Commit", value: GIT_SHA || "local", mono: true },
    { label: "Build Date", value: formatBuildDate(BUILD_DATE), mono: true },
    { label: "Runtime", value: runtimeLabel },
    ...(desktop?.versions?.chrome
      ? [{ label: "Chromium", value: desktop.versions.chrome, mono: true }]
      : []),
    { label: "License", value: "MIT" },
  ];

  const handleCopy = () => {
    const summary = [
      APP_NAME,
      ...rows.map((r) => `${r.label}: ${r.value}`),
    ].join("\n");
    void copyText(summary).then(
      () => setCopied(true),
      () => {},
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="about-dialog">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-[#1d4ed8]/10 text-[#1d4ed8] flex items-center justify-center shrink-0 border border-[#1d4ed8]/20">
              <AppLogo className="h-5 w-auto" />
            </div>
            <div className="text-left">
              <DialogTitle className="text-base">{APP_NAME}</DialogTitle>
              <DialogDescription className="text-xs mt-0.5">
                Markdown, Mermaid, PlantUML, JSON &amp; YAML workbench
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="rounded-md border border-gray-200 bg-gray-50/70 divide-y divide-gray-200 text-xs">
          {rows.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-4 px-3 py-2">
              <span className="text-gray-500 font-medium">{row.label}</span>
              <span
                className={`text-gray-800 text-right break-all ${row.mono ? "font-mono" : ""}`}
                data-testid={`about-${row.label.toLowerCase().replace(/\s+/g, "-")}`}
              >
                {row.value}
              </span>
            </div>
          ))}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCopy}
            data-testid="button-copy-about"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-green-600" />
                Copied
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                Copy Details
              </>
            )}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => onOpenChange(false)}
            data-testid="button-close-about"
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
