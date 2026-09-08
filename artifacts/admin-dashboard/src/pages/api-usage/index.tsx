import React, { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Car,
  CheckCircle2,
  Clock,
  Gauge,
  KeyRound,
  Radio,
  Search,
  Users,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";
import { useListApiClients } from "@workspace/api-client-react";
import { PageEnter, PageHeader, StatTile, Surface } from "@/components/page";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

async function fetchOverview(params: URLSearchParams) {
  const res = await fetch(`/api/admin/api-usage/overview?${params}`, { credentials: "include" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

const volumeConfig = {
  total: { label: "All requests", color: "hsl(217 91% 53%)" },
  ok: { label: "2xx success", color: "hsl(142 55% 42%)" },
  errors: { label: "4xx/5xx", color: "hsl(0 72% 51%)" },
  vin: { label: "VIN retrieve", color: "hsl(173 58% 39%)" },
  check: { label: "VIN check", color: "hsl(199 89% 48%)" },
  live: { label: "Live", color: "hsl(262 52% 55%)" },
} satisfies ChartConfig;

const latencyConfig = {
  avgDurationMs: { label: "Avg ms", color: "hsl(217 91% 53%)" },
  p95DurationMs: { label: "p95 ms", color: "hsl(0 72% 51%)" },
} satisfies ChartConfig;

const mixConfig = {
  vin: { label: "VIN retrieve", color: "hsl(173 58% 39%)" },
  check: { label: "VIN check", color: "hsl(199 89% 48%)" },
  live: { label: "Live", color: "hsl(262 52% 55%)" },
} satisfies ChartConfig;

const STATUS_COLORS = [
  "hsl(142 55% 42%)",
  "hsl(217 91% 53%)",
  "hsl(38 92% 50%)",
  "hsl(0 72% 51%)",
  "hsl(262 52% 55%)",
  "hsl(199 89% 48%)",
];

const DAY_OPTIONS = [1, 2, 7, 14, 30, 60, 90] as const;

function statusBadge(code: number) {
  if (code >= 500) return "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300";
  if (code >= 400) return "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200";
  return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200";
}

function fmtWhen(value: string | Date | null | undefined) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function fmtBucket(bucket: string, granularity: string) {
  if (!bucket) return "";
  if (granularity === "hour") {
    const d = new Date(bucket);
    if (Number.isNaN(d.getTime())) return bucket.slice(11, 16);
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit" });
  }
  return String(bucket).slice(5);
}

function syncUrl(next: Record<string, string>) {
  const url = new URL(window.location.href);
  for (const [k, v] of Object.entries(next)) {
    if (!v || v === "all") url.searchParams.delete(k);
    else url.searchParams.set(k, v);
  }
  window.history.replaceState({}, "", url.toString());
}

export default function ApiUsage() {
  const searchParams = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const [days, setDays] = useState(Number(searchParams.get("days")) || 7);
  const [clientId, setClientId] = useState(searchParams.get("clientId") || "");
  const [pathClass, setPathClass] = useState(searchParams.get("pathClass") || "all");
  const [statusClass, setStatusClass] = useState(searchParams.get("statusClass") || "all");
  const [vin, setVin] = useState(searchParams.get("vin") || "");
  const [vinDraft, setVinDraft] = useState(searchParams.get("vin") || "");
  const [sort, setSort] = useState(searchParams.get("sort") || "week");
  const [showSeries, setShowSeries] = useState({
    total: true,
    ok: true,
    errors: true,
    vin: true,
    check: false,
    live: false,
  });

  const { data: clients } = useListApiClients();

  useEffect(() => {
    syncUrl({
      days: String(days),
      clientId,
      pathClass,
      statusClass,
      vin,
      sort,
    });
  }, [days, clientId, pathClass, statusClass, vin, sort]);

  const params = useMemo(() => {
    const p = new URLSearchParams({ days: String(days), sort });
    if (clientId) p.set("clientId", clientId);
    if (pathClass !== "all") p.set("pathClass", pathClass);
    if (statusClass !== "all") p.set("statusClass", statusClass);
    if (vin.trim()) p.set("vin", vin.trim().toUpperCase());
    return p;
  }, [days, clientId, pathClass, statusClass, vin, sort]);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["admin-api-usage", params.toString()],
    queryFn: () => fetchOverview(params),
    refetchInterval: 45_000,
  });

  const summary = data?.summary ?? {};
  const granularity = data?.granularity ?? (days <= 2 ? "hour" : "day");
  const series = data?.series ?? [];
  const statusPie = (data?.status ?? []).map((s: { statusCode: number; count: number }) => ({
    name: String(s.statusCode),
    value: s.count,
  }));
  const byClient = data?.byClient ?? [];
  const topVins = data?.topVins ?? [];
  const topPaths = data?.topPaths ?? [];
  const tokens = data?.tokens ?? { total: 0, active: 0, usedWeek: 0 };
  const recentLogs = data?.recentLogs ?? [];

  const successRate =
    summary.successRate != null
      ? summary.successRate
      : summary.rangeTotal > 0
        ? Math.round((summary.rangeOk / summary.rangeTotal) * 100)
        : summary.week > 0
          ? Math.round(((summary.okWeek ?? 0) / summary.week) * 100)
          : null;

  const logsHref = useMemo(() => {
    const p = new URLSearchParams();
    if (clientId) p.set("clientId", clientId);
    if (pathClass !== "all") p.set("pathClass", pathClass);
    if (statusClass !== "all") p.set("statusClass", statusClass);
    if (vin.trim()) p.set("vin", vin.trim().toUpperCase());
    p.set("days", String(days));
    const q = p.toString();
    return q ? `/api-logs?${q}` : "/api-logs";
  }, [clientId, pathClass, statusClass, vin, days]);

  return (
    <PageEnter>
      <PageHeader
        title="API usage"
        description="Traffic, latency, and errors — hourly for 1–2 day windows, daily otherwise."
        actions={
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? "Refreshing…" : "Refresh"}
          </Button>
        }
      />

      <Surface className="p-3 sm:p-4 flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          {DAY_OPTIONS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              className={cn(
                "h-8 px-3 rounded-md text-xs font-medium border transition-colors",
                days === d
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background border-input text-muted-foreground hover:text-foreground",
              )}
            >
              {d === 1 ? "1 day" : d === 2 ? "2 days" : `${d}d`}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <select
            className="h-9 rounded-md border border-input bg-background px-3 text-sm min-w-[160px]"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
          >
            <option value="">All clients</option>
            {clients?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={pathClass}
            onChange={(e) => setPathClass(e.target.value)}
          >
            <option value="all">All paths</option>
            <option value="vin">VIN retrieve</option>
            <option value="check">VIN check</option>
            <option value="live">Live feed</option>
          </select>
          <select
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={statusClass}
            onChange={(e) => setStatusClass(e.target.value)}
          >
            <option value="all">All statuses</option>
            <option value="2xx">2xx success</option>
            <option value="4xx">4xx</option>
            <option value="5xx">5xx</option>
            <option value="errors">Errors (4xx+5xx)</option>
          </select>
          <form
            className="flex gap-2 flex-1 min-w-[180px]"
            onSubmit={(e) => {
              e.preventDefault();
              setVin(vinDraft.trim().toUpperCase());
            }}
          >
            <Input
              value={vinDraft}
              onChange={(e) => setVinDraft(e.target.value)}
              placeholder="Filter VIN…"
              className="h-9 font-mono text-xs"
            />
            <Button type="submit" size="sm" variant="secondary" className="h-9">
              Apply
            </Button>
            {vin ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-9"
                onClick={() => {
                  setVin("");
                  setVinDraft("");
                }}
              >
                Clear
              </Button>
            ) : null}
          </form>
          <span className="text-[11px] text-muted-foreground ml-auto">
            {granularity === "hour" ? "Hourly buckets (UTC)" : "Daily buckets (UTC)"}
          </span>
        </div>
      </Surface>

      {isError ? (
        <Surface className="p-6 text-destructive text-sm">{(error as Error)?.message || "Failed to load usage"}</Surface>
      ) : isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-28 rounded-2xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-2 sm:gap-3">
            <StatTile label="In range" value={summary.rangeTotal ?? 0} icon={Activity} accent hint={`${days}d window`} />
            <StatTile label="Today" value={summary.today ?? 0} icon={Clock} />
            <StatTile
              label="Success rate"
              value={successRate != null ? `${successRate}%` : "—"}
              icon={CheckCircle2}
              hint={`${summary.rangeOk ?? 0} ok / ${summary.rangeTotal ?? 0}`}
            />
            <StatTile label="Errors (range)" value={summary.rangeErrors ?? 0} icon={AlertTriangle} />
            <StatTile label="Avg latency" value={`${summary.avgDurationMs ?? 0} ms`} icon={Gauge} hint={`p95 ${summary.p95DurationMs ?? 0} ms`} />
            <StatTile label="Unique VINs" value={summary.uniqueVins ?? 0} icon={Search} />
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
            <StatTile label="Active clients" value={summary.activeClients ?? 0} icon={Users} hint={`${summary.totalClients ?? 0} total`} />
            <StatTile label="Clients w/ traffic" value={summary.uniqueClients ?? 0} icon={Users} />
            <StatTile label="Active tokens" value={tokens.active ?? 0} icon={KeyRound} hint={`${tokens.total ?? 0} issued`} />
            <StatTile label="VIN / check / live" value={`${summary.rangeVin ?? 0} / ${summary.rangeCheck ?? 0} / ${summary.rangeLive ?? 0}`} icon={Car} />
          </div>

          {(() => {
            const vr = data?.vinRetrieve as
              | {
                  total: number;
                  success: number;
                  fail: number;
                  successRate: number | null;
                  reasons: Array<{ statusCode: number; count: number; reason: string }>;
                }
              | undefined;
            if (!vr) return null;
            return (
              <Surface className="p-3 sm:p-4">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <div>
                    <h2 className="text-sm font-semibold">VIN retrieve outcomes</h2>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Priority view · success vs fail reasons in the selected window
                    </p>
                  </div>
                  <span className="text-xs font-mono text-muted-foreground">
                    {vr.successRate != null ? `${vr.successRate}% ok` : "—"}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-lg border border-border bg-muted/20 px-2.5 py-2">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Total</div>
                    <div className="text-lg font-bold font-mono tabular-nums">{vr.total.toLocaleString()}</div>
                  </div>
                  <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-2.5 py-2">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">Success</div>
                    <div className="text-lg font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-300">
                      {vr.success.toLocaleString()}
                    </div>
                  </div>
                  <div className="rounded-lg border border-red-500/25 bg-red-500/5 px-2.5 py-2">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-red-700 dark:text-red-400">Failed</div>
                    <div className="text-lg font-bold font-mono tabular-nums text-red-700 dark:text-red-300">
                      {vr.fail.toLocaleString()}
                    </div>
                  </div>
                </div>
                {vr.reasons.length > 0 ? (
                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
                    {vr.reasons.map((r) => (
                      <div
                        key={r.statusCode}
                        className="flex items-center justify-between gap-2 rounded-md border border-border/70 px-2.5 py-1.5 text-xs"
                      >
                        <span className="truncate">
                          <span className="font-mono text-muted-foreground">{r.statusCode}</span>
                          <span className="mx-1 text-muted-foreground/50">·</span>
                          {r.reason}
                        </span>
                        <span className="font-mono tabular-nums shrink-0">{r.count.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">No failed VIN retrieves in this window.</p>
                )}
              </Surface>
            );
          })()}

          <div className="grid lg:grid-cols-3 gap-3 sm:gap-4">
            <Surface className="lg:col-span-2 p-3 sm:p-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
                <div>
                  <h2 className="font-semibold text-sm sm:text-base">Request volume</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {granularity === "hour" ? "Per hour" : "Per day"} · toggle series
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(Object.keys(showSeries) as (keyof typeof showSeries)[]).map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setShowSeries((s) => ({ ...s, [key]: !s[key] }))}
                      className={cn(
                        "h-7 px-2 rounded text-[10px] font-semibold border",
                        showSeries[key]
                          ? "bg-primary/10 border-primary/40 text-foreground"
                          : "bg-muted/40 border-transparent text-muted-foreground",
                      )}
                    >
                      {volumeConfig[key].label}
                    </button>
                  ))}
                </div>
              </div>
              <ChartContainer config={volumeConfig} className="h-[280px] w-full">
                <AreaChart data={series} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border/50" />
                  <XAxis
                    dataKey="bucket"
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => fmtBucket(String(v), granularity)}
                    minTickGap={granularity === "hour" ? 16 : 24}
                    tick={{ fontSize: 10 }}
                  />
                  <YAxis tickLine={false} axisLine={false} width={36} tick={{ fontSize: 11 }} />
                  <ChartTooltip
                    content={<ChartTooltipContent labelFormatter={(v) => fmtBucket(String(v), granularity)} />}
                  />
                  {showSeries.total ? (
                    <Area type="monotone" dataKey="total" stroke="var(--color-total)" fill="var(--color-total)" fillOpacity={0.12} strokeWidth={2} />
                  ) : null}
                  {showSeries.ok ? (
                    <Area type="monotone" dataKey="ok" stroke="var(--color-ok)" fill="var(--color-ok)" fillOpacity={0.1} strokeWidth={1.5} />
                  ) : null}
                  {showSeries.errors ? (
                    <Area type="monotone" dataKey="errors" stroke="var(--color-errors)" fill="var(--color-errors)" fillOpacity={0.18} strokeWidth={1.5} />
                  ) : null}
                  {showSeries.vin ? (
                    <Area type="monotone" dataKey="vin" stroke="var(--color-vin)" fill="var(--color-vin)" fillOpacity={0.08} strokeWidth={1.25} />
                  ) : null}
                  {showSeries.check ? (
                    <Area type="monotone" dataKey="check" stroke="var(--color-check)" fill="var(--color-check)" fillOpacity={0.08} strokeWidth={1.25} />
                  ) : null}
                  {showSeries.live ? (
                    <Area type="monotone" dataKey="live" stroke="var(--color-live)" fill="var(--color-live)" fillOpacity={0.08} strokeWidth={1.25} />
                  ) : null}
                </AreaChart>
              </ChartContainer>
            </Surface>

            <Surface className="p-4 sm:p-5">
              <h2 className="font-semibold mb-1">Status codes</h2>
              <p className="text-xs text-muted-foreground mb-3">Selected filters · {days}d</p>
              {statusPie.length === 0 ? (
                <p className="text-sm text-muted-foreground py-12 text-center">No traffic yet</p>
              ) : (
                <ChartContainer config={{ count: { label: "Requests", color: "hsl(217 91% 53%)" } }} className="mx-auto h-[220px] w-full max-w-[240px]">
                  <PieChart>
                    <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                    <Pie data={statusPie} dataKey="value" nameKey="name" innerRadius={52} outerRadius={78} paddingAngle={2}>
                      {statusPie.map((_, i) => (
                        <Cell key={i} fill={STATUS_COLORS[i % STATUS_COLORS.length]} />
                      ))}
                    </Pie>
                  </PieChart>
                </ChartContainer>
              )}
              <div className="flex flex-wrap gap-2 mt-2 justify-center">
                {statusPie.slice(0, 6).map((s: { name: string; value: number }, i: number) => (
                  <span key={s.name} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span className="w-2 h-2 rounded-full" style={{ background: STATUS_COLORS[i % STATUS_COLORS.length] }} />
                    {s.name} · {s.value}
                  </span>
                ))}
              </div>
            </Surface>
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <Surface className="p-4 sm:p-5">
              <h2 className="font-semibold mb-1">Latency</h2>
              <p className="text-xs text-muted-foreground mb-3">Average and p95 duration (ms)</p>
              <ChartContainer config={latencyConfig} className="h-[240px] w-full">
                <LineChart data={series} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border/50" />
                  <XAxis
                    dataKey="bucket"
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => fmtBucket(String(v), granularity)}
                    minTickGap={20}
                    tick={{ fontSize: 10 }}
                  />
                  <YAxis tickLine={false} axisLine={false} width={40} tick={{ fontSize: 11 }} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Line type="monotone" dataKey="avgDurationMs" stroke="var(--color-avgDurationMs)" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="p95DurationMs" stroke="var(--color-p95DurationMs)" strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
                </LineChart>
              </ChartContainer>
            </Surface>

            <Surface className="p-4 sm:p-5">
              <h2 className="font-semibold mb-1">Endpoint mix</h2>
              <p className="text-xs text-muted-foreground mb-3">VIN retrieve · check · live</p>
              <ChartContainer config={mixConfig} className="h-[240px] w-full">
                <BarChart data={series} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border/50" />
                  <XAxis
                    dataKey="bucket"
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => fmtBucket(String(v), granularity)}
                    minTickGap={20}
                    tick={{ fontSize: 10 }}
                  />
                  <YAxis tickLine={false} axisLine={false} width={32} tick={{ fontSize: 11 }} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="vin" stackId="m" fill="var(--color-vin)" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="check" stackId="m" fill="var(--color-check)" />
                  <Bar dataKey="live" stackId="m" fill="var(--color-live)" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ChartContainer>
            </Surface>
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <Surface className="p-4 sm:p-5 overflow-hidden">
              <h2 className="font-semibold mb-3">Top endpoints</h2>
              <ChartContainer config={{ requests: { label: "Requests", color: "hsl(217 91% 53%)" } }} className="h-[220px] w-full">
                <BarChart data={topPaths} layout="vertical" margin={{ left: 4, right: 12, top: 0, bottom: 0 }}>
                  <CartesianGrid horizontal={false} strokeDasharray="3 3" className="stroke-border/50" />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="path" width={140} tick={{ fontSize: 10 }} tickFormatter={(v) => (String(v).length > 22 ? `…${String(v).slice(-21)}` : v)} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="requests" fill="var(--color-requests)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ChartContainer>
            </Surface>

            <Surface className="p-0 overflow-hidden">
              <div className="px-4 sm:px-5 py-4 border-b border-border">
                <h2 className="font-semibold">Top VINs</h2>
                <p className="text-xs text-muted-foreground">Most requested in filtered window</p>
              </div>
              <div className="overflow-x-auto max-h-[280px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-xs uppercase text-muted-foreground sticky top-0">
                    <tr>
                      <th className="px-4 py-2 text-left font-semibold">VIN</th>
                      <th className="px-4 py-2 text-left font-semibold">Client</th>
                      <th className="px-4 py-2 text-right font-semibold">Calls</th>
                      <th className="px-4 py-2 text-right font-semibold">Err</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border font-mono text-xs">
                    {topVins.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground font-sans">
                          No VIN traffic in this window
                        </td>
                      </tr>
                    ) : (
                      topVins.map((row: { vin: string; clientName: string | null; requests: number; errors: number }) => (
                        <tr key={`${row.vin}-${row.clientName}`} className="hover:bg-muted/20">
                          <td className="px-4 py-2">{row.vin}</td>
                          <td className="px-4 py-2 font-sans text-muted-foreground">{row.clientName || "—"}</td>
                          <td className="px-4 py-2 text-right">{row.requests}</td>
                          <td className="px-4 py-2 text-right text-amber-600">{row.errors || "—"}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Surface>
          </div>

          <Surface className="p-0 overflow-hidden">
            <div className="px-4 sm:px-5 py-4 border-b border-border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h2 className="font-semibold">Clients</h2>
                <p className="text-xs text-muted-foreground">Per-user ranking · open for individual graphs</p>
              </div>
              <select
                className="h-9 rounded-md border border-input bg-background px-3 text-sm w-full sm:w-auto"
                value={sort}
                onChange={(e) => setSort(e.target.value)}
              >
                <option value="week">Sort: 7-day requests</option>
                <option value="range">Sort: selected range</option>
                <option value="today">Sort: today</option>
                <option value="month">Sort: 30-day requests</option>
                <option value="errors">Sort: 7-day errors</option>
                <option value="allTime">Sort: all-time</option>
              </select>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase text-muted-foreground border-b border-border">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold">Client</th>
                    <th className="px-4 py-3 text-right font-semibold">Today</th>
                    <th className="px-4 py-3 text-right font-semibold">7d</th>
                    <th className="px-4 py-3 text-right font-semibold">Range</th>
                    <th className="px-4 py-3 text-right font-semibold">VIN 7d</th>
                    <th className="px-4 py-3 text-right font-semibold">Err 7d</th>
                    <th className="px-4 py-3 text-right font-semibold">Credits</th>
                    <th className="px-4 py-3 text-left font-semibold">Last call</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {byClient.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-10 text-center text-muted-foreground">
                        No clients match this filter
                      </td>
                    </tr>
                  ) : (
                    byClient.map(
                      (row: {
                        clientId: number;
                        clientName: string;
                        isActive: boolean;
                        today: number;
                        week: number;
                        rangeTotal: number;
                        vinWeek: number;
                        errorsWeek: number;
                        creditBalance: number;
                        lastRequestAt: string | null;
                      }) => (
                        <tr key={row.clientId} className="hover:bg-muted/20">
                          <td className="px-4 py-3">
                            <div className="font-medium">{row.clientName}</div>
                            <div className="text-[11px] text-muted-foreground flex gap-2 mt-0.5">
                              {!row.isActive && <span className="text-amber-600">Inactive</span>}
                              <span>#{row.clientId}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">{row.today}</td>
                          <td className="px-4 py-3 text-right tabular-nums font-medium">{row.week}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{row.rangeTotal ?? 0}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{row.vinWeek}</td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            <span className={cn(row.errorsWeek > 0 && "text-amber-600 font-medium")}>{row.errorsWeek}</span>
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">{row.creditBalance}</td>
                          <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{fmtWhen(row.lastRequestAt)}</td>
                          <td className="px-4 py-3 text-right">
                            <Button variant="ghost" size="sm" asChild className="h-8 gap-1">
                              <Link href={`/api-clients/${row.clientId}?days=${days}`}>
                                Graphs <ArrowUpRight className="w-3.5 h-3.5" />
                              </Link>
                            </Button>
                          </td>
                        </tr>
                      ),
                    )
                  )}
                </tbody>
              </table>
            </div>
          </Surface>

          <Surface className="p-0 overflow-hidden">
            <div className="px-4 sm:px-5 py-4 border-b border-border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h2 className="font-semibold">Recent requests</h2>
                <p className="text-xs text-muted-foreground">Matching current filters</p>
              </div>
              <Button variant="outline" size="sm" asChild className="h-8">
                <Link href={logsHref}>Full log</Link>
              </Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase text-muted-foreground border-b border-border">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold">Time</th>
                    <th className="px-4 py-3 text-left font-semibold">Status</th>
                    <th className="px-4 py-3 text-left font-semibold">Method</th>
                    <th className="px-4 py-3 text-left font-semibold">Path</th>
                    <th className="px-4 py-3 text-left font-semibold">VIN</th>
                    <th className="px-4 py-3 text-left font-semibold">Client</th>
                    <th className="px-4 py-3 text-right font-semibold">ms</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border font-mono text-xs">
                  {recentLogs.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground font-sans">
                        No matching requests
                      </td>
                    </tr>
                  ) : (
                    recentLogs.map(
                      (log: {
                        id: number;
                        requestedAt: string;
                        statusCode: number;
                        method: string;
                        path: string;
                        vin: string | null;
                        clientName: string | null;
                        durationMs: number;
                      }) => (
                        <tr key={log.id} className="hover:bg-muted/20">
                          <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">{fmtWhen(log.requestedAt)}</td>
                          <td className="px-4 py-2">
                            <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-bold", statusBadge(log.statusCode))}>
                              {log.statusCode}
                            </span>
                          </td>
                          <td className="px-4 py-2">{log.method}</td>
                          <td className="px-4 py-2 max-w-[240px] truncate" title={log.path}>
                            {log.path}
                          </td>
                          <td className="px-4 py-2">{log.vin || "—"}</td>
                          <td className="px-4 py-2 font-sans text-muted-foreground">{log.clientName || "—"}</td>
                          <td className="px-4 py-2 text-right text-muted-foreground">{log.durationMs}</td>
                        </tr>
                      ),
                    )
                  )}
                </tbody>
              </table>
            </div>
          </Surface>

          <div className="grid sm:grid-cols-3 gap-3 text-sm">
            <Surface className="p-4 flex items-center gap-3">
              <Radio className="w-4 h-4 text-muted-foreground shrink-0" />
              <div>
                <div className="font-medium">Live (range)</div>
                <div className="text-muted-foreground text-xs">{summary.rangeLive ?? 0} calls</div>
              </div>
            </Surface>
            <Surface className="p-4 flex items-center gap-3">
              <Search className="w-4 h-4 text-muted-foreground shrink-0" />
              <div>
                <div className="font-medium">VIN checks (range)</div>
                <div className="text-muted-foreground text-xs">{summary.rangeCheck ?? 0} free check calls</div>
              </div>
            </Surface>
            <Surface className="p-4 flex items-center gap-3">
              <Clock className="w-4 h-4 text-muted-foreground shrink-0" />
              <div>
                <div className="font-medium">p95 latency</div>
                <div className="text-muted-foreground text-xs">{summary.p95DurationMs ?? 0} ms over selected window</div>
              </div>
            </Surface>
          </div>
        </>
      )}
    </PageEnter>
  );
}
