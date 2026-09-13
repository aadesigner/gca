import React, { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from "@/components/ui/carousel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { encarPhotoUrl } from "@/lib/live-feed-api";

export type PhotoLightboxItem = {
  url: string;
  label?: string;
  isPrimary?: boolean;
};

export function PhotoLightbox({
  open,
  onOpenChange,
  photos,
  initialIndex = 0,
  title = "Photos",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  photos: PhotoLightboxItem[];
  initialIndex?: number;
  title?: string;
}) {
  const [api, setApi] = useState<CarouselApi>();
  const [index, setIndex] = useState(0);
  const safeInitial = photos.length
    ? Math.min(Math.max(initialIndex, 0), photos.length - 1)
    : 0;
  const current = photos[index];

  useEffect(() => {
    if (!open) return;
    setIndex(safeInitial);
  }, [open, safeInitial]);

  useEffect(() => {
    if (!api || !open) return;
    api.scrollTo(safeInitial, true);
    const onSelect = () => setIndex(api.selectedScrollSnap());
    onSelect();
    api.on("select", onSelect);
    return () => {
      api.off("select", onSelect);
    };
  }, [api, open, safeInitial, photos.length]);

  useEffect(() => {
    if (!open || photos.length < 2) return;
    const next = photos[(index + 1) % photos.length];
    const prev = photos[(index - 1 + photos.length) % photos.length];
    for (const item of [next, prev]) {
      if (!item?.url) continue;
      const img = new Image();
      img.referrerPolicy = "no-referrer";
      img.src = encarPhotoUrl(item.url, "display");
    }
  }, [open, index, photos]);

  if (!photos.length) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className={cn(
            "inset-0 top-0 bottom-0 left-0 right-0 z-50 flex h-[100dvh] max-h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 bg-black p-0",
            "sm:inset-0 sm:left-0 sm:top-0 sm:max-h-[100dvh] sm:max-w-none sm:translate-x-0 sm:translate-y-0 sm:rounded-none sm:p-0",
            "[&>button]:right-3 [&>button]:top-3 [&>button]:z-20 [&>button]:h-10 [&>button]:w-10 [&>button]:rounded-full [&>button]:bg-white/10 [&>button]:text-white [&>button]:opacity-100",
          )}
        >
          <DialogTitle className="sr-only">{title}</DialogTitle>
          <DialogDescription className="sr-only">Loading photos</DialogDescription>
          <div className="flex flex-1 items-center justify-center text-sm text-white/70">
            Loading photos…
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "inset-0 top-0 bottom-0 left-0 right-0 z-50 flex h-[100dvh] max-h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 bg-black p-0",
          "sm:inset-0 sm:left-0 sm:top-0 sm:max-h-[100dvh] sm:max-w-none sm:translate-x-0 sm:translate-y-0 sm:rounded-none sm:p-0",
          "data-[state=closed]:slide-out-to-bottom-0 data-[state=open]:slide-in-from-bottom-0",
          "sm:data-[state=closed]:slide-out-to-left-0 sm:data-[state=closed]:slide-out-to-top-0 sm:data-[state=open]:slide-in-from-left-0 sm:data-[state=open]:slide-in-from-top-0",
          "[&>button]:right-3 [&>button]:top-3 [&>button]:z-20 [&>button]:h-10 [&>button]:w-10 [&>button]:rounded-full [&>button]:bg-white/10 [&>button]:text-white [&>button]:opacity-100 [&>button]:hover:bg-white/20 [&>button]:hover:opacity-100 [&>button]:focus:ring-white/40",
        )}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">
          Swipe or use arrow keys to browse {photos.length} photos.
        </DialogDescription>

        <div className="relative z-10 flex items-center justify-between gap-3 px-4 py-3 pr-14 text-white">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{title}</div>
            <div className="truncate text-xs text-white/60">
              {index + 1} / {photos.length}
              {current?.label ? ` · ${current.label}` : ""}
              {current?.isPrimary ? " · primary" : ""}
            </div>
          </div>
          {current?.url ? (
            <a
              href={current.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/20"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Open
            </a>
          ) : null}
        </div>

        <div className="relative min-h-0 flex-1">
          <Carousel
            setApi={setApi}
            opts={{ loop: photos.length > 1, startIndex: safeInitial }}
            className="h-full"
          >
            <CarouselContent className="-ml-0 h-full">
              {photos.map((photo, i) => (
                <CarouselItem key={`${photo.url}-${i}`} className="pl-0 basis-full h-full">
                  <div className="flex h-full w-full items-center justify-center px-2 sm:px-12">
                    <img
                      src={encarPhotoUrl(photo.url, "display")}
                      alt={photo.label ?? `Photo ${i + 1}`}
                      referrerPolicy="no-referrer"
                      className="max-h-[min(72dvh,100%)] max-w-full object-contain select-none"
                      draggable={false}
                    />
                  </div>
                </CarouselItem>
              ))}
            </CarouselContent>
          </Carousel>

          {photos.length > 1 ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute left-2 top-1/2 z-10 h-11 w-11 -translate-y-1/2 rounded-full bg-black/40 text-white hover:bg-black/60 hover:text-white"
                onClick={() => api?.scrollPrev()}
                aria-label="Previous photo"
              >
                <ChevronLeft className="h-6 w-6" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-2 top-1/2 z-10 h-11 w-11 -translate-y-1/2 rounded-full bg-black/40 text-white hover:bg-black/60 hover:text-white"
                onClick={() => api?.scrollNext()}
                aria-label="Next photo"
              >
                <ChevronRight className="h-6 w-6" />
              </Button>
            </>
          ) : null}
        </div>

        {photos.length > 1 ? (
          <div className="z-10 flex gap-2 overflow-x-auto px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {photos.map((photo, i) => (
              <button
                key={`thumb-${photo.url}-${i}`}
                type="button"
                onClick={() => api?.scrollTo(i)}
                className={cn(
                  "h-14 w-[4.5rem] shrink-0 overflow-hidden rounded-md ring-2 ring-transparent transition",
                  i === index ? "ring-white" : "opacity-60 hover:opacity-100",
                )}
                aria-label={`Go to photo ${i + 1}`}
              >
                <img
                  src={encarPhotoUrl(photo.url, "thumb")}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              </button>
            ))}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** Build gallery items: CDN first, then unmatched source photos (deduped by id). */
export function galleryFromSplitPhotos(input: {
  photosNew?: Array<{ id?: number | null; url?: string; provider?: string; isPrimary?: boolean; sortOrder?: number }>;
  photosOld?: Array<{ id?: number | null; url?: string; provider?: string; isPrimary?: boolean; sortOrder?: number }>;
  /** When true, skip import-motor source URLs (admin Photos tab behavior). */
  excludeImportMotor?: boolean;
}): PhotoLightboxItem[] {
  const photosNew = input.photosNew ?? [];
  const photosOld = (input.photosOld ?? []).filter((p) =>
    input.excludeImportMotor ? p.provider !== "import-motor" : true,
  );
  const cdnIds = new Set(photosNew.map((p) => p.id).filter((id) => id != null));
  const pending = photosOld.filter((p) => p.id == null || !cdnIds.has(p.id));
  return [...photosNew, ...pending]
    .filter((p): p is typeof p & { url: string } => Boolean(p.url))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || (a.id ?? 0) - (b.id ?? 0))
    .map((p) => ({
      url: p.url,
      label: p.provider,
      isPrimary: p.isPrimary,
    }));
}
