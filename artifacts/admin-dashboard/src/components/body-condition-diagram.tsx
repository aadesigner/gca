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
  allClear?: boolean;
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

/**
 * Top-down sedan — viewBox 0 0 300 560.
 * Paths are fitted to a real car outline (bumper → hood → cabin → trunk).
 */
const PANEL_SHAPES: Record<string, string> = {
  FRONT_BUMPER:
    "M108 28 C128 18 172 18 192 28 L208 48 C200 56 100 56 92 48 Z",
  RADIATOR_SUPPORT: "M118 50 H182 V66 H118 Z",
  HOOD:
    "M104 64 C118 56 182 56 196 64 L204 148 C188 156 112 156 96 148 Z",
  FRONT_FENDER_LEFT:
    "M72 78 C84 62 102 66 106 82 L100 150 C88 156 74 148 70 132 C66 112 66 94 72 78 Z",
  FRONT_FENDER_RIGHT:
    "M228 78 C216 62 198 66 194 82 L200 150 C212 156 226 148 230 132 C234 112 234 94 228 78 Z",
  FRONT_DOOR_LEFT:
    "M68 152 C78 148 98 148 102 154 L100 248 C88 254 72 250 68 236 Z",
  FRONT_DOOR_RIGHT:
    "M232 152 C222 148 202 148 198 154 L200 248 C212 254 228 250 232 236 Z",
  BACK_DOOR_LEFT:
    "M68 250 C78 246 98 246 100 252 L98 338 C86 346 70 340 68 324 Z",
  BACK_DOOR_RIGHT:
    "M232 250 C222 246 202 246 200 252 L202 338 C214 346 230 340 232 324 Z",
  SIDE_SILL_LEFT: "M62 158 H72 V330 H62 Z",
  SIDE_SILL_RIGHT: "M228 158 H238 V330 H228 Z",
  ROOF:
    "M112 178 C130 168 170 168 188 178 L194 318 C176 332 124 332 106 318 Z",
  A_PILLAR_LEFT: "M102 156 L116 176 L108 186 L96 166 Z",
  A_PILLAR_RIGHT: "M198 156 L184 176 L192 186 L204 166 Z",
  B_PILLAR_LEFT: "M100 246 H112 V268 H100 Z",
  B_PILLAR_RIGHT: "M188 246 H200 V268 H188 Z",
  C_PILLAR_LEFT: "M104 318 L118 300 L126 316 L112 332 Z",
  C_PILLAR_RIGHT: "M196 318 L182 300 L174 316 L188 332 Z",
  REAR_FENDER_LEFT:
    "M70 336 C82 330 100 332 102 346 L96 422 C84 430 70 420 66 400 C62 376 64 350 70 336 Z",
  REAR_FENDER_RIGHT:
    "M230 336 C218 330 200 332 198 346 L204 422 C216 430 230 420 234 400 C238 376 236 350 230 336 Z",
  TRUNK_LID:
    "M108 342 C124 334 176 334 192 342 L198 428 C180 440 120 440 102 428 Z",
  REAR_BUMPER:
    "M100 430 C120 444 180 444 200 430 L210 452 C180 468 120 468 90 452 Z",
};

/** Alias Encar / older keys onto the diagram slots. */
const KEY_ALIASES: Record<string, string> = {
  REAR_DOOR_LEFT: "BACK_DOOR_LEFT",
  REAR_DOOR_RIGHT: "BACK_DOOR_RIGHT",
  TRUNK: "TRUNK_LID",
  BONNET: "HOOD",
  FRONT_WING_LEFT: "FRONT_FENDER_LEFT",
  FRONT_WING_RIGHT: "FRONT_FENDER_RIGHT",
  REAR_WING_LEFT: "REAR_FENDER_LEFT",
  REAR_WING_RIGHT: "REAR_FENDER_RIGHT",
  REAR_QUARTER_LEFT: "REAR_FENDER_LEFT",
  REAR_QUARTER_RIGHT: "REAR_FENDER_RIGHT",
};

