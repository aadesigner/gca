import React, { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Car,
  CheckCircle2,
  Clock,
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
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";
import { useListApiClients } from "@workspace/api-client-react";
import { PageEnter, PageHeader, StatTile, Surface } from "@/components/page";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Button } from "@/components/ui/button";
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
} satisfies ChartConfig;

const STATUS_COLORS = [
  "hsl(142 55% 42%)",
  "hsl(217 91% 53%)",
  "hsl(38 92% 50%)",
  "hsl(0 72% 51%)",
  "hsl(262 52% 55%)",
  "hsl(199 89% 48%)",
];

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

export default function ApiUsage() {
  const searchParams = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const [days, setDays] = useState(30);
  const [clientId, setClientId] = useState(searchParams.get("clientId") || "");
  const [sort, setSort] = useState("week");
  const [logFilter, setLogFilter] = useState<"all" | "errors" | "vin">("all");

  const { data: clients } = useListApiClients();

  const params = useMemo(() => {
    const p = new URLSearchParams({ days: String(days), sort });
    if (clientId) p.set("clientId", clientId);
    return p;
  }, [days, clientId, sort]);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["admin-api-usage", days, clientId, sort],
    queryFn: () => fetchOverview(params),
    refetchInterval: 60_000,
  });

  const summary = data?.summary ?? {};
  const series = data?.series ?? [];
  const statusPie = (data?.status ?? []).map((s: { statusCode: number; count: number }) => ({
    name: String(s.statusCode),
    value: s.count,
  }));
  const byClient = data?.byClient ?? [];
  const topVins = data?.topVins ?? [];
  const topPaths = data?.topPaths ?? [];
  const tokens = data?.tokens ?? { total: 0, active: 0, usedWeek: 0 };
  const recentLogs = (data?.recentLogs ?? []).filter((log: { statusCode: number; path: string }) => {
    if (logFilter === "errors") return log.statusCode >= 400;
    if (logFilter === "vin") return log.path.includes("/v1/vin/") && !log.path.includes("/check/");
    return true;
  });

  const successRate =
    summary.week > 0 ? Math.round(((summary.okWeek ?? 0) / summary.week) * 100) : null;

  return (
    <PageEnter>
      <PageHeader
        title="API usage"
        description="Monitor all client traffic — requests, tokens, VIN lookups, successes and failures."
        actions={
          <>
            <select
              className="h-10 rounded-md border border-input bg-background px-3 text-sm min-w-[140px]"
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
            >
              {[7, 14, 30, 60, 90].map((d) => (
                <option key={d} value={d}>
                  Last {d} days
                </option>
              ))}
            </select>
            <select
              className="h-10 rounded-md border border-input bg-background px-3 text-sm min-w-[180px]"
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
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              {isFetching ? "Refreshing…" : "Refresh"}
            </Button>
          </>
        }
      />

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
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
            <StatTile label="Today" value={summary.today ?? 0} icon={Activity} accent />
            <StatTile label="7 days" value={summary.week ?? 0} icon={Clock} hint="All API calls" />
            <StatTile
              label="Success rate"
              value={successRate != null ? `${successRate}%` : "—"}
              icon={CheckCircle2}
              hint={`${summary.okWeek ?? 0} ok / ${summary.week ?? 0} total`}
            />
            <StatTile
              label="Errors (7d)"
              value={summary.errorsWeek ?? 0}
              icon={AlertTriangle}
              hint="HTTP 4xx and 5xx"
            />
            <StatTile label="VIN retrieves (7d)" value={summary.vinWeek ?? 0} icon={Car} />
            <StatTile
              label="Unique VINs"
              value={summary.uniqueVins ?? 0}
              icon={Search}
              hint={`In last ${days} days`}
            />
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile label="Active clients" value={summary.activeClients ?? 0} icon={Users} hint={`${summary.totalClients ?? 0} total`} />
            <StatTile label="Clients with traffic" value={summary.uniqueClients ?? 0} icon={Users} hint={`Last ${days} days`} />
            <StatTile label="Active tokens" value={tokens.active ?? 0} icon={KeyRound} hint={`${tokens.total ?? 0} issued`} />
            <StatTile label="Tokens used (7d)" value={tokens.usedWeek ?? 0} icon={KeyRound} hint="Had lastUsedAt this week" />
          </div>

          <div className="grid lg:grid-cols-3 gap-4">
            <Surface className="lg:col-span-2 p-4 sm:p-5">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div>
                  <h2 className="font-semibold">Request volume</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">Daily breakdown by outcome</p>
                </div>
              </div>
              <ChartContainer config={volumeConfig} className="h-[260px] w-full">
                <AreaChart data={series} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border/50" />
                  <XAxis
                    dataKey="day"
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => String(v).slice(5)}
                    minTickGap={24}
                    tick={{ fontSize: 11 }}
                  />
                  <YAxis tickLine={false} axisLine={false} width={32} tick={{ fontSize: 11 }} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Area type="monotone" dataKey="total" stackId="a" stroke="var(--color-total)" fill="var(--color-total)" fillOpacity={0.15} strokeWidth={2} />
                  <Area type="monotone" dataKey="ok" stackId="b" stroke="var(--color-ok)" fill="var(--color-ok)" fillOpacity={0.12} strokeWidth={1.5} />
                  <Area type="monotone" dataKey="errors" stroke="var(--color-errors)" fill="var(--color-errors)" fillOpacity={0.2} strokeWidth={1.5} />
                </AreaChart>
              </ChartContainer>
            </Surface>

            <Surface className="p-4 sm:p-5">
              <h2 className="font-semibold mb-1">Status codes</h2>
              <p className="text-xs text-muted-foreground mb-3">Last {days} days</p>
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
                {statusPie.slice(0, 6).map((s, i) => (
                  <span key={s.name} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span className="w-2 h-2 rounded-full" style={{ background: STATUS_COLORS[i % STATUS_COLORS.length] }} />
                    {s.name} · {s.value}
                  </span>
                ))}
              </div>
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
              <div className="px-4 sm:px-5 py-4 border-b border-border flex items-center justify-between">
                <div>
                  <h2 className="font-semibold">Top VINs</h2>
                  <p className="text-xs text-muted-foreground">Most requested in period</p>
                </div>
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
                        <tr key={row.vin} className="hover:bg-muted/20">
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
                <p className="text-xs text-muted-foreground">Sorted by {sort === "errors" ? "errors" : sort === "month" ? "30-day volume" : "7-day volume"}</p>
              </div>
              <select
                className="h-9 rounded-md border border-input bg-background px-3 text-sm w-full sm:w-auto"
                value={sort}
                onChange={(e) => setSort(e.target.value)}
              >
                <option value="week">Sort: 7-day requests</option>
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
                    <th className="px-4 py-3 text-right font-semibold">VIN 7d</th>
                    <th className="px-4 py-3 text-right font-semibold">Err 7d</th>
                    <th className="px-4 py-3 text-right font-semibold">Credits</th>
                    <th className="px-4 py-3 text-right font-semibold">Tokens</th>
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
                        vinWeek: number;
                        errorsWeek: number;
                        creditBalance: number;
                        activeTokens: number;
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
                          <td className="px-4 py-3 text-right tabular-nums">{row.vinWeek}</td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            <span className={cn(row.errorsWeek > 0 && "text-amber-600 font-medium")}>{row.errorsWeek}</span>
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">{row.creditBalance}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{row.activeTokens}</td>
                          <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{fmtWhen(row.lastRequestAt)}</td>
                          <td className="px-4 py-3 text-right">
                            <Button variant="ghost" size="sm" asChild className="h-8 gap-1">
                              <Link href={`/api-clients/${row.clientId}`}>
                                Open <ArrowUpRight className="w-3.5 h-3.5" />
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
                <p className="text-xs text-muted-foreground">Latest 60 calls {clientId ? "for selected client" : "across all clients"}</p>
              </div>
              <div className="flex gap-2">
                {(["all", "errors", "vin"] as const).map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setLogFilter(key)}
                    className={cn(
                      "h-8 px-3 rounded-md text-xs font-medium border transition-colors",
                      logFilter === key
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background border-input text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {key === "all" ? "All" : key === "errors" ? "Errors" : "VIN retrieve"}
                  </button>
                ))}
                <Button variant="outline" size="sm" asChild className="h-8">
                  <Link href={clientId ? `/api-logs?clientId=${clientId}` : "/api-logs"}>Full log</Link>
                </Button>
              </div>
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
                <div className="font-medium">Live feed (7d)</div>
                <div className="text-muted-foreground text-xs">{summary.liveWeek ?? 0} calls · live routes may be unlogged until enabled</div>
              </div>
            </Surface>
            <Surface className="p-4 flex items-center gap-3">
              <Search className="w-4 h-4 text-muted-foreground shrink-0" />
              <div>
                <div className="font-medium">VIN checks (7d)</div>
                <div className="text-muted-foreground text-xs">{summary.checkWeek ?? 0} free check calls</div>
              </div>
            </Surface>
            <Surface className="p-4 flex items-center gap-3">
              <Clock className="w-4 h-4 text-muted-foreground shrink-0" />
              <div>
                <div className="font-medium">Avg latency</div>
                <div className="text-muted-foreground text-xs">{summary.avgDurationMs ?? 0} ms over last {days} days</div>
              </div>
            </Surface>
          </div>
        </>
      )}
    </PageEnter>
  );
}
