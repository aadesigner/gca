import { cn } from "@/lib/utils";

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

/** Tuned for light admin surfaces — saturated but not neon. */
const LEGEND_COLORS: Record<BodyConditionLegend, { fill: string; stroke: string; ink: string }> = {
  Z: { fill: "#fecaca", stroke: "#b91c1c", ink: "#7f1d1d" },
  W: { fill: "#ffedd5", stroke: "#c2410c", ink: "#7c2d12" },
  R: { fill: "#fef3c7", stroke: "#a16207", ink: "#713f12" },
  C: { fill: "#dbeafe", stroke: "#1d4ed8", ink: "#1e3a8a" },
  N: { fill: "#e0e7ff", stroke: "#4338ca", ink: "#312e81" },
  P: { fill: "#fce7f3", stroke: "#be185d", ink: "#831843" },
};

const DEFAULT_LEGEND: Array<{ code: BodyConditionLegend; label: string }> = [
  { code: "Z", label: "Replacement" },
  { code: "W", label: "Painting / Welding" },
  { code: "R", label: "Rust" },
  { code: "C", label: "Scratch" },
  { code: "N", label: "Unevenness" },
  { code: "P", label: "Damage" },
];

/** Top-down sedan outline — viewBox 0 0 240 420 */
const PANEL_SHAPES: Record<string, string> = {
  FRONT_BUMPER: "M78 36 C88 28 152 28 162 36 L168 52 H72 Z",
  RADIATOR_SUPPORT: "M92 50 H148 V62 H92 Z",
  HOOD: "M80 58 C88 54 152 54 160 58 L164 118 H76 Z",
  FRONT_FENDER_LEFT: "M52 62 C62 56 78 58 80 70 L76 130 H48 C46 100 46 78 52 62 Z",
  FRONT_FENDER_RIGHT: "M188 62 C178 56 162 58 160 70 L164 130 H192 C194 100 194 78 188 62 Z",
  FRONT_DOOR_LEFT: "M48 128 H78 V198 H46 C46 170 46 148 48 128 Z",
  FRONT_DOOR_RIGHT: "M162 128 H192 V198 H194 C194 170 194 148 192 128 Z",
  BACK_DOOR_LEFT: "M46 196 H78 V266 H48 C46 240 46 214 46 196 Z",
  BACK_DOOR_RIGHT: "M162 196 H194 V266 H192 C194 240 194 214 192 196 Z",
  SIDE_SILL_LEFT: "M42 130 H50 V268 H42 Z",
  SIDE_SILL_RIGHT: "M190 130 H198 V268 H190 Z",
  ROOF: "M84 138 C96 132 144 132 156 138 L158 236 C146 244 94 244 82 236 Z",
  A_PILLAR_LEFT: "M78 122 L90 138 L84 150 L74 134 Z",
  A_PILLAR_RIGHT: "M162 122 L150 138 L156 150 L166 134 Z",
  B_PILLAR_LEFT: "M76 188 H86 V210 H76 Z",
  B_PILLAR_RIGHT: "M154 188 H164 V210 H154 Z",
  C_PILLAR_LEFT: "M78 248 L90 234 L96 248 L84 262 Z",
  C_PILLAR_RIGHT: "M162 248 L150 234 L144 248 L156 262 Z",
  REAR_FENDER_LEFT: "M48 264 H78 L76 318 H54 C48 300 46 280 48 264 Z",
  REAR_FENDER_RIGHT: "M162 264 H192 L186 318 H162 C194 300 194 280 192 264 Z",
  TRUNK_LID: "M80 268 H160 L156 322 H84 Z",
  REAR_BUMPER: "M72 320 H168 L160 348 C140 356 100 356 80 348 Z",
};

const LABEL_POINTS: Record<string, { x: number; y: number }> = {
  HOOD: { x: 120, y: 88 },
  FRONT_FENDER_LEFT: { x: 36, y: 96 },
  FRONT_FENDER_RIGHT: { x: 204, y: 96 },
  FRONT_DOOR_LEFT: { x: 30, y: 164 },
  FRONT_DOOR_RIGHT: { x: 210, y: 164 },
  BACK_DOOR_LEFT: { x: 30, y: 232 },
  BACK_DOOR_RIGHT: { x: 210, y: 232 },
  ROOF: { x: 120, y: 186 },
  TRUNK_LID: { x: 120, y: 296 },
  REAR_FENDER_LEFT: { x: 36, y: 292 },
  REAR_FENDER_RIGHT: { x: 204, y: 292 },
  FRONT_BUMPER: { x: 120, y: 44 },
  REAR_BUMPER: { x: 120, y: 336 },
};

