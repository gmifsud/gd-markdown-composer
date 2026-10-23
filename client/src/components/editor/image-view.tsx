import { useState } from "react";
import { Copy, ImageOff } from "lucide-react";
import { Expandable } from "@/components/editor/lightbox";
import { baseName, copyText, useFsStatus } from "@/lib/fs-api";

/** An image file (png, jpg, svg…) shown fitted to the pane, with Expand for zoom and full screen. */
export function ImageFileView({ path }: { path: string }) {
  const { data: status } = useFsStatus();
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const name = baseName(path);
  const url = status?.imageToken
    ? `/api/fs/image?${new URLSearchParams({ token: status.imageToken, path })}`
    : null;

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-white shadow-sm ring-1 ring-black/[0.03] z-10 m-0 md:m-4 md:rounded-2xl overflow-hidden">
      <div className="h-14 border-b border-gray-100 flex items-center px-4 md:px-6 justify-between gap-4 shrink-0">
        <div className="min-w-0 flex flex-col">
          <span className="font-bold text-lg text-gray-900 tracking-tight truncate" title={path}>{name}</span>
          <span className="text-[11px] text-gray-400 truncate" title={path}>{path}</span>
        </div>
        <div className="flex items-center gap-3 shrink-0 text-[12px] text-gray-500">
          {size && <span className="tabular-nums" data-testid="image-dimensions">{size.w} × {size.h} px</span>}
          <button
            className="flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-700"
            onClick={() => void copyText(path)}
            title="Copy the file's full path"
          >
            <Copy className="w-3.5 h-3.5" /> Copy path
          </button>
        </div>
      </div>
      <div
        className="flex-1 min-h-0 p-4 flex items-center justify-center"
        // Checkerboard so transparent images are visible.
        style={{ background: "repeating-conic-gradient(#f3f4f6 0% 25%, #ffffff 0% 50%) 50% / 20px 20px" }}
        data-testid="image-file-view"
      >
        {!url ? null : failed ? (
          <div className="flex flex-col items-center gap-2 text-gray-500 text-sm">
            <ImageOff className="w-8 h-8" /> This image couldn't be displayed.
          </div>
        ) : (
          <Expandable
            title={name}
            className="max-w-full max-h-full flex items-center justify-center"
            renderFull={() => <img className="w-full h-full object-contain" src={url} alt={name} draggable={false} />}
          >
            <img
              src={url}
              alt={name}
              className="max-w-full max-h-[calc(100vh-14rem)] object-contain shadow-sm"
              onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
              onError={() => setFailed(true)}
              draggable={false}
            />
          </Expandable>
        )}
      </div>
    </div>
  );
}
