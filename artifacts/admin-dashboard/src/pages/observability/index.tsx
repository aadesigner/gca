import React, { useState } from "react";
import {
  useGetObservabilityStats,
  useListSystemEvents,
} from "@workspace/api-client-react";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Info,
  Zap,
  Database,
  Globe,
  ChevronDown,
  ChevronUp,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const EVENT_TYPE_LABELS: Record<string, string> = {
  provider_error: "Provider Error",
  parser_error: "Parser Error",
  vin_extraction_failure: "VIN Extraction Failure",
  http_error: "HTTP Error",
  rate_limit: "Rate Limit",
  db_error: "DB Error",
  api_error: "API Error",
};

const SEVERITY_COLORS: Record<string, string> = {
  info: "bg-blue-100 text-blue-700",
  warning: "bg-amber-100 text-amber-700",
  error: "bg-red-100 text-red-700",
  critical: "bg-red-200 text-red-900 font-bold",
};

const EVENT_TYPE_ICONS: Record<string, React.ElementType> = {
  provider_error: Globe,
  parser_error: AlertCircle,
  vin_extraction_failure: AlertTriangle,
  http_error: Globe,
  rate_limit: Zap,
  db_error: Database,
  api_error: Activity,
};

export default function Observability() {
  const [hours, setHours] = useState(24);
  const [eventTypeFilter, setEventTypeFilter] = useState("");
  const [severityFilter, setSeverityFilter] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { data: stats, isLoading: statsLoading, refetch: refetchStats } = useGetObservabilityStats({ hours });
  const { data: events, isLoading: eventsLoading, refetch: refetchEvents } = useListSystemEvents({
    eventType: eventTypeFilter || undefined,
    severity: severityFilter || undefined,
    limit: 100,
  });

  const handleRefresh = () => {
    refetchStats();
    refetchEvents();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Observability</h1>
          <p className="text-muted-foreground text-sm mt-1">
            System health, error tracking, and provider failure logs.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-mono">Window:</span>
            {[1, 6, 24, 72, 168].map(h => (
              <button
                key={h}
                onClick={() => setHours(h)}
                className={`px-2.5 py-1 rounded text-xs font-mono font-semibold transition-colors ${
                  hours === h ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {h < 24 ? `${h}h` : `${h / 24}d`}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={handleRefresh}>
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Stats Summary */}
      {statsLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 bg-card border border-border rounded-xl animate-pulse" />
          ))}
        </div>
      ) : stats ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard label="Total Events" value={stats.totalEvents} icon={Activity} className="bg-card" />
            {stats.bySeverity.find(s => s.severity === "error" || s.severity === "critical") && (
              <StatCard
                label="Errors"
                value={
                  (stats.bySeverity.find(s => s.severity === "error")?.count ?? 0) +
                  (stats.bySeverity.find(s => s.severity === "critical")?.count ?? 0)
                }
                icon={AlertCircle}
                className="bg-red-50 border-red-200"
                valueClass="text-red-700"
              />
            )}
            {stats.bySeverity.find(s => s.severity === "warning") && (
              <StatCard
                label="Warnings"
                value={stats.bySeverity.find(s => s.severity === "warning")?.count ?? 0}
                icon={AlertTriangle}
                className="bg-amber-50 border-amber-200"
                valueClass="text-amber-700"
              />
            )}
            <StatCard
              label="Providers Affected"
              value={stats.byProvider.length}
              icon={Globe}
              className="bg-card"
            />
          </div>

          {/* By Event Type */}
          {stats.byType.length > 0 && (
            <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
              <div className="px-6 py-3 border-b border-border bg-muted/30">
                <h3 className="text-sm font-semibold">Events by Type</h3>
              </div>
              <div className="p-4 flex flex-wrap gap-3">
                {stats.byType.map(t => {
                  const Icon = EVENT_TYPE_ICONS[t.eventType] ?? Activity;
                  return (
                    <button
                      key={t.eventType}
                      onClick={() => setEventTypeFilter(eventTypeFilter === t.eventType ? "" : t.eventType)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                        eventTypeFilter === t.eventType
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background border-border hover:bg-muted/50"
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      <span className="text-xs">{EVENT_TYPE_LABELS[t.eventType] ?? t.eventType}</span>
                      <span className="font-mono font-bold text-xs">{t.count}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </>
      ) : null}

      {/* Severity Filter */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground font-mono">Severity:</span>
        {["", "critical", "error", "warning", "info"].map(s => (
          <button
            key={s || "all"}
            onClick={() => setSeverityFilter(s)}
            className={`px-2.5 py-1 rounded text-xs font-mono font-semibold uppercase tracking-wider transition-colors ${
              severityFilter === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {s || "ALL"}
          </button>
        ))}
        {(eventTypeFilter || severityFilter) && (
          <button
            onClick={() => { setEventTypeFilter(""); setSeverityFilter(""); }}
            className="text-xs text-muted-foreground hover:text-foreground underline ml-2"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Events Table */}
      <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-muted/50 text-xs uppercase font-semibold text-muted-foreground border-b border-border tracking-wider">
              <tr>
                <th className="px-6 py-4">Timestamp</th>
                <th className="px-6 py-4">Severity</th>
                <th className="px-6 py-4">Type</th>
                <th className="px-6 py-4">Provider</th>
                <th className="px-6 py-4">Message</th>
                <th className="px-6 py-4 w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {eventsLoading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-muted-foreground animate-pulse font-mono text-xs">
                    LOADING_EVENTS...
                  </td>
                </tr>
              ) : !events?.items.length ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-muted-foreground">
                    <div className="flex flex-col items-center gap-2">
                      <Activity className="w-8 h-8 opacity-30" />
                      <p className="text-sm">No system events recorded.</p>
                      <p className="text-xs">Events are logged when collection jobs run.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                events.items.map(event => (
                  <React.Fragment key={event.id}>
                    <tr
                      className="hover:bg-muted/30 transition-colors cursor-pointer"
                      onClick={() => setExpandedId(expandedId === event.id ? null : event.id)}
                    >
                      <td className="px-6 py-3 font-mono text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(event.occurredAt).toLocaleString()}
                      </td>
                      <td className="px-6 py-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-semibold ${SEVERITY_COLORS[event.severity] ?? "bg-muted text-muted-foreground"}`}>
                          {event.severity.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-6 py-3">
                        <span className="font-mono text-xs text-primary">
                          {EVENT_TYPE_LABELS[event.eventType] ?? event.eventType}
                        </span>
                      </td>
                      <td className="px-6 py-3 text-xs text-muted-foreground">
                        {event.providerName ?? (event.providerId ? `#${event.providerId}` : "—")}
                      </td>
                      <td className="px-6 py-3 text-sm max-w-xs truncate">{event.message}</td>
                      <td className="px-6 py-3 text-muted-foreground">
                        {event.details ? (
                          expandedId === event.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />
                        ) : null}
                      </td>
                    </tr>
                    {expandedId === event.id && event.details && (
                      <tr>
                        <td colSpan={6} className="px-6 py-3 bg-muted/20">
                          <pre className="text-xs font-mono text-muted-foreground overflow-x-auto whitespace-pre-wrap">
                            {(() => { try { return JSON.stringify(JSON.parse(event.details), null, 2); } catch { return event.details; } })()}
                          </pre>
                          {event.sourceUrl && (
                            <div className="text-xs font-mono text-muted-foreground mt-1">
                              URL: <a href={event.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline">{event.sourceUrl}</a>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  className = "bg-card",
  valueClass = "text-foreground",
}: {
  label: string;
  value: number;
  icon: React.ElementType;
  className?: string;
  valueClass?: string;
}) {
  return (
    <div className={`border border-border rounded-xl p-4 shadow-sm ${className}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
        <Icon className="w-4 h-4 text-muted-foreground" />
      </div>
      <div className={`text-3xl font-mono font-bold ${valueClass}`}>{value.toLocaleString()}</div>
    </div>
  );
}