function panelByKey(panels: BodyConditionPanel[]): Map<string, BodyConditionPanel> {
  const map = new Map<string, BodyConditionPanel>();
  for (const p of panels) {
    if (p.key) map.set(p.key.toUpperCase(), p);
  }
  return map;
}

function metaLine(data: BodyCondition): string {
  return (
    [data.date, data.center, data.diagnosisNo != null ? `Diagnosis #${data.diagnosisNo}` : null]
      .filter(Boolean)
      .join(" · ") || data.source
  );
}

export function BodyConditionDiagram({ data }: { data: BodyCondition }) {
  const byKey = panelByKey(data.panels);
  const legend = data.legend?.length ? data.legend : DEFAULT_LEGEND;
  const activeCodes = new Set(data.panels.map((p) => p.legend));

  return (
    <div className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-[0_1px_0_rgba(15,23,42,0.04),0_12px_32px_-18px_rgba(15,23,42,0.28)]">
      <div className="relative overflow-hidden border-b border-border/70 px-5 py-4 sm:px-6">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.55]"
          style={{
            background:
              "radial-gradient(80% 120% at 0% 0%, hsl(var(--muted) / 0.9), transparent 55%), radial-gradient(70% 100% at 100% 0%, hsl(210 40% 96% / 0.9), transparent 50%)",
          }}
        />
        <div className="relative flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Body map
            </p>
            <h3 className="mt-0.5 text-base font-semibold tracking-tight text-foreground">
              Panel condition
              <span className="ml-2 font-normal text-muted-foreground">
                {data.panels.length} marked
              </span>
            </h3>
          </div>
          <p className="max-w-md text-right text-[11px] leading-relaxed text-muted-foreground">
            {metaLine(data)}
          </p>
        </div>
      </div>

      <div className="grid gap-6 p-5 lg:grid-cols-[minmax(220px,280px)_1fr] lg:gap-8 lg:p-6">
        <div className="flex flex-col items-center gap-5">
          <div className="relative w-full max-w-[260px]">
            <div
              aria-hidden
              className="absolute inset-[8%] rounded-[40%] opacity-70 blur-2xl"
              style={{
                background:
                  "radial-gradient(circle at 50% 40%, hsl(210 30% 88% / 0.9), transparent 70%)",
              }}
            />
            <svg
              viewBox="0 0 240 420"
              className="relative z-[1] h-auto w-full drop-shadow-[0_18px_28px_rgba(15,23,42,0.12)]"
              role="img"
              aria-label="Body condition diagram"
            >
              <defs>
                <linearGradient id="bc-body" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#f8fafc" />
                  <stop offset="55%" stopColor="#eef2f7" />
                  <stop offset="100%" stopColor="#e2e8f0" />
                </linearGradient>
                <linearGradient id="bc-glass" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#94a3b8" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="#64748b" stopOpacity="0.18" />
                </linearGradient>
                <filter id="bc-soft" x="-20%" y="-20%" width="140%" height="140%">
                  <feDropShadow dx="0" dy="1" stdDeviation="1.2" floodOpacity="0.12" />
                </filter>
              </defs>

              {/* Soft ground shadow */}
              <ellipse cx="120" cy="392" rx="70" ry="10" fill="#0f172a" opacity="0.06" />

              {/* Outer body shell */}
              <path
                d="M78 34 C96 22 144 22 162 34 L190 68 C198 88 200 120 198 160 L198 268 C200 308 196 336 176 356 L150 378 C136 386 104 386 90 378 L64 356 C44 336 40 308 42 268 L42 160 C40 120 42 88 50 68 Z"
                fill="url(#bc-body)"
                stroke="#94a3b8"
                strokeWidth="1.6"
                filter="url(#bc-soft)"
              />

              {/* Cabin glass */}
              <path
                d="M88 142 C102 134 138 134 152 142 L156 232 C142 244 98 244 84 232 Z"
                fill="url(#bc-glass)"
                stroke="#94a3b8"
                strokeWidth="1"
                opacity="0.95"
              />

              {/* Wheel arches */}
              <path d="M46 96 C40 108 40 128 48 138" fill="none" stroke="#94a3b8" strokeWidth="3" strokeLinecap="round" />
              <path d="M194 96 C200 108 200 128 192 138" fill="none" stroke="#94a3b8" strokeWidth="3" strokeLinecap="round" />
              <path d="M48 278 C40 290 40 310 50 322" fill="none" stroke="#94a3b8" strokeWidth="3" strokeLinecap="round" />
              <path d="M192 278 C200 290 200 310 190 322" fill="none" stroke="#94a3b8" strokeWidth="3" strokeLinecap="round" />

              {/* Quiet baseline panels */}
              {Object.entries(PANEL_SHAPES).map(([key, d]) => {
                const hit = byKey.get(key);
                if (hit) return null;
                return (
                  <path
                    key={`base-${key}`}
                    d={d}
                    fill="#ffffff"
                    fillOpacity="0.28"
                    stroke="#94a3b8"
                    strokeOpacity="0.35"
                    strokeWidth="1"
                  />
                );
              })}

              {/* Marked panels */}
              {Object.entries(PANEL_SHAPES).map(([key, d]) => {
                const hit = byKey.get(key);
                if (!hit) return null;
                const c = LEGEND_COLORS[hit.legend];
                return (
                  <path
                    key={`hit-${key}`}
                    d={d}
                    fill={c.fill}
                    stroke={c.stroke}
                    strokeWidth="2"
                    strokeLinejoin="round"
                  />
                );
              })}

              {/* Legend letters */}
              {[...byKey.entries()].map(([key, panel]) => {
                const pt = LABEL_POINTS[key];
                if (!pt) return null;
                const c = LEGEND_COLORS[panel.legend];
                return (
                  <g key={`lbl-${key}`}>
                    <circle cx={pt.x} cy={pt.y} r="11" fill="#fff" stroke={c.stroke} strokeWidth="1.6" />
                    <text
                      x={pt.x}
                      y={pt.y + 0.5}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize="11"
                      fontWeight="700"
                      fontFamily="ui-sans-serif, system-ui, sans-serif"
                      fill={c.ink}
                    >
                      {panel.legend}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          <div className="grid w-full grid-cols-2 gap-2">
            {legend.map((row) => {
              const c = LEGEND_COLORS[row.code];
              const on = activeCodes.has(row.code);
              return (
                <div
                  key={row.code}
                  className={cn(
                    "flex items-center gap-2 rounded-xl border px-2.5 py-2 transition-opacity",
                    on ? "border-border/80 bg-background" : "border-transparent bg-muted/40 opacity-45",
                  )}
                >
                  <span
                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-bold"
                    style={{ background: c.fill, color: c.ink, boxShadow: `inset 0 0 0 1px ${c.stroke}` }}
                  >
                    {row.code}
                  </span>
                  <span className="text-[11px] font-medium leading-tight text-foreground/80">{row.label}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="min-w-0">
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Findings
            </p>
            <p className="text-[11px] text-muted-foreground">Encar diagnosis / inspection</p>
          </div>

          <ul className="divide-y divide-border/70 overflow-hidden rounded-2xl border border-border/70 bg-background/70">
            {data.panels.map((panel, i) => {
              const c = LEGEND_COLORS[panel.legend];
              return (
                <li
                  key={`${panel.key ?? panel.label}-${i}`}
                  className="flex items-start gap-3 px-3.5 py-3 transition-colors hover:bg-muted/35 sm:px-4"
                >
                  <span
                    className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold"
                    style={{ background: c.fill, color: c.ink, boxShadow: `inset 0 0 0 1px ${c.stroke}` }}
                  >
                    {panel.legend}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <p className="text-sm font-semibold tracking-tight text-foreground">{panel.label}</p>
                      <p className="text-[11px] font-medium" style={{ color: c.stroke }}>
                        {panel.legendLabel}
                      </p>
                    </div>
                    <p className="mt-0.5 text-[12px] text-muted-foreground">
                      {panel.result ?? panel.resultCode ?? "Recorded on inspection"}
                      {panel.area ? ` · ${panel.area}` : ""}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
