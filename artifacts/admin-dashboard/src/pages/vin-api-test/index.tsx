import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  FlaskConical,
  LayoutTemplate,
  Loader2,
  Search,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { VinRetrievePreview } from "./VinRetrievePreview";

const TOKEN_STORAGE_KEY = "gca-vin-api-test-token";

type ApiOperation = "check" | "retrieve";

interface ApiCallResult {
  operation: ApiOperation;
  vin: string;
  url: string;
  method: string;
  status: number;
  statusText: string;
  durationMs: number;
  body: unknown;
  rawText: string;
  at: string;
}

interface TestVinRow {
  vin: string;
  label: string;
  region: string;
  description: string;
}

function normalizeVin(raw: string): string {
  return raw.toUpperCase().replace(/\s+/g, "").trim();
}

function statusTone(status: number): string {
  if (status >= 200 && status < 300) return "text-emerald-600 dark:text-emerald-400";
  if (status >= 400 && status < 500) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

async function callVinApi(
  operation: ApiOperation,
  token: string,
  vin: string,
): Promise<ApiCallResult> {
  const path =
    operation === "check" ? `/api/v1/vin/check/${encodeURIComponent(vin)}` : `/api/v1/vin/${encodeURIComponent(vin)}`;
  const url = path;
  const started = performance.now();

  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token.trim()}`,
      Accept: "application/json",
    },
  });

  const rawText = await res.text();
  let body: unknown = rawText;
  try {
    body = rawText ? JSON.parse(rawText) : null;
  } catch {
    /* keep raw text */
  }

  return {
    operation,
    vin,
    url,
    method: "GET",
    status: res.status,
    statusText: res.statusText,
    durationMs: Math.round(performance.now() - started),
    body,
    rawText,
    at: new Date().toISOString(),
  };
}

function ResultPanel({
  result,
  viewMode,
}: {
  result: ApiCallResult | null;
  viewMode: "json" | "preview";
}) {
  const [copied, setCopied] = useState(false);

  const prettyJson = useMemo(() => {
    if (!result) return "";
    if (typeof result.body === "string") return result.body;
    return JSON.stringify(result.body, null, 2);
  }, [result]);

  const copyJson = async () => {
    if (!prettyJson) return;
    await navigator.clipboard.writeText(prettyJson);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  if (!result) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/30 px-6 py-16 text-center">
        <FlaskConical className="mx-auto h-10 w-10 text-muted-foreground/60" />
        <p className="mt-4 text-sm text-muted-foreground">
          Run a check or retrieve request to see the JSON response here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Operation</p>
          <p className="mt-1 font-mono text-sm font-medium">
            {result.operation === "check" ? "GET /vin/check/:vin" : "GET /vin/:vin"}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">HTTP status</p>
          <p className={cn("mt-1 font-mono text-sm font-semibold", statusTone(result.status))}>
            {result.status} {result.statusText}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Latency</p>
          <p className="mt-1 font-mono text-sm font-medium">{result.durationMs} ms</p>
        </div>
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">VIN</p>
          <p className="mt-1 font-mono text-sm font-medium">{result.vin}</p>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 font-mono text-xs text-muted-foreground break-all">
        {result.method} {result.url}
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Response at {new Date(result.at).toLocaleString()}
        </p>
        {viewMode === "json" && (
          <Button type="button" variant="outline" size="sm" onClick={copyJson} disabled={!prettyJson}>
            <Copy className="h-4 w-4" />
            {copied ? "Copied" : "Copy JSON"}
          </Button>
        )}
      </div>

      {viewMode === "preview" && result.operation === "retrieve" ? (
        <VinRetrievePreview body={result.body} />
      ) : (
        <pre className="max-h-[min(70vh,720px)] overflow-auto rounded-xl border border-border bg-zinc-950 p-4 text-xs leading-relaxed text-zinc-100">
          {prettyJson || "(empty body)"}
        </pre>
      )}
    </div>
  );
}

export default function VinApiTest() {
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [vin, setVin] = useState("");
  const [mainTab, setMainTab] = useState<"request" | "response">("request");
  const [responseTab, setResponseTab] = useState<ApiOperation>("check");
  const [responseView, setResponseView] = useState<"json" | "preview">("json");
  const [loading, setLoading] = useState<ApiOperation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkResult, setCheckResult] = useState<ApiCallResult | null>(null);
  const [retrieveResult, setRetrieveResult] = useState<ApiCallResult | null>(null);
  const [testVins, setTestVins] = useState<TestVinRow[]>([]);
  const [testVinsNote, setTestVinsNote] = useState<string | null>(null);

  useEffect(() => {
    const saved = sessionStorage.getItem(TOKEN_STORAGE_KEY);
    if (saved) setToken(saved);
  }, []);

  useEffect(() => {
    if (token.trim()) {
      sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  }, [token]);

  const loadTestVins = useCallback(async () => {
    if (!token.trim()) {
      setTestVins([]);
      setTestVinsNote(null);
      return;
    }
    try {
      const res = await fetch("/api/v1/test-vins", {
        headers: { Authorization: `Bearer ${token.trim()}`, Accept: "application/json" },
      });
      const json = await res.json();
      if (res.ok && json?.data?.testVins) {
        setTestVins(json.data.testVins);
        setTestVinsNote(json.data.note ?? null);
      } else {
        setTestVins([]);
        setTestVinsNote(null);
      }
    } catch {
      setTestVins([]);
      setTestVinsNote(null);
    }
  }, [token]);

  useEffect(() => {
    const t = window.setTimeout(loadTestVins, 400);
    return () => window.clearTimeout(t);
  }, [loadTestVins]);

  const run = async (operation: ApiOperation) => {
    const trimmedToken = token.trim();
    const normalizedVin = normalizeVin(vin);

    if (!trimmedToken) {
      setError("Paste a Bearer API token first.");
      setMainTab("request");
      return;
    }
    if (!normalizedVin || normalizedVin.length < 5) {
      setError("Enter a valid VIN (5–17 characters).");
      setMainTab("request");
      return;
    }

    setError(null);
    setLoading(operation);
    setVin(normalizedVin);

    try {
      const result = await callVinApi(operation, trimmedToken, normalizedVin);
      if (operation === "check") {
        setCheckResult(result);
        setResponseTab("check");
      } else {
        setRetrieveResult(result);
        setResponseTab("retrieve");
      }
      setMainTab("response");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
      setMainTab("request");
    } finally {
      setLoading(null);
    }
  };

  const activeResult = responseTab === "check" ? checkResult : retrieveResult;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <FlaskConical className="h-7 w-7 text-primary" />
          VIN API tester
        </h1>
        <p className="text-muted-foreground text-sm mt-1 max-w-3xl">
          Call the public V1 API exactly like a client: paste a real Bearer token, enter a VIN, then
          check existence or retrieve full history. View raw JSON or a client-style HTML preview.
        </p>
      </div>

      <Tabs value={mainTab} onValueChange={(v) => setMainTab(v as "request" | "response")}>
        <TabsList>
          <TabsTrigger value="request">Request</TabsTrigger>
          <TabsTrigger value="response">
            Response
            {(checkResult || retrieveResult) && (
              <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary/15 px-1.5 text-[10px] font-semibold text-primary">
                {(checkResult ? 1 : 0) + (retrieveResult ? 1 : 0)}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="request" className="space-y-6 mt-4">
          <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-5">
            <div className="space-y-2">
              <Label htmlFor="api-token">API Bearer token</Label>
              <div className="flex gap-2">
                <Input
                  id="api-token"
                  type={showToken ? "text" : "password"}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="gca_live_… or gca_test_…"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  className="font-mono text-sm"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={showToken ? "Hide token" : "Show token"}
                  onClick={() => setShowToken((v) => !v)}
                >
                  {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Stored in this browser tab only (sessionStorage). Create tokens under{" "}
                <a href="/api-tokens" className="text-primary underline-offset-2 hover:underline">
                  API tokens
                </a>
                .
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="vin">VIN</Label>
              <Input
                id="vin"
                autoComplete="off"
                spellCheck={false}
                placeholder="e.g. WDDUX8GB8JA397509"
                value={vin}
                onChange={(e) => setVin(e.target.value.toUpperCase())}
                className="font-mono text-sm uppercase tracking-wide"
                maxLength={17}
              />
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                {error}
              </div>
            )}

            <div className="flex flex-wrap gap-3 pt-1">
              <Button
                type="button"
                onClick={() => run("check")}
                disabled={loading !== null}
              >
                {loading === "check" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
                Check VIN
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => run("retrieve")}
                disabled={loading !== null}
              >
                {loading === "retrieve" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Zap className="h-4 w-4" />
                )}
                Retrieve history
              </Button>
            </div>

            <div className="rounded-lg bg-muted/50 border border-border px-4 py-3 text-xs text-muted-foreground space-y-1">
              <p>
                <span className="font-mono">GET /api/v1/vin/check/:vin</span> — free, no credit. Returns{" "}
                <span className="font-mono">exists</span>, <span className="font-mono">country</span>, and{" "}
                <span className="font-mono">hasHistory</span>.
              </p>
              <p>
                <span className="font-mono">GET /api/v1/vin/:vin</span> — full JSON payload; 1 credit on
                HTTP 200 (waived for curated test VINs).
              </p>
            </div>
          </div>

          {testVins.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <h2 className="font-semibold text-sm">Curated test VINs</h2>
              </div>
              {testVinsNote && <p className="text-xs text-muted-foreground">{testVinsNote}</p>}
              <ul className="divide-y divide-border rounded-lg border border-border overflow-hidden">
                {testVins.map((row) => (
                  <li key={row.vin} className="flex flex-col sm:flex-row sm:items-center gap-2 px-4 py-3 bg-background/50">
                    <button
                      type="button"
                      className="font-mono text-sm text-left text-primary hover:underline shrink-0"
                      onClick={() => setVin(row.vin)}
                    >
                      {row.vin}
                    </button>
                    <span className="text-sm text-foreground">{row.label}</span>
                    <span className="text-xs text-muted-foreground sm:ml-auto">{row.description}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </TabsContent>

        <TabsContent value="response" className="mt-4 space-y-4">
          <Tabs
            value={responseTab}
            onValueChange={(v) => setResponseTab(v as ApiOperation)}
          >
            <TabsList>
              <TabsTrigger value="check" disabled={!checkResult}>
                Check result
              </TabsTrigger>
              <TabsTrigger value="retrieve" disabled={!retrieveResult}>
                Retrieve result
              </TabsTrigger>
            </TabsList>
          </Tabs>
          {responseTab === "retrieve" && retrieveResult && (
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={responseView === "json" ? "default" : "outline"}
                onClick={() => setResponseView("json")}
              >
                JSON
              </Button>
              <Button
                type="button"
                size="sm"
                variant={responseView === "preview" ? "default" : "outline"}
                onClick={() => setResponseView("preview")}
              >
                <LayoutTemplate className="h-4 w-4" />
                Client preview
              </Button>
            </div>
          )}
          <ResultPanel
            result={activeResult}
            viewMode={responseTab === "retrieve" ? responseView : "json"}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
