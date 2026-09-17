import { useId } from "react";
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
  /** Whole-vehicle stamp (Carstat total loss / flood) when no panel zones are marked. */
  stamp?: string;
  legend: Array<{ code: BodyConditionLegend; label: string }>;
  panels: BodyConditionPanel[];
};

/** Encar-style status colors — saturated fills, dark ink for letters. */
const LEGEND_COLORS: Record<BodyConditionLegend, { fill: string; stroke: string; ink: string; soft: string }> = {
  Z: { fill: "#ef4444", stroke: "#b91c1c", ink: "#fff", soft: "#fee2e2" },
  W: { fill: "#f97316", stroke: "#c2410c", ink: "#fff", soft: "#ffedd5" },
  R: { fill: "#eab308", stroke: "#a16207", ink: "#422006", soft: "#fef9c3" },
  C: { fill: "#3b82f6", stroke: "#1d4ed8", ink: "#fff", soft: "#dbeafe" },
  N: { fill: "#8b5cf6", stroke: "#6d28d9", ink: "#fff", soft: "#ede9fe" },
  P: { fill: "#ec4899", stroke: "#be185d", ink: "#fff", soft: "#fce7f3" },
};

const DEFAULT_LEGEND: Array<{ code: BodyConditionLegend; label: string }> = [
  { code: "Z", label: "Replacement" },
  { code: "W", label: "Panel / weld" },
  { code: "R", label: "Rust" },
  { code: "C", label: "Scratch" },
  { code: "N", label: "Uneven" },
  { code: "P", label: "Damage" },
];

/**
 * Clean top-down sedan — viewBox 0 0 360 720.
 * Centerline x=180. Front axle ~y=200, rear axle ~y=520.
 * Shape matches KR performance-check body maps (Encar-style).
 */
const BODY_OUTLINE = [
  "M132 28",
  "C158 12 202 12 228 28",
  "L248 58",
  "C262 78 270 108 274 140",
  "L276 172",
  // front-right well
  "C254 174 242 186 242 200",
  "C242 218 254 232 276 234",
  "L278 448",
  // rear-right well
  "C256 450 244 470 244 520",
  "C244 542 256 560 278 562",
  "L274 600",
  "C264 640 230 672 192 682",
  "C180 686 164 686 152 682",
  "C114 672 80 640 70 600",
  "L66 562",
  // rear-left well
  "C88 560 100 542 100 520",
  "C100 470 88 450 66 448",
  "L68 234",
  // front-left well
  "C90 232 102 218 102 200",
  "C102 186 90 174 68 172",
  "L70 140",
  "C74 108 82 78 96 58",
  "Z",
].join(" ");

/**
 * Panel tessellation — fitted inside BODY_OUTLINE, no overhang.
 * Left/right follow Korean inspection L/R (driver = left for KR).
 */
