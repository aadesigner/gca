import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useRoute } from "wouter";
import { LiveFeedTestShell } from "@/components/layout/live-feed-test-shell";
import { LiveFeedDetailView } from "@/pages/live-feeds/test-detail";
import {
  fetchLiveFeedVehicleDetail,
  readLiveBrowseHref,
  readLiveVehicleSnapshot,
  snapshotToDetail,
  type LiveFeedId,
  type LiveVehicleDetail,
} from "@/lib/live-feed-api";

function parseFeedParamLocal(raw?: string): LiveFeedId | null {
  if (raw === "all" || raw === "combined") return "combined";
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function sourceName(internalName?: string) {
  if (internalName === "encar_live") return "Encar";
  if (internalName === "autowini_live") return "Autowini";
  if (internalName === "kbchachacha_live") return "KB ChaChaCha";
  return "source";
}

export default function LiveFeedVehiclePage() {
  const [, params] = useRoute("/live-feeds/:id/test/:listingId");
  const feedId = parseFeedParamLocal(params?.id);
  const listingId = params?.listingId ? decodeURIComponent(params.listingId) : "";
  const providerId = useMemo(() => {
    const raw = new URLSearchParams(window.location.search).get("providerId");
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }, []);

  const snapshot = useMemo(
    () => (feedId != null && listingId ? readLiveVehicleSnapshot(feedId, listingId) : null),
    [feedId, listingId],
  );
  const backHref = readLiveBrowseHref(`/live-feeds/${params?.id ?? "all"}/test`);

  const [detail, setDetail] = useState<LiveVehicleDetail | null>(
    snapshot ? snapshotToDetail(snapshot) : null,
  );
  const [loading, setLoading] = useState(!snapshot);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (feedId == null || !listingId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchLiveFeedVehicleDetail(feedId, listingId, { providerId });
      setDetail(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      if (!snapshot) setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [feedId, listingId, providerId, snapshot]);

  useEffect(() => {
    void load();
  }, [load]);

  const title =
    detail?.vehicle
      ? `${detail.vehicle.year ?? ""} ${detail.vehicle.make ?? ""} ${detail.vehicle.model ?? ""}`.trim()
      : "Vehicle";

  return (
    <LiveFeedTestShell
      feedName={title || "Vehicle"}
      headerExtra={
        <Link
          href={backHref}
          className="h-9 px-3 rounded-lg text-xs font-medium border border-white/10 text-slate-200 hover:bg-white/5 inline-flex items-center"
        >
          Back to results
        </Link>
      }
    >
      <LiveFeedDetailView
        detail={detail}
        loading={loading}
        error={error}
        onRetry={() => void load()}
        sourceLabel={sourceName(detail?.vehicle.sourceProvider?.internalName)}
      />
    </LiveFeedTestShell>
  );
}
