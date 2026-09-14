import { useEffect, useRef } from "react";
import { Viewer } from "@photo-sphere-viewer/core";
import "@photo-sphere-viewer/core/index.css";
import { cn } from "@/lib/utils";

/** Same-origin proxy so WebGL can load IAA images (no CORS on mediaretriever). */
export function adminPhotoProxyUrl(sourceUrl: string): string {
  return `/api/admin/photos/proxy?url=${encodeURIComponent(sourceUrl)}`;
}

export function isInteriorPanoUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return /InteriorImageRetriever/i.test(url);
}

/**
 * Interactive equirectangular panorama (drag / scroll to look around).
 * Used for IAA InteriorImageRetriever cabin shots.
 */
export function PanoramaViewer({
  url,
  className,
  heightClassName = "h-[420px]",
}: {
  url: string;
  className?: string;
  heightClassName?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !url) return;

    const panorama = /\/api\/admin\/photos\/proxy\?/i.test(url) ? url : adminPhotoProxyUrl(url);
    let viewer: Viewer | null = null;

    try {
      viewer = new Viewer({
        container: el,
        panorama,
        navbar: ["zoom", "move", "fullscreen"],
        defaultZoomLvl: 50,
        mousewheel: true,
        mousemove: true,
        touchmoveTwoFingers: true,
        loadingTxt: "Loading panorama…",
      });
    } catch {
      /* WebGL unavailable */
    }

    return () => {
      if (!viewer) return;
      try {
        viewer.destroy();
      } catch {
        /* ignore */
      }
    };
  }, [url]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "w-full overflow-hidden rounded-lg border border-border bg-black/90",
        heightClassName,
        className,
      )}
    />
  );
}