const PANEL_SHAPES: Record<string, string> = {
  FRONT_BUMPER: "M132 30 C158 14 202 14 228 30 L244 58 L116 58 Z",

  RADIATOR_SUPPORT: "M116 58 H244 V88 H116 Z",

  HOOD: "M116 88 L244 88 L258 172 L102 172 Z",

  FRONT_FENDER_LEFT:
    "M96 88 L116 88 L102 172 L102 196 L90 196 L86 172 L86 140 C90 112 94 96 96 88 Z",

  FRONT_FENDER_RIGHT:
    "M264 88 L244 88 L258 172 L258 196 L270 196 L274 172 L274 140 C270 112 266 96 264 88 Z",

  A_PILLAR_LEFT: "M102 172 L128 214 L118 222 L102 196 Z",
  A_PILLAR_RIGHT: "M258 172 L232 214 L242 222 L258 196 Z",

  FRONT_DOOR_LEFT: "M90 196 L118 222 L128 222 L122 330 L104 330 L90 234 Z",
  FRONT_DOOR_RIGHT: "M270 196 L242 222 L232 222 L238 330 L256 330 L270 234 Z",

  B_PILLAR_LEFT: "M104 330 H122 V362 H104 Z",
  B_PILLAR_RIGHT: "M238 330 H256 V362 H238 Z",

  BACK_DOOR_LEFT: "M90 362 L122 362 L116 448 L104 448 L90 448 Z",
  BACK_DOOR_RIGHT: "M270 362 L238 362 L244 448 L256 448 L270 448 Z",

  SIDE_SILL_LEFT: "M72 234 H90 V448 H72 Z",
  SIDE_SILL_RIGHT: "M270 234 H288 V448 H270 Z",

  ROOF: "M128 222 L232 222 L238 362 L238 430 L122 430 L122 362 Z",

  C_PILLAR_LEFT: "M104 448 L122 430 L132 448 L116 466 Z",
  C_PILLAR_RIGHT: "M256 448 L238 430 L228 448 L244 466 Z",

  REAR_FENDER_LEFT: "M90 448 L116 466 L128 466 L120 562 L88 562 L78 520 L86 470 Z",
  REAR_FENDER_RIGHT: "M270 448 L244 466 L232 466 L240 562 L272 562 L282 520 L274 470 Z",

  TRUNK_LID: "M128 466 L232 466 L240 590 L120 590 Z",

  REAR_BUMPER: "M120 590 L240 590 L256 622 C220 652 140 652 104 622 Z",
};

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
  QUARTER_PANEL_LEFT: "REAR_FENDER_LEFT",
  QUARTER_PANEL_RIGHT: "REAR_FENDER_RIGHT",
  FRONT_PANEL: "RADIATOR_SUPPORT",
  REAR_PANEL: "TRUNK_LID",
  CROSS_MEMBER: "RADIATOR_SUPPORT",
  ROCKER_LEFT: "SIDE_SILL_LEFT",
  ROCKER_RIGHT: "SIDE_SILL_RIGHT",
};

/** Center of each panel for status letter chip. */
const LABEL_POINTS: Record<string, { x: number; y: number }> = {
  FRONT_BUMPER: { x: 180, y: 44 },
  RADIATOR_SUPPORT: { x: 180, y: 73 },
  HOOD: { x: 180, y: 130 },
  FRONT_FENDER_LEFT: { x: 96, y: 140 },
  FRONT_FENDER_RIGHT: { x: 264, y: 140 },
  FRONT_DOOR_LEFT: { x: 106, y: 270 },
  FRONT_DOOR_RIGHT: { x: 254, y: 270 },
  BACK_DOOR_LEFT: { x: 106, y: 400 },
  BACK_DOOR_RIGHT: { x: 254, y: 400 },
  SIDE_SILL_LEFT: { x: 81, y: 340 },
  SIDE_SILL_RIGHT: { x: 279, y: 340 },
  ROOF: { x: 180, y: 325 },
  A_PILLAR_LEFT: { x: 112, y: 200 },
  A_PILLAR_RIGHT: { x: 248, y: 200 },
  B_PILLAR_LEFT: { x: 113, y: 346 },
  B_PILLAR_RIGHT: { x: 247, y: 346 },
  C_PILLAR_LEFT: { x: 118, y: 448 },
  C_PILLAR_RIGHT: { x: 242, y: 448 },
  TRUNK_LID: { x: 180, y: 528 },
  REAR_FENDER_LEFT: { x: 100, y: 515 },
  REAR_FENDER_RIGHT: { x: 260, y: 515 },
  REAR_BUMPER: { x: 180, y: 612 },
};

