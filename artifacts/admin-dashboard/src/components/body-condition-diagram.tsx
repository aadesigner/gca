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

/** Inspection-report palette — solid marks, no neon / purple. */
const LEGEND_COLORS: Record<
  BodyConditionLegend,
  { fill: string; stroke: string; ink: string; soft: string }
> = {
  Z: { fill: "#dc2626", stroke: "#991b1b", ink: "#fff", soft: "#fecaca" },
  W: { fill: "#ea580c", stroke: "#9a3412", ink: "#fff", soft: "#fed7aa" },
  R: { fill: "#ca8a04", stroke: "#854d0e", ink: "#fff", soft: "#fef08a" },
  C: { fill: "#2563eb", stroke: "#1e40af", ink: "#fff", soft: "#bfdbfe" },
  N: { fill: "#0d9488", stroke: "#115e59", ink: "#fff", soft: "#99f6e4" },
  P: { fill: "#be123c", stroke: "#9f1239", ink: "#fff", soft: "#fecdd3" },
};

const DEFAULT_LEGEND: Array<{ code: BodyConditionLegend; label: string }> = [
  { code: "Z", label: "Replacement" },
  { code: "W", label: "Panel / weld" },
  { code: "R", label: "Rust" },
  { code: "C", label: "Scratch" },
  { code: "N", label: "Uneven" },
  { code: "P", label: "Damage" },
];

/** Clean top-down sedan — viewBox 0 0 320 640. Centerline x=160. */
const BODY_OUTLINE = [
  "M118 24",
  "C140 10 180 10 202 24",
  "L220 52",
  "C232 72 238 100 240 128",
  "L242 156",
  "C222 158 212 168 212 180",
  "C212 196 222 208 242 210",
  "L244 400",
  "C224 402 214 420 214 460",
  "C214 480 224 496 244 498",
  "L240 536",
  "C232 572 200 602 168 610",
  "C160 612 146 612 138 610",
  "C106 602 74 572 66 536",
  "L62 498",
  "C82 496 92 480 92 460",
  "C92 420 82 402 62 400",
  "L64 210",
  "C84 208 94 196 94 180",
  "C94 168 84 158 64 156",
  "L66 128",
  "C68 100 74 72 86 52",
  "Z",
].join(" ");

