import React from "react";
import { Link, useLocation } from "wouter";
import { useAdminGetMe, getAdminGetMeQueryKey } from "@workspace/api-client-react";
import { ArrowLeft, Layers } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { cn } from "@/lib/utils";

export function LiveFeedTestShell({
  feedName,
  children,
  headerExtra,
  showAllFeedsLink = false,
}: {
  feedName?: string;
  children: React.ReactNode;
  headerExtra?: React.ReactNode;
  showAllFeedsLink?: boolean;
}) {
  const [, setLocation] = useLocation();
  const { error, isLoading } = useAdminGetMe({
    query: { retry: false, queryKey: getAdminGetMeQueryKey() },
  });

  React.useEffect(() => {
    if (error) setLocation("/login");
  }, [error, setLocation]);

  if (isLoading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-slate-950">
        <div className="text-slate-400 text-sm animate-pulse px-4 text-center">
          Loading live feed sandbox…
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-slate-950 text-slate-100">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-slate-950/95 backdrop-blur-md safe-top">
        <div className="max-w-[1400px] mx-auto px-3 sm:px-4 lg:px-8 h-12 sm:h-14 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <Link
              href="/live-feeds"
              className="touch-target inline-flex items-center justify-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors shrink-0 rounded-md"
              aria-label="Back to admin"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Back</span>
            </Link>
            <div className="h-5 w-px bg-white/10 shrink-0" />
            <Logo variant="inverse" textClassName="text-base" />
            {feedName && (
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate">{feedName}</div>
              </div>
            )}
          </div>
          <div className={cn("flex items-center gap-2 shrink-0")}>
            {showAllFeedsLink && (
              <a
                href={`${import.meta.env.BASE_URL.replace(/\/$/, "")}/live-feeds/all/test`}
                target="_blank"
                rel="noopener noreferrer"
                className="hidden sm:inline-flex items-center gap-1.5 h-9 px-3 rounded-md text-xs font-medium bg-sky-600 hover:bg-sky-500 text-white"
              >
                <Layers className="w-3.5 h-3.5" />
                All enabled feeds
              </a>
            )}
            {headerExtra}
          </div>
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}
