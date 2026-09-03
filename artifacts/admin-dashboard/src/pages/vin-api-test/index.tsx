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
      <div className="rounded-xl border border-dashed border-border bg-muted/30 px-4 py-12 text-center sm:px-6 sm:py-16">
        <FlaskConical className="mx-auto h-10 w-10 text-muted-foreground/60" />
        <p className="mt-4 text-sm text-muted-foreground">
          Run a check or retrieve request to see the JSON response here.
        </p>
      </div>
    );
  }

  return (
    <div className="min-w-0 max-w-full space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
        <div className="col-span-2 rounded-lg border border-border bg-card px-3 py-2.5 sm:col-span-1 sm:px-4 sm:py-3">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground sm:text-xs">Operation</p>
          <p className="mt-1 break-all font-mono text-xs font-medium sm:text-sm">
            {result.operation === "check" ? "GET /vin/check/:vin" : "GET /vin/:vin"}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card px-3 py-2.5 sm:px-4 sm:py-3">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground sm:text-xs">HTTP status</p>
          <p className={cn("mt-1 font-mono text-xs font-semibold sm:text-sm", statusTone(result.status))}>
            {result.status} {result.statusText}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card px-3 py-2.5 sm:px-4 sm:py-3">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground sm:text-xs">Latency</p>
          <p className="mt-1 font-mono text-xs font-medium sm:text-sm">{result.durationMs} ms</p>
        </div>
        <div className="col-span-2 rounded-lg border border-border bg-card px-3 py-2.5 sm:col-span-1 sm:px-4 sm:py-3">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground sm:text-xs">VIN</p>
          <p className="mt-1 break-all font-mono text-xs font-medium sm:text-sm">{result.vin}</p>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-muted/40 px-3 py-2.5 font-mono text-[11px] text-muted-foreground break-all sm:px-4 sm:py-3 sm:text-xs">
        {result.method} {result.url}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground sm:text-sm">
          Response at {new Date(result.at).toLocaleString()}
        </p>
        {viewMode === "json" && (
          <Button type="button" variant="outline" size="sm" className="w-full sm:w-auto" onClick={copyJson} disabled={!prettyJson}>
            <Copy className="h-4 w-4" />
            {copied ? "Copied" : "Copy JSON"}
          </Button>
        )}
      </div>

      {viewMode === "preview" && result.operation === "retrieve" ? (
        <VinRetrievePreview body={result.body} />
      ) : (
        <pre className="max-h-[min(60vh,720px)] overflow-auto rounded-xl border border-border bg-zinc-950 p-3 text-[11px] leading-relaxed text-zinc-100 sm:max-h-[min(70vh,720px)] sm:p-4 sm:text-xs">
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
    <div className="min-w-0 space-y-4 sm:space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl">
          <FlaskConical className="h-6 w-6 shrink-0 text-primary sm:h-7 sm:w-7" />
          VIN API tester
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Call the public V1 API exactly like a client: paste a real Bearer token, enter a VIN, then
          check existence or retrieve full history. View raw JSON or a client-style HTML preview.
        </p>
      </div>

      <Tabs value={mainTab} onValueChange={(v) => setMainTab(v as "request" | "response")}>
        <TabsList className="grid h-auto w-full grid-cols-2 sm:inline-flex sm:w-auto">
          <TabsTrigger value="request" className="min-h-[40px]">Request</TabsTrigger>
          <TabsTrigger value="response" className="min-h-[40px]">
            Response
            {(checkResult || retrieveResult) && (
              <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary/15 px-1.5 text-[10px] font-semibold text-primary">
                {(checkResult ? 1 : 0) + (retrieveResult ? 1 : 0)}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="request" className="mt-4 space-y-4 sm:space-y-6">
          <div className="space-y-5 rounded-xl border border-border bg-card p-4 shadow-sm sm:p-6">
            <div className="space-y-2">
              <Label htmlFor="api-token">API Bearer token</Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id="api-token"
                  type={showToken ? "text" : "password"}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="gca_live_… or gca_test_…"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  className="min-w-0 font-mono text-sm"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-10 w-full shrink-0 sm:h-10 sm:w-10"
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

            <div className="grid grid-cols-1 gap-2 pt-1 sm:flex sm:flex-wrap sm:gap-3">
              <Button
                type="button"
                className="min-h-[44px] w-full sm:w-auto"
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
                className="min-h-[44px] w-full sm:w-auto"
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
                <span className="font-mono">exists</span> and <span className="font-mono">country</span>. HTTP 200
                if the VIN is in the database, 404 if it is not.
              </p>
              <p>
                <span className="font-mono">GET /api/v1/vin/:vin</span> — full JSON payload; 1 credit on
                HTTP 200 (waived for curated test VINs).
              </p>
            </div>
          </div>

          {testVins.length > 0 && (
            <div className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-sm sm:p-6">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                <h2 className="text-sm font-semibold">Curated test VINs</h2>
              </div>
              {testVinsNote && <p className="text-xs text-muted-foreground">{testVinsNote}</p>}
              <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                {testVins.map((row) => (
                  <li key={row.vin} className="flex flex-col gap-1.5 bg-background/50 px-3 py-3 sm:flex-row sm:items-center sm:gap-2 sm:px-4">
                    <button
                      type="button"
                      className="shrink-0 text-left font-mono text-sm text-primary hover:underline"
                      onClick={() => setVin(row.vin)}
                    >
                      {row.vin}
                    </button>
                    <span className="min-w-0 break-words text-sm text-foreground">{row.label}</span>
                    <span className="min-w-0 break-words text-xs text-muted-foreground sm:ml-auto sm:max-w-[45%] sm:text-right">
                      {row.description}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </TabsContent>

        <TabsContent value="response" className="mt-4 min-w-0 space-y-4">
          <Tabs
            value={responseTab}
            onValueChange={(v) => setResponseTab(v as ApiOperation)}
          >
            <TabsList className="grid h-auto w-full grid-cols-2 sm:inline-flex sm:w-auto">
              <TabsTrigger value="check" disabled={!checkResult} className="min-h-[40px]">
                Check result
              </TabsTrigger>
              <TabsTrigger value="retrieve" disabled={!retrieveResult} className="min-h-[40px]">
                Retrieve result
              </TabsTrigger>
            </TabsList>
          </Tabs>
          {responseTab === "retrieve" && retrieveResult && (
            <div className="grid grid-cols-2 gap-2 sm:flex sm:w-fit">
              <Button
                type="button"
                size="sm"
                className="min-h-[40px]"
                variant={responseView === "json" ? "default" : "outline"}
                onClick={() => setResponseView("json")}
              >
                JSON
              </Button>
              <Button
                type="button"
                size="sm"
                className="min-h-[40px]"
                variant={responseView === "preview" ? "default" : "outline"}
                onClick={() => setResponseView("preview")}
              >
                <LayoutTemplate className="h-4 w-4" />
                <span className="truncate">Client preview</span>
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