const PANEL_SHAPES: Record<string, string> = {
  FRONT_BUMPER: "M118 26 C140 12 180 12 202 26 L218 52 L102 52 Z",
  RADIATOR_SUPPORT: "M102 52 H218 V78 H102 Z",
  HOOD: "M102 78 L218 78 L232 156 L88 156 Z",
  FRONT_FENDER_LEFT: "M86 78 L102 78 L88 156 L88 176 L78 176 L74 156 L74 124 C78 100 82 86 86 78 Z",
  FRONT_FENDER_RIGHT: "M234 78 L218 78 L232 156 L232 176 L242 176 L246 156 L246 124 C242 100 238 86 234 78 Z",
  A_PILLAR_LEFT: "M88 156 L112 194 L104 200 L88 176 Z",
  A_PILLAR_RIGHT: "M232 156 L208 194 L216 200 L232 176 Z",
  FRONT_DOOR_LEFT: "M78 176 L104 200 L112 200 L108 294 L92 294 L78 210 Z",
  FRONT_DOOR_RIGHT: "M242 176 L216 200 L208 200 L212 294 L228 294 L242 210 Z",
  B_PILLAR_LEFT: "M92 294 H108 V322 H92 Z",
  B_PILLAR_RIGHT: "M212 294 H228 V322 H212 Z",
  BACK_DOOR_LEFT: "M78 322 L108 322 L104 400 L92 400 L78 400 Z",
  BACK_DOOR_RIGHT: "M242 322 L212 322 L216 400 L228 400 L242 400 Z",
  SIDE_SILL_LEFT: "M62 210 H78 V400 H62 Z",
  SIDE_SILL_RIGHT: "M242 210 H258 V400 H242 Z",
  ROOF: "M112 200 L208 200 L212 322 L212 384 L108 384 L108 322 Z",
  C_PILLAR_LEFT: "M92 400 L108 384 L116 400 L104 416 Z",
  C_PILLAR_RIGHT: "M228 400 L212 384 L204 400 L216 416 Z",
  REAR_FENDER_LEFT: "M78 400 L104 416 L114 416 L108 498 L76 498 L68 460 L74 418 Z",
  REAR_FENDER_RIGHT: "M242 400 L216 416 L206 416 L212 498 L244 498 L252 460 L246 418 Z",
  TRUNK_LID: "M114 416 L206 416 L212 528 L108 528 Z",
  REAR_BUMPER: "M108 528 L212 528 L226 556 C196 584 124 584 94 556 Z",
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

const LABEL_POINTS: Record<string, { x: number; y: number }> = {
  FRONT_BUMPER: { x: 160, y: 40 },
  RADIATOR_SUPPORT: { x: 160, y: 65 },
  HOOD: { x: 160, y: 116 },
  FRONT_FENDER_LEFT: { x: 86, y: 124 },
  FRONT_FENDER_RIGHT: { x: 234, y: 124 },
  FRONT_DOOR_LEFT: { x: 94, y: 240 },
  FRONT_DOOR_RIGHT: { x: 226, y: 240 },
  BACK_DOOR_LEFT: { x: 94, y: 356 },
  BACK_DOOR_RIGHT: { x: 226, y: 356 },
  SIDE_SILL_LEFT: { x: 70, y: 304 },
  SIDE_SILL_RIGHT: { x: 250, y: 304 },
  ROOF: { x: 160, y: 290 },
  A_PILLAR_LEFT: { x: 100, y: 178 },
  A_PILLAR_RIGHT: { x: 220, y: 178 },
  B_PILLAR_LEFT: { x: 100, y: 308 },
  B_PILLAR_RIGHT: { x: 220, y: 308 },
  C_PILLAR_LEFT: { x: 104, y: 400 },
  C_PILLAR_RIGHT: { x: 216, y: 400 },
  TRUNK_LID: { x: 160, y: 472 },
  REAR_FENDER_LEFT: { x: 90, y: 458 },
  REAR_FENDER_RIGHT: { x: 230, y: 458 },
  REAR_BUMPER: { x: 160, y: 548 },
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
  if (/carstat/i.test(data.source)) return "Carstat inspection";
  if (/encar/i.test(data.source)) return "Encar inspection";
  return "Body inspection";
}

function findingsLabel(data: BodyCondition): string {
  if (/carstat/i.test(data.source)) return "Seller damage report";
  return "Diagnosis findings";
}

function Tire({ cx, cy }: { cx: number; cy: number }) {
  return (
    <g>
      <ellipse cx={cx} cy={cy} rx="15" ry="30" fill="#1c1917" />
      <ellipse cx={cx} cy={cy} rx="8" ry="16" fill="#57534e" />
      <ellipse cx={cx} cy={cy} rx="3.5" ry="7" fill="#a8a29e" />
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
    <div className="overflow-hidden rounded-2xl border border-stone-200/80 bg-[#fafaf9] shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-2 border-b border-stone-200/80 bg-white px-4 py-3.5 sm:px-5">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-400">
            {sourceTitle(data)}
          </p>
          <h3 className="mt-0.5 text-[15px] font-semibold tracking-tight text-stone-900">
            Body diagram
            <span className="ml-2 text-[13px] font-normal text-stone-500">
              {clearMap
                ? "all clear"
                : stampOnly
                  ? data.stamp
                  : `${data.panels.length} marked`}
            </span>
          </h3>
        </div>
        <p className="max-w-sm text-right text-[11px] leading-snug text-stone-500">{metaLine(data)}</p>
      </div>

      <div className="grid gap-6 p-4 lg:grid-cols-[minmax(260px,300px)_1fr] lg:gap-8 lg:p-6">
        <div className="flex flex-col items-center gap-4">
          <div className="relative w-full max-w-[280px] rounded-xl bg-white p-3 ring-1 ring-stone-200/70">
            <svg
              viewBox="0 0 320 640"
              className="relative z-[1] h-auto w-full"
              role="img"
              aria-label="Top-down car body condition diagram"
            >
              <defs>
                <linearGradient id={`${uid}-body`} x1="0.2" y1="0" x2="0.8" y2="1">
                  <stop offset="0%" stopColor="#f5f5f4" />
                  <stop offset="100%" stopColor="#e7e5e4" />
                </linearGradient>
                <linearGradient id={`${uid}-ok`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#dcfce7" />
                  <stop offset="100%" stopColor="#bbf7d0" />
                </linearGradient>
                <clipPath id={`${uid}-clip`}>
                  <path d={BODY_OUTLINE} />
                </clipPath>
              </defs>

              <text
                x="160"
                y="12"
                textAnchor="middle"
                fontSize="8"
                fontWeight="700"
                letterSpacing="0.28em"
                fill="#a8a29e"
              >
                FRONT
              </text>
              <text
                x="160"
                y="632"
                textAnchor="middle"
                fontSize="8"
                fontWeight="700"
                letterSpacing="0.28em"
                fill="#a8a29e"
              >
                REAR
              </text>

              <Tire cx={48} cy={180} />
              <Tire cx={272} cy={180} />
              <Tire cx={48} cy={460} />
              <Tire cx={272} cy={460} />

              <path
                d={BODY_OUTLINE}
                fill={`url(#${uid}-body)`}
                stroke="#292524"
                strokeWidth="2"
              />

              {/* Wheel arches */}
              <g fill="none" stroke="#292524" strokeWidth="1.8" strokeLinecap="round" opacity="0.35">
                <path d="M94 156 C80 166 76 174 76 180 C76 194 82 204 94 210" />
                <path d="M226 156 C240 166 244 174 244 180 C244 194 238 204 226 210" />
                <path d="M92 400 C78 412 74 436 74 460 C74 476 80 488 94 498" />
                <path d="M228 400 C242 412 246 436 246 460 C246 476 240 488 226 498" />
              </g>

              {/* Headlights */}
              <path d="M104 42 C116 30 128 34 132 46 L118 58 Z" fill="#fafaf9" stroke="#78716c" strokeWidth="0.9" />
              <path d="M216 42 C204 30 192 34 188 46 L202 58 Z" fill="#fafaf9" stroke="#78716c" strokeWidth="0.9" />

              {/* Mirrors */}
              <path
                d="M78 176 L58 168 C50 164 46 172 48 180 C50 188 58 190 66 186 L78 184 Z"
                fill="#f5f5f4"
                stroke="#292524"
                strokeWidth="1.1"
              />
              <path
                d="M242 176 L262 168 C270 164 274 172 272 180 C270 188 262 190 254 186 L242 184 Z"
                fill="#f5f5f4"
                stroke="#292524"
                strokeWidth="1.1"
              />

              <g clipPath={`url(#${uid}-clip)`}>
                {PANEL_DRAW_ORDER.map((key) => {
                  if (byKey.has(key)) return null;
                  return (
                    <path
                      key={`base-${key}`}
                      d={PANEL_SHAPES[key]}
                      fill={clearMap ? `url(#${uid}-ok)` : "#fafaf9"}
                      stroke="#a8a29e"
                      strokeOpacity="0.7"
                      strokeWidth="0.9"
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
                      fill={c.fill}
                      fillOpacity="0.88"
                      stroke={c.stroke}
                      strokeWidth="1.6"
                      strokeLinejoin="round"
                    >
                      <title>{`${hit.label} — ${hit.legendLabel}`}</title>
                    </path>
                  );
                })}

                {/* Cabin glass — subtle, flat */}
                <path
                  d="M112 200 L208 200 L210 222 L110 222 Z"
                  fill="#78716c"
                  opacity="0.12"
                  stroke="#78716c"
                  strokeWidth="0.6"
                />
                <path
                  d="M112 222 L208 222 L208 360 L112 360 Z"
                  fill="#78716c"
                  opacity="0.08"
                />
                <path
                  d="M112 360 L208 360 L204 384 L116 384 Z"
                  fill="#78716c"
                  opacity="0.12"
                  stroke="#78716c"
                  strokeWidth="0.6"
                />

                {/* Door handles */}
                <rect x="96" y="248" width="9" height="2.2" rx="1" fill="#57534e" opacity="0.45" />
                <rect x="215" y="248" width="9" height="2.2" rx="1" fill="#57534e" opacity="0.45" />
                <rect x="96" y="350" width="9" height="2.2" rx="1" fill="#57534e" opacity="0.45" />
                <rect x="215" y="350" width="9" height="2.2" rx="1" fill="#57534e" opacity="0.45" />

                {/* Tail lights */}
                <path d="M114 532 C124 550 134 546 138 536 L126 524 Z" fill="#e11d48" opacity="0.85" />
                <path d="M206 532 C196 550 186 546 182 536 L194 524 Z" fill="#e11d48" opacity="0.85" />
              </g>

              {/* Letter chips on marked panels */}
              {[...byKey.entries()].map(([key, panel]) => {
                const pt = LABEL_POINTS[key];
                if (!pt || !PANEL_SHAPES[key]) return null;
                const c = LEGEND_COLORS[panel.legend];
                const r = key.includes("PILLAR") || key.includes("SILL") ? 8 : 10;
                return (
                  <g key={`lbl-${key}`}>
                    <circle cx={pt.x} cy={pt.y} r={r} fill="#fff" stroke={c.stroke} strokeWidth="1.5" />
                    <text
                      x={pt.x}
                      y={pt.y + 0.5}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize={r > 9 ? 10 : 8}
                      fontWeight="800"
                      fill={c.stroke}
                    >
                      {panel.legend}
                    </text>
                  </g>
                );
              })}

              {clearMap ? (
                <g>
                  <circle cx="160" cy="292" r="22" fill="#ecfdf5" stroke="#059669" strokeWidth="2" />
                  <path
                    d="M148 292 L158 302 L174 280"
                    fill="none"
                    stroke="#059669"
                    strokeWidth="2.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </g>
              ) : null}

              {stampOnly && data.stamp ? (
                <g>
                  <rect
                    x="48"
                    y="268"
                    width="224"
                    height="48"
                    rx="8"
                    fill="#fff"
                    stroke="#b91c1c"
                    strokeWidth="2"
                  />
                  <text
                    x="160"
                    y="297"
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize="16"
                    fontWeight="800"
                    fill="#991b1b"
                    letterSpacing="0.06em"
                  >
                    {data.stamp.toUpperCase()}
                  </text>
                </g>
              ) : null}

              {data.stamp && data.panels.length > 0 ? (
                <g>
                  <rect x="88" y="8" width="144" height="22" rx="4" fill="#fef2f2" stroke="#fecaca" strokeWidth="1" />
                  <text
                    x="160"
                    y="20"
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize="9"
                    fontWeight="700"
                    fill="#b91c1c"
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
              const on = activeCodes.has(row.code) || stampOnly;
              return (
                <div
                  key={row.code}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-1.5",
                    on ? "bg-white ring-1 ring-stone-200" : "opacity-30",
                  )}
                >
                  <span
                    className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-extrabold"
                    style={{ background: c.fill, color: c.ink }}
                  >
                    {row.code}
                  </span>
                  <span className="text-[11px] font-medium leading-tight text-stone-600">{row.label}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="min-w-0">
          <div className="mb-2.5 flex items-center justify-between gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400">Findings</p>
            <p className="text-[11px] text-stone-500">{findingsLabel(data)}</p>
          </div>

          <ul className="divide-y divide-stone-100 overflow-hidden rounded-xl border border-stone-200 bg-white">
            {data.panels.length === 0 ? (
              <li className="px-3.5 py-4 text-sm text-stone-500">
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
                    className="flex items-start gap-3 px-3.5 py-2.5 hover:bg-stone-50 sm:px-4"
                  >
                    <span
                      className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-[11px] font-extrabold"
                      style={{ background: c.fill, color: c.ink }}
                    >
                      {panel.legend}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                        <p className="text-sm font-semibold tracking-tight text-stone-900">{panel.label}</p>
                        <p className="text-[11px] font-semibold" style={{ color: c.stroke }}>
                          {panel.legendLabel}
                        </p>
                      </div>
                      <p className="mt-0.5 text-[12px] text-stone-500">
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
            <p className="mt-2.5 text-[11px] text-stone-400">
              {unmapped.length} finding{unmapped.length === 1 ? "" : "s"} without a matching panel slot.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