const LABEL_POINTS: Record<string, { x: number; y: number }> = {
  FRONT_BUMPER: { x: 150, y: 38 },
  HOOD: { x: 150, y: 108 },
  FRONT_FENDER_LEFT: { x: 48, y: 118 },
  FRONT_FENDER_RIGHT: { x: 252, y: 118 },
  FRONT_DOOR_LEFT: { x: 42, y: 200 },
  FRONT_DOOR_RIGHT: { x: 258, y: 200 },
  BACK_DOOR_LEFT: { x: 42, y: 292 },
  BACK_DOOR_RIGHT: { x: 258, y: 292 },
  ROOF: { x: 150, y: 248 },
  TRUNK_LID: { x: 150, y: 386 },
  REAR_FENDER_LEFT: { x: 48, y: 380 },
  REAR_FENDER_RIGHT: { x: 252, y: 380 },
  REAR_BUMPER: { x: 150, y: 448 },
  SIDE_SILL_LEFT: { x: 36, y: 244 },
  SIDE_SILL_RIGHT: { x: 264, y: 244 },
};

function normalizePanelKey(raw?: string): string | undefined {
  if (!raw) return undefined;
  const key = raw.toUpperCase().trim();
  return KEY_ALIASES[key] ?? key;
}

function panelByKey(panels: BodyConditionPanel[]): Map<string, BodyConditionPanel> {
  const map = new Map<string, BodyConditionPanel>();
  for (const p of panels) {
    const key = normalizePanelKey(p.key) ?? normalizePanelKey(guessKeyFromLabel(p.label));
    if (key) map.set(key, p);
  }
  return map;
}

