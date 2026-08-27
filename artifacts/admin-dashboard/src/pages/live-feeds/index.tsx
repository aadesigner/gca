import React, { useState } from "react";
import {
  Radio,
  Power,
  PowerOff,
  Plus,
  RefreshCw,
  Wifi,
  WifiOff,
  Clock,
  BarChart2,
  Settings2,
  Trash2,
  ChevronDown,
  ChevronUp,
  FlaskConical,
  ExternalLink,
  Layers,
} from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useQueryClient } from "@tanstack/react-query";

// ── Types ──────────────────────────────────────────────────────────────────

interface LiveFeedStats {
  activeCacheEntries: number;
  cacheHits: number;
  cacheMisses: number;
  totalRequests: number;
  cacheHitRate: number;
  lastUpstreamCall: string | null;
}

interface LiveFeed {
  id: number;
  name: string;
  internalName: string;
  isEnabled: boolean;
  cacheTtlSeconds: number;
  hasCredentials: boolean;
  lastTestedAt: string | null;
  lastTestOk: boolean | null;
  lastTestError: string | null;
  createdAt: string;
  updatedAt: string;
  stats: LiveFeedStats;
}

// ── API helpers ────────────────────────────────────────────────────────────

const BASE = "/api/admin/live-feeds";

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

function useListLiveFeeds() {
  const [data, setData] = useState<LiveFeed[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const load = React.useCallback(() => {
    setIsLoading(true);
    apiFetch<LiveFeed[]>(BASE)
      .then(setData)
      .catch(setError)
      .finally(() => setIsLoading(false));
  }, []);

  React.useEffect(() => { load(); }, [load]);
  return { data, isLoading, error, refetch: load };
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function LiveFeeds() {
  const { data: feeds, isLoading, refetch } = useListLiveFeeds();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [configuring, setConfiguring] = useState<LiveFeed | null>(null);
  const { toast } = useToast();

  const handleDelete = async (feed: LiveFeed) => {
    if (!confirm(`Delete "${feed.name}"? This removes all cached data for this provider.`)) return;
    try {
      await apiFetch(`${BASE}/${feed.id}`, { method: "DELETE" });
      toast({ title: "Provider deleted" });
      refetch();
    } catch (err) {
      toast({ title: "Delete failed", description: String(err), variant: "destructive" });
    }
  };

  const handleToggle = async (feed: LiveFeed) => {
    try {
      await apiFetch(`${BASE}/${feed.id}`, {
        method: "PUT",
        body: JSON.stringify({ isEnabled: !feed.isEnabled }),
      });
      toast({ title: `Provider ${feed.isEnabled ? "disabled" : "enabled"}` });
      refetch();
    } catch (err) {
      toast({ title: "Update failed", description: String(err), variant: "destructive" });
    }
  };

  const handleTest = async (feed: LiveFeed) => {
    toast({ title: "Testing connectivity…" });
    try {
      const result = await apiFetch<{ ok: boolean; error: string | null }>(`${BASE}/${feed.id}/test`, { method: "POST" });
      if (result.ok) {
        toast({ title: "✓ Connectivity OK", description: `${feed.name} is reachable` });
      } else {
        toast({ title: "✗ Connectivity failed", description: result.error ?? "Unknown error", variant: "destructive" });
      }
      refetch();
    } catch (err) {
      toast({ title: "Test failed", description: String(err), variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Live Feeds</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Configure real-time inventory providers. Responses are cached in PostgreSQL with a configurable TTL.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/live-feeds/all/test">
            <Button className="gap-2 bg-sky-600 hover:bg-sky-500 text-white">
              <Layers className="w-4 h-4" />
              All enabled feeds
            </Button>
          </Link>
          <Button variant="outline" onClick={refetch} className="gap-2">
            <RefreshCw className="w-4 h-4" />
            Refresh
          </Button>
          <Button onClick={() => setIsCreateOpen(true)} className="gap-2">
            <Plus className="w-4 h-4" />
            Add Provider
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="bg-card border border-border rounded-xl p-8 text-center text-muted-foreground animate-pulse font-mono text-xs">
          LOADING_LIVE_FEEDS...
        </div>
      ) : !feeds?.length ? (
        <div className="bg-card border border-border rounded-xl p-12 text-center">
          <Radio className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <div className="text-sm font-medium">No live feed providers configured</div>
          <div className="text-xs text-muted-foreground mt-1">Add a provider to enable real-time inventory endpoints.</div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800 rounded-xl shadow-sm overflow-hidden">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4 px-6 py-4">
              <div className="w-10 h-10 rounded-lg bg-sky-600 text-white flex items-center justify-center shrink-0">
                <Layers className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold">All enabled feeds</span>
                  <span className="text-xs font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">combined</span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  One browse view of every enabled live provider, with price and market filters applied together.
                  {feeds.some((f) => f.isEnabled)
                    ? ` Currently: ${feeds.filter((f) => f.isEnabled).map((f) => f.name).join(" · ")}`
                    : " Enable at least one provider below to load listings."}
                </div>
              </div>
              <Link href="/live-feeds/all/test" className="shrink-0">
                <Button size="sm" className="gap-1.5 text-xs w-full sm:w-auto bg-sky-600 hover:bg-sky-500 text-white">
                  <FlaskConical className="w-3 h-3" /> Open combined test site
                  <ExternalLink className="w-3 h-3 opacity-70" />
                </Button>
              </Link>
            </div>
          </div>
          {feeds.map((feed) => (
            <FeedCard
              key={feed.id}
              feed={feed}
              onToggle={() => handleToggle(feed)}
              onTest={() => handleTest(feed)}
              onConfigure={() => setConfiguring(feed)}
              onDelete={() => handleDelete(feed)}
            />
          ))}
        </div>
      )}

      <CreateFeedDialog open={isCreateOpen} onOpenChange={setIsCreateOpen} onSuccess={refetch} />
      {configuring && (
        <ConfigureFeedDialog
          feed={configuring}
          open={!!configuring}
          onOpenChange={(o) => !o && setConfiguring(null)}
          onSuccess={() => { refetch(); setConfiguring(null); }}
        />
      )}
    </div>
  );
}

// ── Feed Card ──────────────────────────────────────────────────────────────

function FeedCard({
  feed,
  onToggle,
  onTest,
  onConfigure,
  onDelete,
}: {
  feed: LiveFeed;
  onToggle: () => void;
  onTest: () => void;
  onConfigure: () => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hitRate = Math.round((feed.stats.cacheHitRate ?? 0) * 100);

  return (
    <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
      {/* Header row */}
      <div className="flex items-center gap-4 px-6 py-4">
        <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <Radio className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold">{feed.name}</span>
            <span className="text-xs font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{feed.internalName}</span>
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold ${
              feed.isEnabled ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
            }`}>
              {feed.isEnabled ? <Power className="w-3 h-3" /> : <PowerOff className="w-3 h-3" />}
              {feed.isEnabled ? "ENABLED" : "DISABLED"}
            </span>
            {feed.hasCredentials ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-blue-100 text-blue-700">
                <Wifi className="w-3 h-3" /> Credentials set
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-yellow-100 text-yellow-700">
                <WifiOff className="w-3 h-3" /> Stub mode
              </span>
            )}
          </div>
          <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              TTL: {feed.cacheTtlSeconds}s
            </span>
            <span className="flex items-center gap-1">
              <BarChart2 className="w-3 h-3" />
              Hit rate: {hitRate}%
            </span>
            <span>{feed.stats.totalRequests} total requests</span>
            {feed.lastTestedAt && (
              <span className={`flex items-center gap-1 ${feed.lastTestOk ? "text-green-600" : "text-red-500"}`}>
                {feed.lastTestOk ? "✓" : "✗"} Last tested {new Date(feed.lastTestedAt).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link href={`/live-feeds/${feed.id}/test`}>
            <Button size="sm" className="gap-1.5 text-xs bg-sky-600 hover:bg-sky-500 text-white">
              <FlaskConical className="w-3 h-3" /> Test Site
              <ExternalLink className="w-3 h-3 opacity-70" />
            </Button>
          </Link>
          <Button size="sm" variant="outline" onClick={onTest} className="gap-1.5 text-xs">
            <Wifi className="w-3 h-3" /> Test
          </Button>
          <Button size="sm" variant="outline" onClick={onConfigure} className="gap-1.5 text-xs">
            <Settings2 className="w-3 h-3" /> Configure
          </Button>
          <Button size="sm" variant="ghost" onClick={onToggle}>
            {feed.isEnabled ? <PowerOff className="w-4 h-4 text-muted-foreground" /> : <Power className="w-4 h-4 text-muted-foreground" />}
          </Button>
          <Button size="sm" variant="ghost" onClick={onDelete}>
            <Trash2 className="w-4 h-4 text-muted-foreground" />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setExpanded((v) => !v)}>
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      {/* Stats panel */}
      {expanded && (
        <div className="border-t border-border bg-muted/30 px-6 py-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatBox label="Active Cache Entries" value={feed.stats.activeCacheEntries} />
          <StatBox label="Cache Hits" value={feed.stats.cacheHits} />
          <StatBox label="Cache Misses (Upstream Calls)" value={feed.stats.cacheMisses} />
          <StatBox label="Hit Rate" value={`${hitRate}%`} />
          {feed.lastTestedAt && (
            <div className="col-span-2 sm:col-span-4 text-xs text-muted-foreground">
              Last test: {new Date(feed.lastTestedAt).toLocaleString()} —{" "}
              <span className={feed.lastTestOk ? "text-green-600" : "text-red-500"}>
                {feed.lastTestOk ? "OK" : feed.lastTestError ?? "Failed"}
              </span>
            </div>
          )}
          {feed.stats.lastUpstreamCall && (
            <div className="col-span-2 sm:col-span-4 text-xs text-muted-foreground">
              Last upstream call: {new Date(feed.stats.lastUpstreamCall).toLocaleString()}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-card rounded-lg border border-border p-3">
      <div className="text-xs text-muted-foreground uppercase tracking-wider font-mono mb-1">{label}</div>
      <div className="text-xl font-bold">{value}</div>
    </div>
  );
}

// ── Create dialog ──────────────────────────────────────────────────────────

function CreateFeedDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const [isPending, setIsPending] = useState(false);
  const [form, setForm] = useState({
    name: "",
    internalName: "encar_live",
    cacheTtlSeconds: 60,
    isEnabled: false,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsPending(true);
    try {
      await apiFetch(BASE, { method: "POST", body: JSON.stringify(form) });
      toast({ title: "Provider created" });
      onOpenChange(false);
      onSuccess();
    } catch (err) {
      toast({ title: "Failed to create provider", description: String(err), variant: "destructive" });
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Add Live Feed Provider</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <Field label="Display Name">
              <Input required value={form.name} onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))} />
            </Field>
            <Field label="Internal Name (adapter key)">
              <select
                required
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
                value={form.internalName}
                onChange={(e) => setForm((s) => ({ ...s, internalName: e.target.value }))}
              >
                <option value="encar_live">encar_live</option>
                <option value="autowini_live">autowini_live</option>
                <option value="kbchachacha_live">kbchachacha_live</option>
              </select>
            </Field>
            <Field label="Cache TTL (seconds)">
              <Input type="number" min={5} max={3600} required value={form.cacheTtlSeconds}
                onChange={(e) => setForm((s) => ({ ...s, cacheTtlSeconds: parseInt(e.target.value) || 60 }))} />
            </Field>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="enabled-create"
                checked={form.isEnabled}
                onChange={(e) => setForm((s) => ({ ...s, isEnabled: e.target.checked }))}
                className="rounded"
              />
              <label htmlFor="enabled-create" className="text-sm">Enable immediately</label>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending}>Create</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Configure dialog ───────────────────────────────────────────────────────

function ConfigureFeedDialog({
  feed,
  open,
  onOpenChange,
  onSuccess,
}: {
  feed: LiveFeed;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const [isPending, setIsPending] = useState(false);
  const [form, setForm] = useState({
    name: feed.name,
    cacheTtlSeconds: feed.cacheTtlSeconds,
    isEnabled: feed.isEnabled,
    apiUrl: "",
    apiToken: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsPending(true);
    const payload: Record<string, unknown> = {
      name: form.name,
      cacheTtlSeconds: form.cacheTtlSeconds,
      isEnabled: form.isEnabled,
    };
    if (form.apiUrl || form.apiToken) {
      payload["credentials"] = {
        ...(form.apiUrl ? { apiUrl: form.apiUrl } : {}),
        ...(form.apiToken ? { apiToken: form.apiToken } : {}),
      };
    }
    try {
      await apiFetch(`${BASE}/${feed.id}`, { method: "PUT", body: JSON.stringify(payload) });
      toast({ title: "Provider updated" });
      onOpenChange(false);
      onSuccess();
    } catch (err) {
      toast({ title: "Update failed", description: String(err), variant: "destructive" });
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Configure: {feed.name}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <Field label="Display Name">
              <Input value={form.name} onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))} />
            </Field>
            <Field label="Cache TTL (seconds)" hint="How long to cache upstream responses (5–3600)">
              <Input type="number" min={5} max={3600} value={form.cacheTtlSeconds}
                onChange={(e) => setForm((s) => ({ ...s, cacheTtlSeconds: parseInt(e.target.value) || 60 }))} />
            </Field>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="enabled-edit"
                checked={form.isEnabled}
                onChange={(e) => setForm((s) => ({ ...s, isEnabled: e.target.checked }))}
                className="rounded"
              />
              <label htmlFor="enabled-edit" className="text-sm">Enabled</label>
            </div>

            <div className="border-t border-border pt-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Upstream Credentials
                {feed.hasCredentials && (
                  <span className="ml-2 text-green-600 normal-case font-normal">(currently set — leave blank to keep existing)</span>
                )}
              </div>
              <div className="grid gap-3">
                <Field label="API URL">
                  <Input
                    type="url"
                    placeholder={feed.hasCredentials ? "••••••••••••" : "https://api.example.com"}
                    value={form.apiUrl}
                    onChange={(e) => setForm((s) => ({ ...s, apiUrl: e.target.value }))}
                  />
                </Field>
                <Field label="API Token">
                  <Input
                    type="password"
                    placeholder={feed.hasCredentials ? "••••••••••••" : "Enter API token"}
                    value={form.apiToken}
                    onChange={(e) => setForm((s) => ({ ...s, apiToken: e.target.value }))}
                  />
                </Field>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Credentials are stored encrypted at rest. They are never returned in API responses.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending}>Save Changes</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Shared ─────────────────────────────────────────────────────────────────

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
