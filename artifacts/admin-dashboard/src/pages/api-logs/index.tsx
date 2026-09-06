import React, { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useListApiClients } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

async function fetchLogs(params: URLSearchParams) {
  const res = await fetch(`/api/admin/api-logs?${params}`, { credentials: "include" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body as {
    items: any[];
    total: number;
    limit: number;
    offset: number;
  };
}

const DAY_OPTIONS = [1, 2, 7, 14, 30, 60, 90] as const;

export default function ApiLogs() {
  const searchParams = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const [filterClientId, setFilterClientId] = useState(searchParams.get("clientId") || "");
  const [days, setDays] = useState(Number(searchParams.get("days")) || 7);
  const [pathClass, setPathClass] = useState(searchParams.get("pathClass") || "all");
  const [statusClass, setStatusClass] = useState(searchParams.get("statusClass") || "all");
  const [vin, setVin] = useState(searchParams.get("vin") || "");
  const [vinDraft, setVinDraft] = useState(searchParams.get("vin") || "");
  const [offset, setOffset] = useState(0);
  const limit = 100;

  const { data: clients } = useListApiClients();

  useEffect(() => {
    const url = new URL(window.location.href);
    const setOrDel = (k: string, v: string) => {
      if (!v || v === "all") url.searchParams.delete(k);
      else url.searchParams.set(k, v);
    };
    setOrDel("clientId", filterClientId);
    setOrDel("days", String(days));
    setOrDel("pathClass", pathClass);
    setOrDel("statusClass", statusClass);
    setOrDel("vin", vin);
    window.history.replaceState({}, "", url.toString());
  }, [filterClientId, days, pathClass, statusClass, vin]);

  const params = useMemo(() => {
    const p = new URLSearchParams({
      days: String(days),
      limit: String(limit),
      offset: String(offset),
    });
    if (filterClientId) p.set("clientId", filterClientId);
    if (pathClass !== "all") p.set("pathClass", pathClass);
    if (statusClass !== "all") p.set("statusClass", statusClass);
    if (vin.trim()) p.set("vin", vin.trim().toUpperCase());
    return p;
  }, [filterClientId, days, pathClass, statusClass, vin, offset]);

  const { data: logsData, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["admin-api-logs", params.toString()],
    queryFn: () => fetchLogs(params),
    refetchInterval: 30_000,
  });

  const total = logsData?.total ?? 0;
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">API Request Logs</h1>
          <p className="text-muted-foreground text-sm mt-1">Filter by client, path, status, VIN, and time window.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href={filterClientId ? `/api-usage?clientId=${filterClientId}&days=${days}` : `/api-usage?days=${days}`}>
              Graphs
            </Link>
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3 bg-card p-4 rounded-xl border border-border shadow-sm">
        <div className="flex flex-wrap gap-2">
          {DAY_OPTIONS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => {
                setDays(d);
                setOffset(0);
              }}
              className={cn(
                "h-8 px-3 rounded-md text-xs font-medium border",
                days === d
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background border-input text-muted-foreground",
              )}
            >
              {d === 1 ? "1d" : `${d}d`}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <select
            className="flex h-10 w-full sm:w-[220px] rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={filterClientId}
            onChange={(e) => {
              setFilterClientId(e.target.value);
              setOffset(0);
            }}
          >
            <option value="">All Clients</option>
            {clients?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            value={pathClass}
            onChange={(e) => {
              setPathClass(e.target.value);
              setOffset(0);
            }}
          >
            <option value="all">All paths</option>
            <option value="vin">VIN retrieve</option>
            <option value="check">VIN check</option>
            <option value="live">Live</option>
          </select>
          <select
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            value={statusClass}
            onChange={(e) => {
              setStatusClass(e.target.value);
              setOffset(0);
            }}
          >
            <option value="all">All statuses</option>
            <option value="2xx">2xx</option>
            <option value="4xx">4xx</option>
            <option value="5xx">5xx</option>
            <option value="errors">Errors</option>
          </select>
          <form
            className="flex gap-2 flex-1 min-w-[160px]"
            onSubmit={(e) => {
              e.preventDefault();
              setVin(vinDraft.trim().toUpperCase());
              setOffset(0);
            }}
          >
            <Input
              value={vinDraft}
              onChange={(e) => setVinDraft(e.target.value)}
              placeholder="VIN filter…"
              className="h-10 font-mono text-xs"
            />
            <Button type="submit" variant="secondary" className="h-10">
              Apply
            </Button>
          </form>
        </div>
        <p className="text-xs text-muted-foreground">
          {total.toLocaleString()} matching · page {page} / {pages}
        </p>
      </div>

      <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-muted/50 text-xs uppercase font-semibold text-muted-foreground border-b border-border tracking-wider">
              <tr>
                <th className="px-4 py-3">Timestamp</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">VIN</th>
                <th className="px-4 py-3">Method & Path</th>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">IP</th>
                <th className="px-4 py-3 text-right">Latency</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-muted-foreground animate-pulse font-mono text-xs">
                    Loading…
                  </td>
                </tr>
              ) : isError ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-destructive text-sm">
                    {(error as Error)?.message || "Failed to load logs"}
                  </td>
                </tr>
              ) : !logsData || logsData.items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-muted-foreground">
                    No logs found.
                  </td>
                </tr>
              ) : (
                logsData.items.map((log) => (
                  <tr key={log.id} className="hover:bg-muted/30 transition-colors font-mono">
                    <td className="px-4 py-2.5 text-muted-foreground text-xs whitespace-nowrap">
                      {new Date(log.requestedAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          log.statusCode >= 500
                            ? "bg-red-100 text-red-700"
                            : log.statusCode >= 400
                              ? "bg-amber-100 text-amber-700"
                              : "bg-green-100 text-green-700"
                        }`}
                      >
                        {log.statusCode}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{log.vin || "—"}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-[10px] font-bold ${
                            log.method === "GET" ? "text-blue-500" : log.method === "POST" ? "text-green-500" : "text-amber-500"
                          }`}
                        >
                          {log.method}
                        </span>
                        <span className="text-foreground truncate max-w-[280px]" title={log.path}>
                          {log.path}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-xs font-sans">{log.clientName || "—"}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{log.ipAddress || "—"}</td>
                    <td className="px-4 py-2.5 text-right text-muted-foreground text-xs">{log.durationMs}ms</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-border">
          <Button
            variant="outline"
            size="sm"
            disabled={offset <= 0}
            onClick={() => setOffset(Math.max(0, offset - limit))}
          >
            Previous
          </Button>
          <span className="text-xs text-muted-foreground">
            Showing {offset + 1}–{Math.min(offset + limit, total)} of {total}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={offset + limit >= total}
            onClick={() => setOffset(offset + limit)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