function guessKeyFromLabel(label: string): string | undefined {
  const s = label.toLowerCase();
  if (/hood|bonnet/.test(s)) return "HOOD";
  if (/trunk|tailgate|boot/.test(s)) return "TRUNK_LID";
  if (/roof/.test(s)) return "ROOF";
  if (/front.*fender|front.*wing/.test(s)) {
    return /right|rh|\(r\)/.test(s) ? "FRONT_FENDER_RIGHT" : "FRONT_FENDER_LEFT";
  }
  if (/rear.*fender|quarter|rear.*wing/.test(s)) {
    return /right|rh|\(r\)/.test(s) ? "REAR_FENDER_RIGHT" : "REAR_FENDER_LEFT";
  }
  if (/front.*door/.test(s)) {
    return /right|rh|\(r\)/.test(s) ? "FRONT_DOOR_RIGHT" : "FRONT_DOOR_LEFT";
  }
  if (/rear.*door|back.*door/.test(s)) {
    return /right|rh|\(r\)/.test(s) ? "BACK_DOOR_RIGHT" : "BACK_DOOR_LEFT";
  }
  if (/front.*bumper/.test(s)) return "FRONT_BUMPER";
  if (/rear.*bumper/.test(s)) return "REAR_BUMPER";
  if (/side\s*sill|rocker/.test(s)) {
    return /right|rh|\(r\)/.test(s) ? "SIDE_SILL_RIGHT" : "SIDE_SILL_LEFT";
  }
  return undefined;
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
  const unmapped = data.panels.filter((p) => {
    const key = normalizePanelKey(p.key) ?? guessKeyFromLabel(p.label);
    return !key || !PANEL_SHAPES[key];
  });

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
                {data.allClear && data.panels.length === 0
                  ? "all clear"
                  : `${data.panels.length} marked`}
              </span>
            </h3>
          </div>
          <p className="max-w-md text-right text-[11px] leading-relaxed text-muted-foreground">
            {metaLine(data)}
          </p>
        </div>
      </div>

      <div className="grid gap-6 p-5 lg:grid-cols-[minmax(240px,300px)_1fr] lg:gap-8 lg:p-6">
        <div className="flex flex-col items-center gap-5">
          <div className="relative w-full max-w-[280px]">
            <div
              aria-hidden
              className="absolute inset-[6%] rounded-[42%] opacity-80 blur-2xl"
              style={{
                background:
                  "radial-gradient(circle at 50% 42%, hsl(210 35% 86% / 0.95), transparent 68%)",
              }}
            />
            <svg
              viewBox="0 0 300 560"
              className="relative z-[1] h-auto w-full drop-shadow-[0_20px_32px_rgba(15,23,42,0.14)]"
              role="img"
              aria-label="Car body condition diagram"
            >
              <defs>
                <linearGradient id="bc-paint" x1="0.15" y1="0" x2="0.9" y2="1">
                  <stop offset="0%" stopColor="#f8fafc" />
                  <stop offset="45%" stopColor="#e8eef5" />
                  <stop offset="100%" stopColor="#d5dee8" />
                </linearGradient>
                <linearGradient id="bc-glass" x1="0" y1="0" x2="0.2" y2="1">
                  <stop offset="0%" stopColor="#9db4cc" stopOpacity="0.55" />
                  <stop offset="55%" stopColor="#7f95ad" stopOpacity="0.32" />
                  <stop offset="100%" stopColor="#64748b" stopOpacity="0.22" />
                </linearGradient>
                <linearGradient id="bc-tire" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#1e293b" />
                  <stop offset="50%" stopColor="#334155" />
                  <stop offset="100%" stopColor="#1e293b" />
                </linearGradient>
                <filter id="bc-soft" x="-25%" y="-25%" width="150%" height="150%">
                  <feDropShadow dx="0" dy="2" stdDeviation="1.6" floodOpacity="0.14" />
                </filter>
                <filter id="bc-panel" x="-10%" y="-10%" width="120%" height="120%">
                  <feDropShadow dx="0" dy="0.5" stdDeviation="0.6" floodOpacity="0.1" />
                </filter>
              </defs>

              {/* Ground shadow */}
              <ellipse cx="150" cy="528" rx="88" ry="12" fill="#0f172a" opacity="0.07" />

              {/* Outer body shell — sedan */}
              <path
                d="M108 26
                   C132 12 168 12 192 26
                   L228 70
                   C242 98 246 132 244 168
                   L244 360
                   C246 404 240 444 214 476
                   L186 514
                   C170 528 130 528 114 514
                   L86 476
                   C60 444 54 404 56 360
                   L56 168
                   C54 132 58 98 72 70
                   Z"
                fill="url(#bc-paint)"
                stroke="#64748b"
                strokeWidth="2"
                filter="url(#bc-soft)"
              />

              {/* Headlight strips */}
              <path d="M96 52 C108 44 120 48 124 56 L108 68 Z" fill="#cbd5e1" stroke="#94a3b8" strokeWidth="0.8" />
              <path d="M204 52 C192 44 180 48 176 56 L192 68 Z" fill="#cbd5e1" stroke="#94a3b8" strokeWidth="0.8" />

              {/* Side mirrors */}
              <ellipse cx="58" cy="168" rx="12" ry="7" fill="#e2e8f0" stroke="#64748b" strokeWidth="1.2" />
              <ellipse cx="242" cy="168" rx="12" ry="7" fill="#e2e8f0" stroke="#64748b" strokeWidth="1.2" />

              {/* Wheels */}
              <ellipse cx="58" cy="118" rx="16" ry="28" fill="url(#bc-tire)" opacity="0.92" />
              <ellipse cx="242" cy="118" rx="16" ry="28" fill="url(#bc-tire)" opacity="0.92" />
              <ellipse cx="58" cy="386" rx="16" ry="28" fill="url(#bc-tire)" opacity="0.92" />
              <ellipse cx="242" cy="386" rx="16" ry="28" fill="url(#bc-tire)" opacity="0.92" />
              <ellipse cx="58" cy="118" rx="7" ry="12" fill="#94a3b8" opacity="0.35" />
              <ellipse cx="242" cy="118" rx="7" ry="12" fill="#94a3b8" opacity="0.35" />
              <ellipse cx="58" cy="386" rx="7" ry="12" fill="#94a3b8" opacity="0.35" />
              <ellipse cx="242" cy="386" rx="7" ry="12" fill="#94a3b8" opacity="0.35" />

              {/* Wheel arch lips */}
              <path d="M74 88 C64 100 62 136 74 150" fill="none" stroke="#475569" strokeWidth="2.4" strokeLinecap="round" />
              <path d="M226 88 C236 100 238 136 226 150" fill="none" stroke="#475569" strokeWidth="2.4" strokeLinecap="round" />
              <path d="M74 356 C64 368 62 404 74 418" fill="none" stroke="#475569" strokeWidth="2.4" strokeLinecap="round" />
              <path d="M226 356 C236 368 238 404 226 418" fill="none" stroke="#475569" strokeWidth="2.4" strokeLinecap="round" />

              {/* Cabin glass */}
              <path
                d="M114 176 C132 166 168 166 186 176 L192 316 C174 330 126 330 108 316 Z"
                fill="url(#bc-glass)"
                stroke="#64748b"
                strokeWidth="1.2"
              />
              {/* Windshield highlight */}
              <path
                d="M118 180 C134 172 166 172 182 180 L184 206 C168 198 132 198 116 206 Z"
                fill="#ffffff"
                opacity="0.22"
              />

              {/* Quiet baseline panels */}
              {Object.entries(PANEL_SHAPES).map(([key, d]) => {
                if (byKey.has(key)) return null;
                return (
                  <path
                    key={`base-${key}`}
                    d={d}
                    fill="#ffffff"
                    fillOpacity="0.22"
                    stroke="#64748b"
                    strokeOpacity="0.28"
                    strokeWidth="1"
                    filter="url(#bc-panel)"
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
                    strokeWidth="2.2"
                    strokeLinejoin="round"
                    filter="url(#bc-panel)"
                  />
                );
              })}

              {/* Door seam lines (subtle, always on for car realism) */}
              <path d="M102 154 L100 248" fill="none" stroke="#64748b" strokeOpacity="0.35" strokeWidth="1" />
              <path d="M198 154 L200 248" fill="none" stroke="#64748b" strokeOpacity="0.35" strokeWidth="1" />
              <path d="M100 252 L98 336" fill="none" stroke="#64748b" strokeOpacity="0.35" strokeWidth="1" />
              <path d="M200 252 L202 336" fill="none" stroke="#64748b" strokeOpacity="0.35" strokeWidth="1" />
              {/* Hood / trunk crease */}
              <path d="M150 68 L150 146" fill="none" stroke="#94a3b8" strokeOpacity="0.35" strokeWidth="1" strokeDasharray="3 4" />
              <path d="M150 348 L150 424" fill="none" stroke="#94a3b8" strokeOpacity="0.35" strokeWidth="1" strokeDasharray="3 4" />

              {/* Taillight strips */}
              <path d="M108 436 C118 448 130 446 134 438 L118 426 Z" fill="#fca5a5" opacity="0.55" />
              <path d="M192 436 C182 448 170 446 166 438 L182 426 Z" fill="#fca5a5" opacity="0.55" />

              {/* Legend letter badges */}
              {[...byKey.entries()].map(([key, panel]) => {
                const pt = LABEL_POINTS[key];
                if (!pt || !PANEL_SHAPES[key]) return null;
                const c = LEGEND_COLORS[panel.legend];
                return (
                  <g key={`lbl-${key}`}>
                    <circle cx={pt.x} cy={pt.y} r="12" fill="#fff" stroke={c.stroke} strokeWidth="1.8" />
                    <text
                      x={pt.x}
                      y={pt.y + 0.5}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize="12"
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
            {data.panels.length === 0 ? (
              <li className="px-3.5 py-4 text-sm text-muted-foreground sm:px-4">
                {data.allClear
                  ? "Encar diagnosis lists all body panels as normal — clean map."
                  : "No marked panels on this report."}
              </li>
            ) : (
              data.panels.map((panel, i) => {
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
            })
            )}
          </ul>

          {unmapped.length > 0 ? (
            <p className="mt-3 text-[11px] text-muted-foreground">
              {unmapped.length} finding{unmapped.length === 1 ? "" : "s"} listed without a matching body
              panel slot.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