const PANEL_DRAW_ORDER = [
  "SIDE_SILL_LEFT",
  "SIDE_SILL_RIGHT",
  "FRONT_BUMPER",
  "RADIATOR_SUPPORT",
  "HOOD",
  "FRONT_FENDER_LEFT",
  "FRONT_FENDER_RIGHT",
  "A_PILLAR_LEFT",
  "A_PILLAR_RIGHT",
  "FRONT_DOOR_LEFT",
  "FRONT_DOOR_RIGHT",
  "B_PILLAR_LEFT",
  "B_PILLAR_RIGHT",
  "BACK_DOOR_LEFT",
  "BACK_DOOR_RIGHT",
  "ROOF",
  "C_PILLAR_LEFT",
  "C_PILLAR_RIGHT",
  "REAR_FENDER_LEFT",
  "REAR_FENDER_RIGHT",
  "TRUNK_LID",
  "REAR_BUMPER",
] as const;

function normalizePanelKey(raw?: string): string | undefined {
  if (!raw) return undefined;
  const key = raw.toUpperCase().trim().replace(/[\s-]+/g, "_");
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
  if (/radiator|support|cross\s*member|front\s*panel/.test(s)) return "RADIATOR_SUPPORT";
  if (/front.*fender|front.*wing|fender.*front/.test(s)) {
    return /right|rh|\(r\)/.test(s) ? "FRONT_FENDER_RIGHT" : "FRONT_FENDER_LEFT";
  }
  if (/rear.*fender|quarter|rear.*wing|fender.*rear/.test(s)) {
    return /right|rh|\(r\)/.test(s) ? "REAR_FENDER_RIGHT" : "REAR_FENDER_LEFT";
  }
  if (/front.*door|door.*front/.test(s)) {
    return /right|rh|\(r\)/.test(s) ? "FRONT_DOOR_RIGHT" : "FRONT_DOOR_LEFT";
  }
  if (/rear.*door|back.*door|door.*rear/.test(s)) {
    return /right|rh|\(r\)/.test(s) ? "BACK_DOOR_RIGHT" : "BACK_DOOR_LEFT";
  }
  if (/front.*bumper|bumper.*front/.test(s)) return "FRONT_BUMPER";
  if (/rear.*bumper|bumper.*rear/.test(s)) return "REAR_BUMPER";
  if (/side\s*sill|rocker/.test(s)) {
    return /right|rh|\(r\)/.test(s) ? "SIDE_SILL_RIGHT" : "SIDE_SILL_LEFT";
  }
  if (/\ba[\s-]?pillar\b/.test(s)) return /right|rh/.test(s) ? "A_PILLAR_RIGHT" : "A_PILLAR_LEFT";
  if (/\bb[\s-]?pillar\b/.test(s)) return /right|rh/.test(s) ? "B_PILLAR_RIGHT" : "B_PILLAR_LEFT";
  if (/\bc[\s-]?pillar\b/.test(s)) return /right|rh/.test(s) ? "C_PILLAR_RIGHT" : "C_PILLAR_LEFT";
  return undefined;
}

function metaLine(data: BodyCondition): string {
  return (
    [
      data.date,
      data.center,
      data.diagnosisNo != null ? `Diagnosis #${data.diagnosisNo}` : null,
      data.stamp && data.panels.length === 0 ? data.stamp : null,
    ]
      .filter(Boolean)
      .join(" · ") || data.source
  );
}

function sourceTitle(data: BodyCondition): string {
  if (/carstat/i.test(data.source)) return "Carstat body map";
  if (/encar/i.test(data.source)) return "Encar body map";
  return "Body map";
}

function findingsLabel(data: BodyCondition): string {
  if (/carstat/i.test(data.source)) return "Seller damage";
  return "Encar diagnosis";
}

