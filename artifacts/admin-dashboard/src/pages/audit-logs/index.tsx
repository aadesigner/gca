import React, { useState } from "react";
import { useListAuditLogs } from "@workspace/api-client-react";
import { ShieldAlert, ChevronDown, ChevronUp, Filter, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const COMMON_ACTIONS = [
  "provider.create",
  "provider.update",
  "provider.delete",
  "job.create",
  "job.cancel",
  "token.create",
  "token.revoke",
  "data.override",
  "settings.update",
  "live_feed.create",
  "live_feed.update",
  "live_feed.delete",
];

const ENTITY_TYPES = [
  "provider",
  "collection_job",
  "api_token",
  "api_client",
  "vehicle",
  "live_provider",
  "settings",
];

export default function AuditLogs() {
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [offset, setOffset] = useState(0);
  const PAGE_SIZE = 50;

  const { data: logsData, isLoading } = useListAuditLogs({
    action: action || undefined,
    entityType: entityType || undefined,
    dateFrom: dateFrom ? new Date(dateFrom).toISOString() : undefined,
    dateTo: dateTo ? new Date(dateTo).toISOString() : undefined,
    limit: PAGE_SIZE,
    offset,
  });

  const clearFilters = () => {
    setAction("");
    setEntityType("");
    setDateFrom("");
    setDateTo("");
    setOffset(0);
  };

  const hasFilters = action || entityType || dateFrom || dateTo;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Audit Logs</h1>
          <p className="text-muted-foreground text-sm mt-1">Immutable ledger of administrator actions.</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowFilters(!showFilters)}
          className={hasFilters ? "border-primary text-primary" : ""}
        >
          <Filter className="w-3.5 h-3.5 mr-1.5" />
          Filters
          {hasFilters && <span className="ml-1.5 bg-primary text-primary-foreground rounded-full w-4 h-4 text-[10px] flex items-center justify-center">!</span>}
        </Button>
      </div>

      {/* Filters */}
      {showFilters && (
        <div className="bg-card border border-border rounded-xl p-4 shadow-sm space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Action</label>
              <div className="relative">
                <Input
                  value={action}
                  onChange={e => { setAction(e.target.value); setOffset(0); }}
                  placeholder="e.g. provider.create"
                  className="text-xs"
                  list="action-options"
                />
                <datalist id="action-options">
                  {COMMON_ACTIONS.map(a => <option key={a} value={a} />)}
                </datalist>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Entity Type</label>
              <select
                value={entityType}
                onChange={e => { setEntityType(e.target.value); setOffset(0); }}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-xs ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">All entity types</option>
                {ENTITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Date From</label>
              <Input
                type="datetime-local"
                value={dateFrom}
                onChange={e => { setDateFrom(e.target.value); setOffset(0); }}
                className="text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Date To</label>
              <Input
                type="datetime-local"
                value={dateTo}
                onChange={e => { setDateTo(e.target.value); setOffset(0); }}
                className="text-xs"
              />
            </div>
          </div>
          {hasFilters && (
            <div>
              <button
                onClick={clearFilters}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                <X className="w-3.5 h-3.5" /> Clear all filters
              </button>
            </div>
          )}
        </div>
      )}

      {/* Quick action buttons */}
      <div className="flex flex-wrap gap-2">
        {COMMON_ACTIONS.slice(0, 6).map(a => (
          <button
            key={a}
            onClick={() => { setAction(action === a ? "" : a); setOffset(0); }}
            className={`px-2.5 py-1 rounded text-xs font-mono transition-colors ${
              action === a ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {a}
          </button>
        ))}
      </div>

      {/* Results summary */}
      {logsData && (
        <div className="text-xs text-muted-foreground">
          Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, logsData.total)} of{" "}
          <span className="font-semibold text-foreground">{logsData.total.toLocaleString()}</span> entries
        </div>
      )}

      <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-muted/50 text-xs uppercase font-semibold text-muted-foreground border-b border-border tracking-wider">
              <tr>
                <th className="px-6 py-4">Timestamp</th>
                <th className="px-6 py-4">Admin</th>
                <th className="px-6 py-4">Action</th>
                <th className="px-6 py-4">Entity</th>
                <th className="px-6 py-4">Details</th>
                <th className="px-6 py-4 w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-muted-foreground animate-pulse font-mono text-xs">
                    READING_LEDGER...
                  </td>
                </tr>
              ) : !logsData || logsData.items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-muted-foreground">
                    No audit events {hasFilters ? "matching filters" : "recorded"}.
                  </td>
                </tr>
              ) : (
                logsData.items.map(log => (
                  <React.Fragment key={log.id}>
                    <tr
                      className={`hover:bg-muted/30 transition-colors ${log.details ? "cursor-pointer" : ""}`}
                      onClick={() => log.details && setExpandedId(expandedId === log.id ? null : log.id)}
                    >
                      <td className="px-6 py-4 text-muted-foreground font-mono text-xs whitespace-nowrap">
                        {new Date(log.createdAt).toLocaleString()}
                      </td>
                      <td className="px-6 py-4">
                        <div className="font-medium text-foreground text-xs">{log.adminEmail || "System"}</div>
                        {log.ipAddress && (
                          <div className="text-[10px] font-mono text-muted-foreground mt-0.5">{log.ipAddress}</div>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <span className="font-mono text-xs font-bold text-primary uppercase tracking-wider">
                          {log.action}
                        </span>
                      </td>
                      <td className="px-6 py-4 font-mono text-xs text-muted-foreground">
                        {log.entityType ? `${log.entityType}${log.entityId ? ` #${log.entityId}` : ""}` : "—"}
                      </td>
                      <td className="px-6 py-4 text-xs text-muted-foreground max-w-xs">
                        {log.details ? (
                          <span className="truncate block max-w-[200px]">{log.details}</span>
                        ) : "—"}
                      </td>
                      <td className="px-6 py-4 text-muted-foreground">
                        {log.details && (
                          expandedId === log.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />
                        )}
                      </td>
                    </tr>
                    {expandedId === log.id && log.details && (
                      <tr>
                        <td colSpan={6} className="px-6 py-3 bg-muted/20">
                          <pre className="text-xs font-mono text-muted-foreground overflow-x-auto whitespace-pre-wrap">
                            {(() => { try { return JSON.stringify(JSON.parse(log.details), null, 2); } catch { return log.details; } })()}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {logsData && logsData.total > PAGE_SIZE && (
          <div className="px-6 py-4 border-t border-border flex items-center justify-between">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              disabled={offset === 0}
            >
              ← Previous
            </Button>
            <span className="text-xs text-muted-foreground">
              Page {Math.floor(offset / PAGE_SIZE) + 1} of {Math.ceil(logsData.total / PAGE_SIZE)}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOffset(offset + PAGE_SIZE)}
              disabled={offset + PAGE_SIZE >= logsData.total}
            >
              Next →
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
