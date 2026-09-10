import React, { useState } from "react";
import { Link, useRoute, useLocation } from "wouter";
import {
  useGetApiClient,
  useUpdateApiClient,
  useListApiTokens,
  getListApiClientsQueryKey,
  getGetApiClientQueryKey,
} from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  KeyRound,
  Trash2,
  Power,
  PowerOff,
  Activity,
  CreditCard,
  Radio,
  LifeBuoy,
  Wallet,
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { cn } from "@/lib/utils";
import { ClientPortalLinks } from "@/components/client-portal-links";
import { DeleteClientDialog } from "@/components/delete-client-dialog";

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

function formatClientWhen(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtBucket(bucket: string, granularity: string) {
  if (!bucket) return "";
  if (granularity === "hour") {
    const d = new Date(bucket);
    if (Number.isNaN(d.getTime())) return String(bucket).slice(11, 16);
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit" });
  }
  return String(bucket).slice(5);
}

const volumeConfig = {
  total: { label: "Requests", color: "hsl(217 91% 53%)" },
  errors: { label: "Errors", color: "hsl(0 72% 51%)" },
  ok: { label: "2xx", color: "hsl(142 55% 42%)" },
  vin: { label: "VIN retrieve", color: "hsl(142 55% 42%)" },
  check: { label: "VIN check", color: "hsl(199 89% 48%)" },
  live: { label: "Live", color: "hsl(173 58% 39%)" },
} satisfies ChartConfig;

const latencyConfig = {
  avgDurationMs: { label: "Avg ms", color: "hsl(217 91% 53%)" },
  p95DurationMs: { label: "p95 ms", color: "hsl(0 72% 51%)" },
} satisfies ChartConfig;

const STATUS_COLORS = ["hsl(217 91% 53%)", "hsl(142 55% 42%)", "hsl(38 92% 50%)", "hsl(0 72% 51%)", "hsl(262 52% 55%)", "hsl(199 89% 48%)"];

const DAY_OPTIONS = [1, 2, 7, 14, 30, 60, 90] as const;

export default function ApiClientDetail() {
  const [, params] = useRoute("/api-clients/:id");
  const id = Number(params?.id);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const initialDays = Number(new URLSearchParams(window.location.search).get("days")) || 7;
  const [days, setDays] = useState(DAY_OPTIONS.includes(initialDays as any) ? initialDays : 7);
  const [pathClass, setPathClass] = useState("all");
  const [statusClass, setStatusClass] = useState("all");
  const [tokenId, setTokenId] = useState("");

  const { data: client, isLoading, isError, error } = useGetApiClient(id, {
    query: { enabled: Number.isFinite(id) && id > 0 },
  });

  const usageParams = React.useMemo(() => {
    const p = new URLSearchParams({ days: String(days) });
    if (pathClass !== "all") p.set("pathClass", pathClass);
    if (statusClass !== "all") p.set("statusClass", statusClass);
    if (tokenId) p.set("tokenId", tokenId);
    return p;
  }, [days, pathClass, statusClass, tokenId]);

  const { data: usage, isLoading: usageLoading } = useQuery({
    queryKey: ["api-client-usage", id, usageParams.toString()],
    queryFn: () => api(`/admin/api-clients/${id}/usage?${usageParams}`),
    enabled: Number.isFinite(id) && id > 0,
    staleTime: 45_000,
  });

  const {
    data: clientTokens,
    isLoading: tokensLoading,
    isError: tokensError,
    error: tokensLoadError,
    refetch: refetchTokens,
  } = useListApiTokens(
    { clientId: id },
    { query: { enabled: Number.isFinite(id) && id > 0 } },
  );

  const updateMutation = useUpdateApiClient();
  const [deleteOpen, setDeleteOpen] = React.useState(false);

  const [form, setForm] = useState<Record<string, any> | null>(null);
  React.useEffect(() => {
    if (!client) return;
    setForm({
      name: client.name || "",
      description: (client as any).description || "",
      email: (client as any).email || "",
      companyName: (client as any).companyName || "",
      telegramUsername: (client as any).telegramUsername || "",
      websiteUrl: (client as any).websiteUrl || "",
      password: "",
      rateLimitPerMinute: client.rateLimitPerMinute ?? 60,
      rateLimitPerDay: client.rateLimitPerDay ?? 10000,
      requestsPerVin: (client as any).requestsPerVin ?? "",
      monthlyGlobalLimit: (client as any).monthlyGlobalLimit ?? "",
      creditBalance: (client as any).creditBalance ?? 0,
      liveFeedEnabled: Boolean((client as any).liveFeedEnabled),
      liveFeedDays: "",
      liveFeedExpiresAt: (client as any).liveFeedExpiresAt
        ? new Date((client as any).liveFeedExpiresAt).toISOString().slice(0, 16)
        : "",
      isActive: client.isActive !== false,
    });
  }, [client]);

  if (!Number.isFinite(id) || id <= 0) {
    return <p className="text-muted-foreground">Invalid client.</p>;
  }

  if (isLoading || !form) {
    return <div className="h-40 rounded-xl border border-border bg-card animate-pulse" />;
  }

  if (isError || !client) {
    return (
      <div className="space-y-3">
        <Button variant="ghost" asChild className="gap-2 px-0">
          <Link href="/api-clients"><ArrowLeft className="w-4 h-4" /> Back</Link>
        </Button>
        <p className="text-destructive">{(error as Error)?.message || "Client not found"}</p>
      </div>
    );
  }

  const summary = usage?.summary ?? { today: 0, week: 0, month: 0, allTime: 0, errorsWeek: 0, rangeTotal: 0, avgDurationMs: 0, p95DurationMs: 0, successRate: null };
  const series = usage?.series ?? [];
  const granularity = usage?.granularity ?? (days <= 2 ? "hour" : "day");
  const usageTokens = usage?.tokenList ?? [];
  const statusPie = (usage?.status ?? []).map((s: { statusCode: number; count: number }) => ({
    name: String(s.statusCode),
    value: s.count,
  }));

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (form.password && form.password.length < 6) {
      toast({ title: "Password too short", variant: "destructive" });
      return;
    }
    const payload: Record<string, unknown> = {
      name: form.name,
      description: form.description,
      email: form.email,
      companyName: form.companyName,
      telegramUsername: form.telegramUsername,
      websiteUrl: form.websiteUrl,
      password: form.password || undefined,
      rateLimitPerMinute: form.rateLimitPerMinute,
      rateLimitPerDay: form.rateLimitPerDay,
      requestsPerVin: form.requestsPerVin === "" ? null : Number(form.requestsPerVin),
      monthlyGlobalLimit: form.monthlyGlobalLimit === "" ? null : Number(form.monthlyGlobalLimit),
      creditBalance: Math.max(0, Number(form.creditBalance) || 0),
      liveFeedEnabled: Boolean(form.liveFeedEnabled),
      isActive: Boolean(form.isActive),
    };
    if (form.liveFeedDays !== "" && form.liveFeedDays != null) {
      payload.liveFeedDays = Number(form.liveFeedDays);
    } else if (form.liveFeedExpiresAt) {
      payload.liveFeedExpiresAt = new Date(form.liveFeedExpiresAt).toISOString();
    } else {
      payload.liveFeedExpiresAt = null;
    }

    updateMutation.mutate(
      { id, data: payload as any },
      {
        onSuccess: () => {
          toast({ title: "Client saved" });
          qc.invalidateQueries({ queryKey: getGetApiClientQueryKey(id) });
          qc.invalidateQueries({ queryKey: getListApiClientsQueryKey() });
          qc.invalidateQueries({ queryKey: ["api-client-usage", id] });
          setForm((s) => (s ? { ...s, password: "" } : s));
        },
        onError: (err: any) => toast({ title: "Save failed", description: err?.message, variant: "destructive" }),
      },
    );
  };

  const toggleActive = () => {
    updateMutation.mutate(
      { id, data: { isActive: !client.isActive } as any },
      {
        onSuccess: () => {
          toast({ title: client.isActive ? "Client disabled" : "Client enabled" });
          qc.invalidateQueries({ queryKey: getGetApiClientQueryKey(id) });
          qc.invalidateQueries({ queryKey: getListApiClientsQueryKey() });
        },
      },
    );
  };

  const remove = () => setDeleteOpen(true);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <Button variant="ghost" asChild className="gap-2 px-0 h-8 text-muted-foreground">
            <Link href="/api-clients"><ArrowLeft className="w-4 h-4" /> API clients</Link>
          </Button>
          <h1 className="text-2xl font-bold tracking-tight truncate">{client.name}</h1>
          <p className="text-sm text-muted-foreground">
            {(client as any).email || "No portal email"} · {(client as any).tokenCount || 0} tokens ·{" "}
            <span className={client.isActive ? "text-emerald-600" : "text-destructive"}>
              {client.isActive ? "Active" : "Disabled"}
            </span>
          </p>
          {((client as any).telegramUsername || (client as any).websiteUrl || (client as any).companyName) && (
            <p className="text-xs text-muted-foreground">
              {(client as any).companyName ? `${(client as any).companyName} · ` : ""}
              {(client as any).telegramUsername ? `@${(client as any).telegramUsername}` : ""}
              {(client as any).telegramUsername && (client as any).websiteUrl ? " · " : ""}
              {(client as any).websiteUrl ? (
                <a href={(client as any).websiteUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                  {(client as any).websiteUrl.replace(/^https?:\/\//, "")}
                </a>
              ) : null}
            </p>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-xs text-muted-foreground">
            <span>
              <span className="font-semibold text-foreground/70">Registered</span>{" "}
              {formatClientWhen(client.createdAt as string)}
            </span>
            <span>
              <span className="font-semibold text-foreground/70">Last login</span>{" "}
              {formatClientWhen(
                (client as { lastLoginAt?: string | null }).lastLoginAt ?? null,
              )}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" className="h-9 gap-1.5 px-2.5" asChild>
            <Link href={`/support-tickets?clientId=${id}`}>
              <LifeBuoy className="w-4 h-4" />
              <span>Support</span>
            </Link>
          </Button>
          <Button variant="outline" size="sm" className="h-9 gap-1.5 px-2.5" asChild>
            <Link href={`/credit-purchases?clientId=${id}`}>
              <Wallet className="w-4 h-4" />
              <span>Credits</span>
            </Link>
          </Button>
          <Button variant="outline" size="sm" className="h-9 gap-1.5 px-2.5" asChild>
            <Link href={`/api-tokens?clientId=${id}`}>
              <KeyRound className="w-4 h-4" />
              <span>Tokens</span>
            </Link>
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9"
            onClick={toggleActive}
            title={client.isActive ? "Disable account" : "Enable account"}
            aria-label={client.isActive ? "Disable account" : "Enable account"}
          >
            {client.isActive ? <PowerOff className="w-4 h-4" /> : <Power className="w-4 h-4" />}
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9 text-destructive hover:text-destructive"
            onClick={remove}
            title="Delete account"
            aria-label="Delete account"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <ClientPortalLinks clientId={id} compact />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-2.5">
        <Kpi icon={Activity} label="In range" value={summary.rangeTotal ?? 0} />
        <Kpi icon={Activity} label="Today" value={summary.today} />
        <Kpi icon={Activity} label="7 days" value={summary.week} />
        <Kpi icon={Activity} label="30 days" value={summary.month} />
        <Kpi icon={Activity} label="All time" value={summary.allTime} />
        <Kpi icon={CreditCard} label="Credits" value={(client as any).creditBalance ?? 0} accent />
      </div>

      {(() => {
        const vr = usage?.vinRetrieve as
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
          <section className="rounded-xl border border-border bg-card p-3 sm:p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <h2 className="text-sm font-semibold">VIN retrieve outcomes</h2>
              <span className="text-[11px] text-muted-foreground">
                Selected window · {vr.successRate != null ? `${vr.successRate}% success` : "no retrieves"}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              <div className="rounded-lg border border-border bg-muted/20 px-2.5 py-2 sm:px-3">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Total</div>
                <div className="mt-0.5 text-lg sm:text-xl font-bold font-mono tabular-nums">{vr.total.toLocaleString()}</div>
              </div>
              <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-2.5 py-2 sm:px-3">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">Success</div>
                <div className="mt-0.5 text-lg sm:text-xl font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-300">
                  {vr.success.toLocaleString()}
                </div>
              </div>
              <div className="rounded-lg border border-red-500/25 bg-red-500/5 px-2.5 py-2 sm:px-3">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-red-700 dark:text-red-400">Failed</div>
                <div className="mt-0.5 text-lg sm:text-xl font-bold font-mono tabular-nums text-red-700 dark:text-red-300">
                  {vr.fail.toLocaleString()}
                </div>
              </div>
            </div>
            {vr.reasons.length > 0 ? (
              <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {vr.reasons.map((r) => (
                  <li
                    key={r.statusCode}
                    className="flex items-center justify-between gap-2 rounded-md border border-border/70 px-2.5 py-1.5 text-xs"
                  >
                    <span className="min-w-0 truncate">
                      <span className="font-mono text-muted-foreground">{r.statusCode}</span>
                      <span className="mx-1.5 text-muted-foreground/60">·</span>
                      <span className="font-medium">{r.reason}</span>
                    </span>
                    <span className="font-mono tabular-nums shrink-0">{r.count.toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">No failed VIN retrieves in this window.</p>
            )}
          </section>
        );
      })()}

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Usage</span>
        {DAY_OPTIONS.map((d) => (
          <Button
            key={d}
            size="sm"
            variant={days === d ? "default" : "outline"}
            className="h-8"
            onClick={() => setDays(d)}
          >
            {d === 1 ? "1d" : `${d}d`}
          </Button>
        ))}
        <select
          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
          value={pathClass}
          onChange={(e) => setPathClass(e.target.value)}
        >
          <option value="all">All paths</option>
          <option value="vin">VIN retrieve</option>
          <option value="check">VIN check</option>
          <option value="live">Live</option>
        </select>
        <select
          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
          value={statusClass}
          onChange={(e) => setStatusClass(e.target.value)}
        >
          <option value="all">All statuses</option>
          <option value="2xx">2xx</option>
          <option value="4xx">4xx</option>
          <option value="5xx">5xx</option>
          <option value="errors">Errors</option>
        </select>
        <select
          className="h-8 rounded-md border border-input bg-background px-2 text-xs min-w-[140px]"
          value={tokenId}
          onChange={(e) => setTokenId(e.target.value)}
        >
          <option value="">All tokens</option>
          {(Array.isArray(usageTokens) ? usageTokens : []).map((t: any) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.tokenPrefix}…)
            </option>
          ))}
        </select>
        <span className="text-[11px] text-muted-foreground ml-auto">
          {usageLoading ? "Loading…" : granularity === "hour" ? "Hourly (UTC)" : "Daily (UTC)"}
          {summary.successRate != null ? ` · ${summary.successRate}% ok` : ""}
        </span>
        <Button size="sm" variant="outline" className="h-8" asChild>
          <Link href={`/api-usage?clientId=${id}&days=${days}`}>Open in API usage</Link>
        </Button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 rounded-xl border border-border bg-card p-4 sm:p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold">Request volume</h2>
            <span className="text-xs text-muted-foreground">avg {summary.avgDurationMs ?? 0} ms · p95 {summary.p95DurationMs ?? 0} ms</span>
          </div>
          <ChartContainer config={volumeConfig} className="aspect-auto h-[180px] sm:h-[220px] w-full">
            <AreaChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="bucket" tickLine={false} axisLine={false} tickFormatter={(v) => fmtBucket(String(v), granularity)} minTickGap={20} />
              <YAxis tickLine={false} axisLine={false} width={36} allowDecimals={false} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Area type="monotone" dataKey="total" stroke="var(--color-total)" fill="var(--color-total)" fillOpacity={0.18} strokeWidth={2} />
              <Area type="monotone" dataKey="ok" stroke="var(--color-ok)" fill="transparent" strokeWidth={1.25} />
              <Area type="monotone" dataKey="errors" stroke="var(--color-errors)" fill="transparent" strokeWidth={1.5} />
            </AreaChart>
          </ChartContainer>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 sm:p-5 space-y-3">
          <h2 className="font-semibold">Status codes</h2>
          {statusPie.length === 0 ? (
            <p className="text-sm text-muted-foreground py-10 text-center">No requests in this window.</p>
          ) : (
            <ChartContainer config={{ value: { label: "Count", color: "hsl(217 91% 53%)" } }} className="aspect-auto h-[180px] sm:h-[220px] w-full">
              <PieChart>
                <ChartTooltip content={<ChartTooltipContent nameKey="name" />} />
                <Pie data={statusPie} dataKey="value" nameKey="name" innerRadius={48} outerRadius={80} paddingAngle={2}>
                  {statusPie.map((_: unknown, i: number) => (
                    <Cell key={i} fill={STATUS_COLORS[i % STATUS_COLORS.length]} />
                  ))}
                </Pie>
              </PieChart>
            </ChartContainer>
          )}
          {summary.errorsWeek > 0 && (
            <p className="text-xs text-muted-foreground">{summary.errorsWeek} errors in the last 7 days</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-border bg-card p-4 sm:p-5 space-y-3">
          <h2 className="font-semibold">Latency</h2>
          <ChartContainer config={latencyConfig} className="aspect-auto h-[160px] sm:h-[180px] w-full">
            <LineChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="bucket" tickLine={false} axisLine={false} tickFormatter={(v) => fmtBucket(String(v), granularity)} minTickGap={20} />
              <YAxis tickLine={false} axisLine={false} width={40} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Line type="monotone" dataKey="avgDurationMs" stroke="var(--color-avgDurationMs)" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="p95DurationMs" stroke="var(--color-p95DurationMs)" strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
            </LineChart>
          </ChartContainer>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 sm:p-5 space-y-3">
          <h2 className="font-semibold">Endpoint mix</h2>
          <ChartContainer config={volumeConfig} className="aspect-auto h-[160px] sm:h-[180px] w-full">
            <BarChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="bucket" tickLine={false} axisLine={false} tickFormatter={(v) => fmtBucket(String(v), granularity)} minTickGap={20} />
              <YAxis tickLine={false} axisLine={false} width={36} allowDecimals={false} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="vin" fill="var(--color-vin)" stackId="a" />
              <Bar dataKey="check" fill="var(--color-check)" stackId="a" />
              <Bar dataKey="live" fill="var(--color-live)" stackId="a" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ChartContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="rounded-xl border border-border bg-card p-4 sm:p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold flex items-center gap-2"><KeyRound className="w-4 h-4" /> Tokens</h2>
            <Button size="sm" variant="outline" asChild>
              <Link href={`/api-tokens?clientId=${id}`}>Manage</Link>
            </Button>
          </div>
          {tokensLoading ? (
            <p className="text-sm text-muted-foreground animate-pulse">Loading tokens…</p>
          ) : tokensError ? (
            <div className="space-y-2">
              <p className="text-sm text-destructive">{(tokensLoadError as Error)?.message || "Could not load tokens."}</p>
              <Button size="sm" variant="outline" onClick={() => refetchTokens()}>Retry</Button>
            </div>
          ) : !clientTokens || clientTokens.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tokens yet.</p>
          ) : (
            <ul className="space-y-2">
              {clientTokens.map((t: any) => (
                <li key={t.id} className="flex items-center justify-between gap-2 text-sm border border-border rounded-lg px-3 py-2">
                  <div className="min-w-0">
                    <div className="font-medium truncate">
                      {t.name}
                      {t.isTestOnly ? (
                        <span className="ml-2 text-[10px] font-semibold uppercase text-amber-700">Test</span>
                      ) : null}
                    </div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {(t as any).tokenPrefix ? `${(t as any).tokenPrefix}…` : "Prefix hidden"}
                    </div>
                  </div>
                  <span className={cn("text-[11px] font-semibold uppercase", t.isActive && !t.revokedAt ? "text-emerald-600" : "text-muted-foreground")}>
                    {t.revokedAt ? "Revoked" : t.isActive ? "Active" : "Off"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-border bg-card p-4 sm:p-5 space-y-3" id="live-feed">
          <h2 className="font-semibold flex items-center gap-2"><Radio className="w-4 h-4" /> Live feed</h2>
          <p className="text-xs text-muted-foreground">Portal: €200/mo Encar only · €300/mo full (Encar, KB, Autowini…). Enable after support ticket.</p>
          <p className="text-sm">
            {(client as any).liveFeedActive ? (
              <span className="text-teal-700 dark:text-teal-300 font-medium">Enabled</span>
            ) : (
              <span className="text-muted-foreground">Disabled</span>
            )}
            {(client as any).liveFeedExpiresAt ? (
              <span className="text-muted-foreground"> · until {new Date((client as any).liveFeedExpiresAt).toLocaleString()}</span>
            ) : (client as any).liveFeedEnabled ? (
              <span className="text-muted-foreground"> · no expiry</span>
            ) : null}
          </p>
        </section>
      </div>

      <section className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-4 sm:px-5 py-3 border-b border-border">
          <h2 className="font-semibold">Recent requests</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground bg-muted/40">
              <tr>
                <th className="px-4 py-2 font-semibold">When</th>
                <th className="px-4 py-2 font-semibold">Status</th>
                <th className="px-4 py-2 font-semibold">Path</th>
                <th className="px-4 py-2 font-semibold">VIN</th>
                <th className="px-4 py-2 font-semibold text-right">ms</th>
              </tr>
            </thead>
            <tbody>
              {(usage?.recentLogs ?? []).length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No request logs yet.</td>
                </tr>
              ) : (
                (usage?.recentLogs ?? []).map((row: any) => (
                  <tr key={row.id} className="border-t border-border/70">
                    <td className="px-4 py-2 whitespace-nowrap text-xs text-muted-foreground">
                      {row.requestedAt ? new Date(row.requestedAt).toLocaleString() : "—"}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">{row.statusCode}</td>
                    <td className="px-4 py-2 font-mono text-xs truncate max-w-[16rem]">{row.method} {row.path}</td>
                    <td className="px-4 py-2 font-mono text-xs">{row.vin || "—"}</td>
                    <td className="px-4 py-2 font-mono text-xs text-right">{row.durationMs}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <form onSubmit={save} className="rounded-xl border border-border bg-card p-4 sm:p-5 space-y-6">
        <div id="profile">
          <h2 className="font-semibold text-lg">Portal profile</h2>
          <p className="text-xs text-muted-foreground mt-1 mb-3">Same fields clients edit under Profile in /account/.</p>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4 text-sm">
            <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5">
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Registered</dt>
              <dd className="mt-1 font-mono text-xs">{formatClientWhen(client.createdAt as string)}</dd>
            </div>
            <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5">
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Last portal login</dt>
              <dd className="mt-1 font-mono text-xs">{formatClientWhen((client as any).lastLoginAt)}</dd>
            </div>
          </dl>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Company / app name">
              <Input required value={form.name} onChange={(e) => setForm((s) => ({ ...s!, name: e.target.value }))} />
            </Field>
            <Field label="Description">
              <Input value={form.description} onChange={(e) => setForm((s) => ({ ...s!, description: e.target.value }))} />
            </Field>
            <Field label="Portal email">
              <Input type="email" value={form.email} onChange={(e) => setForm((s) => ({ ...s!, email: e.target.value }))} />
            </Field>
            <Field label="Portal password (blank = keep)">
              <Input type="password" value={form.password} onChange={(e) => setForm((s) => ({ ...s!, password: e.target.value }))} autoComplete="new-password" />
            </Field>
            <Field label="Company name">
              <Input value={form.companyName} onChange={(e) => setForm((s) => ({ ...s!, companyName: e.target.value }))} placeholder="Optional" />
            </Field>
            <Field label="Telegram username">
              <Input value={form.telegramUsername} onChange={(e) => setForm((s) => ({ ...s!, telegramUsername: e.target.value }))} placeholder="username" />
            </Field>
            <Field label="Website URL">
              <Input value={form.websiteUrl} onChange={(e) => setForm((s) => ({ ...s!, websiteUrl: e.target.value }))} placeholder="https://example.com" />
            </Field>
          </div>
        </div>

        <div className="border-t border-border pt-6">
          <h2 className="font-semibold text-lg">Billing & limits</h2>
          <p className="text-xs text-muted-foreground mt-1 mb-4">Credits tab + API rate limits in the client portal.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Credit balance">
              <Input type="number" min={0} value={form.creditBalance} onChange={(e) => setForm((s) => ({ ...s!, creditBalance: parseInt(e.target.value) || 0 }))} />
            </Field>
            <Field label="Req / minute">
              <Input type="number" min={1} value={form.rateLimitPerMinute} onChange={(e) => setForm((s) => ({ ...s!, rateLimitPerMinute: parseInt(e.target.value) || 60 }))} />
            </Field>
            <Field label="Req / day">
              <Input type="number" min={1} value={form.rateLimitPerDay} onChange={(e) => setForm((s) => ({ ...s!, rateLimitPerDay: parseInt(e.target.value) || 10000 }))} />
            </Field>
            <Field label="Req / VIN / month (blank = ∞)">
              <Input type="number" min={1} placeholder="Unlimited" value={form.requestsPerVin} onChange={(e) => setForm((s) => ({ ...s!, requestsPerVin: e.target.value ? parseInt(e.target.value) : "" }))} />
            </Field>
            <Field label="Req / month (blank = ∞)">
              <Input type="number" min={1} placeholder="Unlimited" value={form.monthlyGlobalLimit} onChange={(e) => setForm((s) => ({ ...s!, monthlyGlobalLimit: e.target.value ? parseInt(e.target.value) : "" }))} />
            </Field>
          </div>
        </div>

        <div className="border-t border-border pt-6" id="live-feed-settings">
          <div className="rounded-md border border-border p-3 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Live feed</div>
              <p className="text-[11px] text-muted-foreground mt-0.5">When on: unlimited live calls, no credit charge.</p>
            </div>
            <Switch checked={form.liveFeedEnabled} onCheckedChange={(c) => setForm((s) => ({ ...s!, liveFeedEnabled: c }))} />
          </div>
          {form.liveFeedEnabled && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Days open">
                <Input type="number" min={0} placeholder="Blank = keep / unlimited" value={form.liveFeedDays} onChange={(e) => setForm((s) => ({ ...s!, liveFeedDays: e.target.value ? parseInt(e.target.value) : "" }))} />
              </Field>
              <Field label="Or expires at">
                <Input type="datetime-local" value={form.liveFeedExpiresAt} onChange={(e) => setForm((s) => ({ ...s!, liveFeedExpiresAt: e.target.value, liveFeedDays: "" }))} />
              </Field>
            </div>
          )}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <Button type="submit" disabled={updateMutation.isPending}>
            {updateMutation.isPending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </form>

      <DeleteClientDialog
        clientId={id}
        clientName={client.name}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onDeleted={() => setLocation("/api-clients")}
      />
    </div>
  );
}

function Kpi({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border px-2.5 py-2 sm:px-3 sm:py-2.5",
        accent ? "bg-primary/5 border-primary/20" : "bg-card",
      )}
    >
      <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Icon className="w-3 h-3 shrink-0" />
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-0.5 text-base sm:text-lg font-bold font-mono tabular-nums leading-tight">
        {Number(value).toLocaleString()}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1.5 block">
      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