function Tire({ cx, cy }: { cx: number; cy: number }) {
  return (
    <g>
      <ellipse cx={cx} cy={cy + 1.5} rx="20" ry="38" fill="#0f172a" opacity="0.12" />
      <ellipse cx={cx} cy={cy} rx="18" ry="36" fill="#1e293b" stroke="#0f172a" strokeWidth="1.4" />
      <ellipse cx={cx} cy={cy} rx="11" ry="22" fill="#334155" />
      <ellipse cx={cx} cy={cy} rx="5.5" ry="11" fill="#94a3b8" opacity="0.55" />
    </g>
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
  const clearMap = Boolean(data.allClear && data.panels.length === 0);
  const stampOnly = Boolean(data.stamp && data.panels.length === 0 && !clearMap);
  const uid = useId().replace(/:/g, "");

  return (
    <div className="overflow-hidden rounded-xl border border-border/70 bg-card">
      <div className="flex flex-wrap items-end justify-between gap-2 border-b border-border/60 px-4 py-3 sm:px-5">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {sourceTitle(data)}
          </p>
          <h3 className="mt-0.5 text-[15px] font-semibold tracking-tight text-foreground">
            Panel condition
            <span className="ml-2 text-[13px] font-normal text-muted-foreground">
              {clearMap
                ? "all clear"
                : stampOnly
                  ? data.stamp
                  : `${data.panels.length} marked`}
            </span>
          </h3>
        </div>
        <p className="max-w-sm text-right text-[11px] leading-snug text-muted-foreground">{metaLine(data)}</p>
      </div>

      <div className="grid gap-5 p-4 lg:grid-cols-[minmax(280px,340px)_1fr] lg:gap-7 lg:p-5">
        <div className="flex flex-col items-center gap-4">
          <div className="relative w-full max-w-[320px]">
            <svg
              viewBox="0 0 360 720"
              className="relative z-[1] h-auto w-full"
              role="img"
              aria-label="Top-down car body condition diagram"
            >
              <defs>
                <linearGradient id={`${uid}-paint`} x1="0.15" y1="0" x2="0.85" y2="1">
                  <stop offset="0%" stopColor="#f1f5f9" />
                  <stop offset="45%" stopColor="#e2e8f0" />
                  <stop offset="100%" stopColor="#cbd5e1" />
                </linearGradient>
                <linearGradient id={`${uid}-glass`} x1="0.3" y1="0" x2="0.7" y2="1">
                  <stop offset="0%" stopColor="#94a3b8" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="#475569" stopOpacity="0.18" />
                </linearGradient>
                <linearGradient id={`${uid}-ok`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#bbf7d0" stopOpacity="0.55" />
                  <stop offset="100%" stopColor="#86efac" stopOpacity="0.25" />
                </linearGradient>
                <clipPath id={`${uid}-clip`}>
                  <path d={BODY_OUTLINE} />
                </clipPath>
              </defs>

              <text
                x="180"
                y="14"
                textAnchor="middle"
                fontSize="9"
                fontWeight="700"
                letterSpacing="0.32em"
                fill="#94a3b8"
              >
                FRONT
              </text>
              <text
                x="180"
                y="712"
                textAnchor="middle"
                fontSize="9"
                fontWeight="700"
                letterSpacing="0.32em"
                fill="#94a3b8"
              >
                REAR
              </text>

              <ellipse cx="180" cy="692" rx="100" ry="10" fill="#0f172a" opacity="0.06" />

              <Tire cx={58} cy={200} />
              <Tire cx={302} cy={200} />
              <Tire cx={58} cy={520} />
              <Tire cx={302} cy={520} />

              <path
                d={BODY_OUTLINE}
                fill={`url(#${uid}-paint)`}
                stroke="#334155"
                strokeWidth="2.1"
              />

              {/* Wheel-arch lips */}
              <g fill="none" stroke="#0f172a" strokeWidth="2.2" strokeLinecap="round" opacity="0.28">
                <path d="M102 172 C88 182 84 192 84 200 C84 214 90 226 104 234" />
                <path d="M258 172 C272 182 276 192 276 200 C276 214 270 226 256 234" />
                <path d="M100 448 C86 460 82 488 82 520 C82 538 88 552 104 562" />
                <path d="M260 448 C274 460 278 488 278 520 C278 538 272 552 256 562" />
              </g>

              {/* Headlights */}
              <path d="M118 48 C132 34 146 38 150 52 L134 66 Z" fill="#e2e8f0" stroke="#94a3b8" strokeWidth="0.9" />
              <path d="M242 48 C228 34 214 38 210 52 L226 66 Z" fill="#e2e8f0" stroke="#94a3b8" strokeWidth="0.9" />

              {/* Mirrors */}
              <path
                d="M90 196 L66 188 C56 184 50 192 52 202 C54 212 64 216 74 210 L90 206 Z"
                fill="#e2e8f0"
                stroke="#334155"
                strokeWidth="1.15"
              />
              <path
                d="M270 196 L294 188 C304 184 310 192 308 202 C306 212 296 216 286 210 L270 206 Z"
                fill="#e2e8f0"
                stroke="#334155"
                strokeWidth="1.15"
              />

              <g clipPath={`url(#${uid}-clip)`}>
                {PANEL_DRAW_ORDER.map((key) => {
                  if (byKey.has(key)) return null;
                  return (
                    <path
                      key={`base-${key}`}
                      d={PANEL_SHAPES[key]}
                      fill={clearMap ? `url(#${uid}-ok)` : "#f8fafc"}
                      fillOpacity={clearMap ? 1 : 0.85}
                      stroke="#64748b"
                      strokeOpacity="0.55"
                      strokeWidth="1.05"
                      strokeLinejoin="round"
                    />
                  );
                })}

                {PANEL_DRAW_ORDER.map((key) => {
                  const hit = byKey.get(key);
                  if (!hit) return null;
                  const c = LEGEND_COLORS[hit.legend];
                  return (
                    <path
                      key={`hit-${key}`}
                      d={PANEL_SHAPES[key]}
                      fill={c.soft}
                      stroke={c.stroke}
                      strokeWidth="2.1"
                      strokeLinejoin="round"
                    >
                      <title>{`${hit.label} — ${hit.legendLabel}`}</title>
                    </path>
                  );
                })}

                {/* Cabin glass — kept translucent so marked roof still reads */}
                <path
                  d="M128 222 L232 222 L236 250 L124 250 Z"
                  fill={`url(#${uid}-glass)`}
                  stroke="#64748b"
                  strokeWidth="0.9"
                  opacity="0.85"
                />
                <path
                  d="M128 250 L232 250 L232 400 L128 400 Z"
                  fill={`url(#${uid}-glass)`}
                  stroke="#64748b"
                  strokeWidth="0.8"
                  opacity="0.35"
                />
                <path
                  d="M128 400 L232 400 L226 430 L134 430 Z"
                  fill={`url(#${uid}-glass)`}
                  stroke="#64748b"
                  strokeWidth="0.9"
                  opacity="0.85"
                />

                {/* Side glass */}
                <path d="M100 230 L120 234 L116 310 L102 306 Z" fill="#94a3b8" opacity="0.22" />
                <path d="M260 230 L240 234 L244 310 L258 306 Z" fill="#94a3b8" opacity="0.22" />
                <path d="M100 372 L118 376 L114 436 L102 430 Z" fill="#94a3b8" opacity="0.22" />
                <path d="M260 372 L242 376 L246 436 L258 430 Z" fill="#94a3b8" opacity="0.22" />

                {/* Door handles */}
                <rect x="108" y="278" width="11" height="2.8" rx="1.2" fill="#475569" opacity="0.5" />
                <rect x="241" y="278" width="11" height="2.8" rx="1.2" fill="#475569" opacity="0.5" />
                <rect x="108" y="392" width="11" height="2.8" rx="1.2" fill="#475569" opacity="0.5" />
                <rect x="241" y="392" width="11" height="2.8" rx="1.2" fill="#475569" opacity="0.5" />

                {/* Tail lights */}
                <path d="M128 598 C140 618 152 614 156 602 L142 588 Z" fill="#f87171" opacity="0.75" />
                <path d="M232 598 C220 618 208 614 204 602 L218 588 Z" fill="#f87171" opacity="0.75" />
              </g>

              {/* Status letter chips — only on marked panels */}
              {[...byKey.entries()].map(([key, panel]) => {
                const pt = LABEL_POINTS[key];
                if (!pt || !PANEL_SHAPES[key]) return null;
                const c = LEGEND_COLORS[panel.legend];
                const r = key.includes("PILLAR") || key.includes("SILL") ? 9 : 11;
                return (
                  <g key={`lbl-${key}`}>
                    <circle cx={pt.x} cy={pt.y} r={r} fill={c.fill} stroke="#fff" strokeWidth="1.6" />
                    <text
                      x={pt.x}
                      y={pt.y + 0.5}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize={r > 10 ? 11 : 9}
                      fontWeight="800"
                      fill={c.ink}
                    >
                      {panel.legend}
                    </text>
                  </g>
                );
              })}

              {clearMap ? (
                <g>
                  <circle cx="180" cy="330" r="26" fill="#ecfdf5" stroke="#059669" strokeWidth="2.2" />
                  <path
                    d="M166 330 L176 340 L196 316"
                    fill="none"
                    stroke="#059669"
                    strokeWidth="3.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </g>
              ) : null}

              {stampOnly && data.stamp ? (
                <g>
                  <rect
                    x="70"
                    y="300"
                    width="220"
                    height="56"
                    rx="10"
                    fill="#fef2f2"
                    stroke="#b91c1c"
                    strokeWidth="2.2"
                    opacity="0.96"
                  />
                  <text
                    x="180"
                    y="334"
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize="18"
                    fontWeight="800"
                    fill="#991b1b"
                    letterSpacing="0.04em"
                  >
                    {data.stamp.toUpperCase()}
                  </text>
                </g>
              ) : null}
            </svg>
          </div>

          <div className="grid w-full grid-cols-2 gap-1.5 sm:grid-cols-3">
            {legend.map((row) => {
              const c = LEGEND_COLORS[row.code];
              const on = activeCodes.has(row.code);
              return (
                <div
                  key={row.code}
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-2 py-1.5 transition-opacity",
                    on ? "bg-muted/60" : "opacity-35",
                  )}
                >
                  <span
                    className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-extrabold"
                    style={{ background: c.fill, color: c.ink }}
                  >
                    {row.code}
                  </span>
                  <span className="text-[11px] font-medium leading-tight text-foreground/75">{row.label}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="min-w-0">
          <div className="mb-2.5 flex items-center justify-between gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Findings
            </p>
            <p className="text-[11px] text-muted-foreground">{findingsLabel(data)}</p>
          </div>

          <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60">
            {data.panels.length === 0 ? (
              <li className="px-3.5 py-4 text-sm text-muted-foreground">
                {data.allClear
                  ? "All body panels reported normal — clean map."
                  : data.stamp
                    ? `Seller stamp: ${data.stamp} — no panel zones marked on the listing.`
                    : "No marked panels on this report."}
              </li>
            ) : (
              data.panels.map((panel, i) => {
                const c = LEGEND_COLORS[panel.legend];
                return (
                  <li
                    key={`${panel.key ?? panel.label}-${i}`}
                    className="flex items-start gap-3 px-3.5 py-2.5 hover:bg-muted/30 sm:px-4"
                  >
                    <span
                      className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-[11px] font-extrabold"
                      style={{ background: c.fill, color: c.ink }}
                    >
                      {panel.legend}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                        <p className="text-sm font-semibold tracking-tight text-foreground">{panel.label}</p>
                        <p className="text-[11px] font-semibold" style={{ color: c.stroke }}>
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
            <p className="mt-2.5 text-[11px] text-muted-foreground">
              {unmapped.length} finding{unmapped.length === 1 ? "" : "s"} without a matching panel slot.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
