import React, { useState } from "react";
import { useListApiLogs, useListApiClients } from "@workspace/api-client-react";
import { Activity, Clock } from "lucide-react";

export default function ApiLogs() {
  const searchParams = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const [filterClientId, setFilterClientId] = useState<string>(searchParams.get("clientId") || "");
  const { data: clients } = useListApiClients();
  const { data: logsData, isLoading } = useListApiLogs({ 
    clientId: filterClientId ? parseInt(filterClientId) : undefined,
    limit: 100 
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">API Request Logs</h1>
          <p className="text-muted-foreground text-sm mt-1">Real-time observability of gateway traffic.</p>
        </div>
      </div>

      <div className="flex items-center gap-4 bg-card p-4 rounded-xl border border-border shadow-sm">
        <select 
          className="flex h-10 w-[300px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          value={filterClientId}
          onChange={e => setFilterClientId(e.target.value)}
        >
          <option value="">All Clients</option>
          {clients?.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-muted/50 text-xs uppercase font-semibold text-muted-foreground border-b border-border tracking-wider">
              <tr>
                <th className="px-6 py-4">Timestamp</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">VIN</th>
                <th className="px-6 py-4">Method & Path</th>
                <th className="px-6 py-4">Client</th>
                <th className="px-6 py-4 text-right">Latency</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-muted-foreground animate-pulse font-mono text-xs">
                    STREAMING_LOGS...
                  </td>
                </tr>
              ) : !logsData || logsData.items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-muted-foreground">
                    No logs found.
                  </td>
                </tr>
              ) : (
                logsData.items.map(log => (
                  <tr key={log.id} className="hover:bg-muted/30 transition-colors font-mono">
                    <td className="px-6 py-3 text-muted-foreground text-xs">
                      {new Date(log.requestedAt).toISOString()}
                    </td>
                    <td className="px-6 py-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        log.statusCode >= 500 ? 'bg-red-100 text-red-700' :
                        log.statusCode >= 400 ? 'bg-amber-100 text-amber-700' :
                        'bg-green-100 text-green-700'
                      }`}>
                        {log.statusCode}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-xs text-muted-foreground">
                      {(log as any).vin || <span className="text-muted-foreground/40">—</span>}
                    </td>
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-bold ${
                          log.method === 'GET' ? 'text-blue-500' :
                          log.method === 'POST' ? 'text-green-500' :
                          'text-amber-500'
                        }`}>{log.method}</span>
                        <span className="text-foreground truncate max-w-[300px]">{log.path}</span>
                      </div>
                    </td>
                    <td className="px-6 py-3 text-xs">
                      {log.clientName || '-'}
                    </td>
                    <td className="px-6 py-3 text-right text-muted-foreground text-xs">
                      {log.durationMs}ms
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
