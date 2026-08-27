import React from "react";
import { Database } from "lucide-react";

export default function RawData() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Raw Data Inspector</h1>
        <p className="text-muted-foreground text-sm mt-1">Inspect unstructured payload dumps.</p>
      </div>

      <div className="min-h-[400px] border border-dashed border-border rounded-xl flex flex-col items-center justify-center text-center p-8 bg-card/50">
        <div className="w-12 h-12 bg-muted rounded-full flex items-center justify-center mb-4">
          <Database className="w-6 h-6 text-muted-foreground" />
        </div>
        <h2 className="text-lg font-semibold text-foreground mb-2">Raw Data Viewer Offline</h2>
        <p className="text-muted-foreground text-sm max-w-md">
          Direct access to the S3 data lake via the dashboard is currently disabled. Use the CLI tooling for raw payload inspection until the visualizer is integrated.
        </p>
      </div>
    </div>
  );
}
