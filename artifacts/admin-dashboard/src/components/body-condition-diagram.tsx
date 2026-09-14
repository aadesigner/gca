import { cn } from "@/lib/utils";
import { Car } from "lucide-react";

export type BodyConditionLegend = "Z" | "W" | "R" | "C" | "N" | "P";

export type BodyConditionPanel = {
  key?: string;
  label: string;
  resultCode?: string;
  result?: string;
  legend: BodyConditionLegend;
  legendLabel: string;
  area?: string;
};

export type BodyCondition = {
  date?: string;
  source: string;
  diagnosisNo?: number;
  center?: string;
  legend: Array<{ code: BodyConditionLegend; label: string }>;
  panels: BodyConditionPanel[];
};

const LEGEND_COLORS: Record<BodyConditionLegend, string> = {
  Z: "#dc2626",
  W: "#ea580c",
  R: "#ca8a04",
  C: "#2563eb",
  N: "#7c3aed",
  P: "#db2777",
};

/** Top-down car panel slots (viewBox 0 0 200 360). */
const PANEL_SHAPES: Record<string, string> = {
  FRONT_BUMPER: "M70 28 H130 L138 46 H62 Z",
  HOOD: "M68 48 H132 V110 H68 Z",
  RADIATOR_SUPPORT: "M78 42 H122 V52 H78 Z",
  FRONT_FENDER_LEFT: "M48 52 H68 V118 H42 Z",
  FRONT_FENDER_RIGHT: "M132 52 H152 V118 H132 Z",
  FRONT_DOOR_LEFT: "M42 118 H68 V188 H42 Z",
  FRONT_DOOR_RIGHT: "M132 118 H158 V188 H132 Z",
  BACK_DOOR_LEFT: "M42 188 H68 V250 H42 Z",
  BACK_DOOR_RIGHT: "M132 188 H158 V250 H132 Z",
  REAR_FENDER_LEFT: "M42 250 H68 V300 H48 Z",
  REAR_FENDER_RIGHT: "M132 250 H158 V300 H132 Z",
  ROOF: "M72 120 H128 V210 H72 Z",
  TRUNK_LID: "M70 252 H130 V302 H70 Z",
  REAR_BUMPER: "M62 304 H138 L130 328 H70 Z",
  SIDE_SILL_LEFT: "M38 118 H44 V250 H38 Z",
  SIDE_SILL_RIGHT: "M156 118 H162 V250 H156 Z",
  A_PILLAR_LEFT: "M66 112 H74 V130 H66 Z",
  A_PILLAR_RIGHT: "M126 112 H134 V130 H126 Z",
  B_PILLAR_LEFT: "M66 180 H74 V198 H66 Z",
  B_PILLAR_RIGHT: "M126 180 H134 V198 H126 Z",
  C_PILLAR_LEFT: "M66 240 H74 V258 H66 Z",
  C_PILLAR_RIGHT: "M126 240 H134 V258 H126 Z",
};

const LABEL_POINTS: Record<string, { x: number; y: number }> = {
  HOOD: { x: 100, y: 82 },
  FRONT_FENDER_LEFT: { x: 28, y: 88 },
  FRONT_FENDER_RIGHT: { x: 172, y: 88 },
  FRONT_DOOR_LEFT: { x: 24, y: 155 },
  FRONT_DOOR_RIGHT: { x: 176, y: 155 },
  BACK_DOOR_LEFT: { x: 24, y: 220 },
  BACK_DOOR_RIGHT: { x: 176, y: 220 },
  TRUNK_LID: { x: 100, y: 278 },
  ROOF: { x: 100, y: 168 },
  REAR_FENDER_LEFT: { x: 28, y: 275 },
  REAR_FENDER_RIGHT: { x: 172, y: 275 },
};

function panelByKey(panels: BodyConditionPanel[]): Map<string, BodyConditionPanel> {
  const map = new Map<string, BodyConditionPanel>();
  for (const p of panels) {
    if (p.key) map.set(p.key.toUpperCase(), p);
  }
  return map;
}

export function BodyConditionDiagram({ data }: { data: BodyCondition }) {
  const byKey = panelByKey(data.panels);
  const legend = data.legend?.length
    ? data.legend
    : [
        { code: "Z" as const, label: "Replacement" },
        { code: "W" as const, label: "Painting/Welding" },
        { code: "R" as const, label: "Rust" },
        { code: "C" as const, label: "Scratch" },
        { code: "N" as const, label: "Unevenness" },
        { code: "P" as const, label: "Damage" },
      ];

  return (
    <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
      <div className="px-6 py-3 border-b border-border bg-muted/30 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <Car className="w-4 h-4" />
          Body condition ({data.panels.length})
        </h3>
        <div className="text-xs font-mono text-muted-foreground">
          {[data.date, data.center, data.diagnosisNo != null ? `#${data.diagnosisNo}` : null]
            .filter(Boolean)
            .join(" · ") || data.source}
        </div>
      </div>

      <div className="grid lg:grid-cols-[240px_1fr] gap-6 p-6">
        <div className="flex flex-col items-center gap-4">
          <svg viewBox="0 0 200 360" className="w-full max-w-[220px] h-auto" role="img" aria-label="Body condition diagram">
            <rect x="60" y="24" width="80" height="312" rx="28" className="fill-muted stroke-border" strokeWidth="2" />
            {Object.entries(PANEL_SHAPES).map(([key, d]) => {
              const hit = byKey.get(key);
              return (
                <path
                  key={key}
                  d={d}
                  className={cn(!hit && "fill-background/40 stroke-border/80")}
                  fill={hit ? `${LEGEND_COLORS[hit.legend]}33` : undefined}
                  stroke={hit ? LEGEND_COLORS[hit.legend] : undefined}
                  strokeWidth={hit ? 2.2 : 1}
                />
              );
            })}
            {[...byKey.entries()].map(([key, panel]) => {
              const pt = LABEL_POINTS[key];
              if (!pt) return null;
              return (
                <text
                  key={`lbl-${key}`}
                  x={pt.x}
                  y={pt.y}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize="14"
                  fontWeight="700"
                  fontFamily="ui-monospace, monospace"
                  fill={LEGEND_COLORS[panel.legend]}
                >
                  {panel.legend}
                </text>
              );
            })}
          </svg>

          <div className="w-full grid grid-cols-2 gap-1.5 text-[11px]">
            {legend.map((row) => (
              <div key={row.code} className="flex items-center gap-1.5 font-mono">
                <span
                  className="inline-flex h-5 w-5 items-center justify-center rounded text-[11px] font-bold text-white"
                  style={{ background: LEGEND_COLORS[row.code] }}
                >
                  {row.code}
                </span>
                <span className="text-muted-foreground">{row.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-muted/50 text-xs uppercase font-semibold text-muted-foreground border-b border-border tracking-wider">
              <tr>
                <th className="px-3 py-2">Code</th>
                <th className="px-3 py-2">Panel</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.panels.map((panel, i) => (
                <tr key={`${panel.key ?? panel.label}-${i}`} className="hover:bg-muted/30">
                  <td className="px-3 py-2">
                    <span
                      className="inline-flex h-6 w-6 items-center justify-center rounded text-xs font-bold text-white font-mono"
                      style={{ background: LEGEND_COLORS[panel.legend] }}
                    >
                      {panel.legend}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-medium">{panel.label}</td>
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{panel.legendLabel}</td>
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                    {panel.result ?? panel.resultCode ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
