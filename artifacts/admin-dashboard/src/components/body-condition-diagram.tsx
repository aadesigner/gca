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
 * Technical top-down sedan — viewBox 0 0 400 780.
 * Centerline x=200. Front axle y=230, rear axle y=560.
 * Deep wheel wells so all four tires stay fully readable.
 */
const BODY_OUTLINE = [
  "M150 34",
  "C174 16 226 16 250 34",
  "L272 66",
  "C286 88 296 118 300 148",
  "L302 186",
  // front-right well (deep cut)
  "C278 188 262 204 262 230",
  "C262 256 278 272 302 274",
  "L304 478",
  // rear-right well
  "C280 480 264 500 264 560",
  "C264 586 280 606 304 608",
  "L300 642",
  "C288 682 250 716 210 728",
  "C200 732 182 732 170 728",
  "C130 716 92 682 80 642",
  "L76 608",
  // rear-left well
  "C100 606 116 586 116 560",
  "C116 500 100 480 76 478",
  "L78 274",
  // front-left well
  "C102 272 118 256 118 230",
  "C118 204 102 188 78 186",
  "L80 148",
  "C84 118 94 88 108 66",
  "Z",
].join(" ");

/** Panel paths — non-overlapping tessellation fitted to BODY_OUTLINE. */
const PANEL_SHAPES: Record<string, string> = {
  FRONT_BUMPER:
    "M150 36 C174 18 226 18 250 36 L266 64 L134 64 Z",

  RADIATOR_SUPPORT: "M134 64 H266 V92 H134 Z",

  HOOD:
    "M134 92 L266 92 L278 186 L122 186 Z",

  FRONT_FENDER_LEFT:
    "M108 92 L134 92 L122 186 L118 214 L102 214 L96 186 L96 148 C100 120 104 100 108 92 Z",

  FRONT_FENDER_RIGHT:
    "M292 92 L266 92 L278 186 L282 214 L298 214 L304 186 L304 148 C300 120 296 100 292 92 Z",

  A_PILLAR_LEFT: "M122 186 L148 230 L136 238 L118 214 Z",
  A_PILLAR_RIGHT: "M278 186 L252 230 L264 238 L282 214 Z",

  FRONT_DOOR_LEFT:
    "M102 214 L136 238 L148 238 L142 350 L118 350 L102 274 Z",

  FRONT_DOOR_RIGHT:
    "M298 214 L264 238 L252 238 L258 350 L282 350 L298 274 Z",

  B_PILLAR_LEFT: "M118 350 H142 V386 H118 Z",
  B_PILLAR_RIGHT: "M258 350 H282 V386 H258 Z",

  BACK_DOOR_LEFT:
    "M102 386 L142 386 L136 478 L118 478 L102 478 Z",

  BACK_DOOR_RIGHT:
    "M298 386 L258 386 L264 478 L282 478 L298 478 Z",

  SIDE_SILL_LEFT: "M82 274 H102 V478 H82 Z",
  SIDE_SILL_RIGHT: "M298 274 H318 V478 H298 Z",

  ROOF:
    "M148 238 L252 238 L258 386 L258 460 L142 460 L142 386 Z",

  C_PILLAR_LEFT: "M118 478 L142 460 L152 478 L136 498 Z",
  C_PILLAR_RIGHT: "M282 478 L258 460 L248 478 L264 498 Z",

  REAR_FENDER_LEFT:
    "M102 478 L136 498 L148 498 L140 608 L100 608 L90 560 L96 500 Z",

  REAR_FENDER_RIGHT:
    "M298 478 L264 498 L252 498 L260 608 L300 608 L310 560 L304 500 Z",

  TRUNK_LID:
    "M148 498 L252 498 L260 628 L140 628 Z",

  REAR_BUMPER:
    "M140 628 L260 628 L278 662 C240 692 160 692 122 662 Z",
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
  FRONT_BUMPER: { x: 200, y: 48 },
  RADIATOR_SUPPORT: { x: 200, y: 78 },
  HOOD: { x: 200, y: 140 },
  FRONT_FENDER_LEFT: { x: 48, y: 150 },
  FRONT_FENDER_RIGHT: { x: 352, y: 150 },
  FRONT_DOOR_LEFT: { x: 40, y: 290 },
  FRONT_DOOR_RIGHT: { x: 360, y: 290 },
  BACK_DOOR_LEFT: { x: 40, y: 430 },
  BACK_DOOR_RIGHT: { x: 360, y: 430 },
  SIDE_SILL_LEFT: { x: 30, y: 370 },
  SIDE_SILL_RIGHT: { x: 370, y: 370 },
  ROOF: { x: 200, y: 350 },
  A_PILLAR_LEFT: { x: 108, y: 214 },
  A_PILLAR_RIGHT: { x: 292, y: 214 },
  B_PILLAR_LEFT: { x: 112, y: 368 },
  B_PILLAR_RIGHT: { x: 288, y: 368 },
  C_PILLAR_LEFT: { x: 116, y: 478 },
  C_PILLAR_RIGHT: { x: 284, y: 478 },
  TRUNK_LID: { x: 200, y: 564 },
  REAR_FENDER_LEFT: { x: 48, y: 550 },
  REAR_FENDER_RIGHT: { x: 352, y: 550 },
  REAR_BUMPER: { x: 200, y: 652 },
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
    [data.date, data.center, data.diagnosisNo != null ? `Diagnosis #${data.diagnosisNo}` : null]
      .filter(Boolean)
      .join(" · ") || data.source
  );
}

/**
 * Top-down tire: elongated oval rubber with longitudinal tread + offset rim.
 * From above, tires look like capsules, not circles.
 */
function Tire({ cx, cy, side }: { cx: number; cy: number; side: "left" | "right" }) {
  const towardCenter = side === "left" ? 3 : -3;
  const rimX = cx + towardCenter;
  return (
    <g>
      {/* Contact shadow */}
      <ellipse cx={cx} cy={cy + 2} rx="24" ry="44" fill="#020617" opacity="0.16" />
      {/* Rubber carcass */}
      <ellipse cx={cx} cy={cy} rx="21" ry="42" fill="url(#bc-tire)" stroke="#020617" strokeWidth="1.6" />
      {/* Outer sidewall ring */}
      <ellipse cx={cx} cy={cy} rx="17.5" ry="36" fill="none" stroke="#475569" strokeWidth="1.5" opacity="0.7" />
      {/* Longitudinal tread grooves (top-down signature) */}
      <g fill="none" stroke="#0f172a" strokeWidth="1.15" strokeLinecap="round" opacity="0.45">
        <path d={`M${cx - 6} ${cy - 28} L${cx - 6} ${cy + 28}`} />
        <path d={`M${cx} ${cy - 32} L${cx} ${cy + 32}`} />
        <path d={`M${cx + 6} ${cy - 28} L${cx + 6} ${cy + 28}`} />
      </g>
      {/* Rim face */}
      <ellipse cx={rimX} cy={cy} rx="9.5" ry="17" fill="url(#bc-rim)" stroke="#cbd5e1" strokeWidth="1" />
      <ellipse cx={rimX} cy={cy} rx="5.5" ry="10" fill="none" stroke="#64748b" strokeWidth="1.1" opacity="0.7" />
      <ellipse cx={rimX} cy={cy} rx="2.8" ry="5" fill="#0f172a" opacity="0.7" />
      {/* Lug nuts */}
      {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
        const rad = (deg * Math.PI) / 180;
        return (
          <circle
            key={deg}
            cx={rimX + Math.cos(rad) * 6.2}
            cy={cy + Math.sin(rad) * 11}
            r="1.15"
            fill="#f8fafc"
            opacity="0.85"
          />
        );
      })}
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
                {clearMap ? "all clear" : `${data.panels.length} marked`}
              </span>
            </h3>
          </div>
          <p className="max-w-md text-right text-[11px] leading-relaxed text-muted-foreground">
            {metaLine(data)}
          </p>
        </div>
      </div>

      <div className="grid gap-6 p-5 lg:grid-cols-[minmax(320px,400px)_1fr] lg:gap-8 lg:p-6">
        <div className="flex flex-col items-center gap-5">
          <div className="relative w-full max-w-[380px]">
            <div
              aria-hidden
              className="absolute inset-[12%] rounded-[48%] opacity-90 blur-2xl"
              style={{
                background:
                  "radial-gradient(circle at 50% 36%, hsl(210 42% 88% / 0.95), transparent 72%)",
              }}
            />
            <svg
              viewBox="0 0 400 780"
              className="relative z-[1] h-auto w-full drop-shadow-[0_22px_36px_rgba(15,23,42,0.16)]"
              role="img"
              aria-label="Top-down car body condition diagram"
            >
              <defs>
                <linearGradient id="bc-paint" x1="0.08" y1="0" x2="0.92" y2="1">
                  <stop offset="0%" stopColor="#f8fafc" />
                  <stop offset="32%" stopColor="#e8eef5" />
                  <stop offset="68%" stopColor="#d0dae6" />
                  <stop offset="100%" stopColor="#b8c5d4" />
                </linearGradient>
                <linearGradient id="bc-glass" x1="0.25" y1="0" x2="0.75" y2="1">
                  <stop offset="0%" stopColor="#c5daf0" stopOpacity="0.82" />
                  <stop offset="48%" stopColor="#7f9bb8" stopOpacity="0.48" />
                  <stop offset="100%" stopColor="#3f5164" stopOpacity="0.34" />
                </linearGradient>
                <linearGradient id="bc-glass-side" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#94a3b8" stopOpacity="0.42" />
                  <stop offset="100%" stopColor="#64748b" stopOpacity="0.14" />
                </linearGradient>
                <linearGradient id="bc-tire" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#020617" />
                  <stop offset="45%" stopColor="#1e293b" />
                  <stop offset="55%" stopColor="#334155" />
                  <stop offset="100%" stopColor="#020617" />
                </linearGradient>
                <linearGradient id="bc-rim" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#f8fafc" />
                  <stop offset="45%" stopColor="#94a3b8" />
                  <stop offset="100%" stopColor="#475569" />
                </linearGradient>
                <linearGradient id="bc-clear" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#d1fae5" stopOpacity="0.62" />
                  <stop offset="100%" stopColor="#a7f3d0" stopOpacity="0.28" />
                </linearGradient>
                <filter id="bc-soft" x="-28%" y="-16%" width="156%" height="140%">
                  <feDropShadow dx="0" dy="3.5" stdDeviation="2.6" floodOpacity="0.18" />
                </filter>
                <filter id="bc-panel" x="-10%" y="-10%" width="120%" height="120%">
                  <feDropShadow dx="0" dy="0.5" stdDeviation="0.55" floodOpacity="0.11" />
                </filter>
                <clipPath id="bc-body-clip">
                  <path d={BODY_OUTLINE} />
                </clipPath>
              </defs>

              <text
                x="200"
                y="18"
                textAnchor="middle"
                fontSize="11"
                fontWeight="700"
                letterSpacing="0.28em"
                fill="#64748b"
                fontFamily="ui-sans-serif, system-ui, sans-serif"
              >
                FRONT
              </text>
              <text
                x="200"
                y="768"
                textAnchor="middle"
                fontSize="11"
                fontWeight="700"
                letterSpacing="0.28em"
                fill="#64748b"
                fontFamily="ui-sans-serif, system-ui, sans-serif"
              >
                REAR
              </text>

              <ellipse cx="200" cy="742" rx="120" ry="16" fill="#0f172a" opacity="0.08" />

              {/* Well pits */}
              <g opacity="0.22">
                <path d="M78 186 C102 188 118 204 118 230 C118 256 102 272 78 274 Z" fill="#0f172a" />
                <path d="M322 186 C298 188 282 204 282 230 C282 256 298 272 322 274 Z" fill="#0f172a" />
                <path d="M76 478 C100 480 116 500 116 560 C116 586 100 606 76 608 Z" fill="#0f172a" />
                <path d="M324 478 C300 480 284 500 284 560 C284 586 300 606 324 608 Z" fill="#0f172a" />
              </g>

              <Tire cx={64} cy={230} side="left" />
              <Tire cx={336} cy={230} side="right" />
              <Tire cx={64} cy={560} side="left" />
              <Tire cx={336} cy={560} side="right" />

              <path
                d={BODY_OUTLINE}
                fill="url(#bc-paint)"
                stroke="#1e293b"
                strokeWidth="2.35"
                filter="url(#bc-soft)"
              />

              {/* Arch lips */}
              <g fill="none" stroke="#0f172a" strokeWidth="2.8" strokeLinecap="round" opacity="0.42">
                <path d="M118 186 C102 198 96 212 96 230 C96 252 104 266 120 274" />
                <path d="M282 186 C298 198 304 212 304 230 C304 252 296 266 280 274" />
                <path d="M116 478 C100 492 94 520 94 560 C94 582 102 598 118 608" />
                <path d="M284 478 C300 492 306 520 306 560 C306 582 298 598 282 608" />
              </g>

              {/* Headlights */}
              <path d="M128 54 C144 38 160 42 166 58 L146 76 Z" fill="#e2e8f0" stroke="#94a3b8" strokeWidth="1.05" />
              <path d="M272 54 C256 38 240 42 234 58 L254 76 Z" fill="#e2e8f0" stroke="#94a3b8" strokeWidth="1.05" />
              <path d="M136 58 C146 46 158 50 160 62" fill="none" stroke="#fff" strokeWidth="1.6" opacity="0.9" />
              <path d="M264 58 C254 46 242 50 240 62" fill="none" stroke="#fff" strokeWidth="1.6" opacity="0.9" />

              {/* Mirrors */}
              <path
                d="M100 214 L72 204 C60 200 52 210 54 222 C56 234 68 238 80 232 L100 226 Z"
                fill="#e2e8f0"
                stroke="#1e293b"
                strokeWidth="1.4"
              />
              <path
                d="M300 214 L328 204 C340 200 348 210 346 222 C344 234 332 238 320 232 L300 226 Z"
                fill="#e2e8f0"
                stroke="#1e293b"
                strokeWidth="1.4"
              />
              <path d="M78 216 L66 212" fill="none" stroke="#94a3b8" strokeWidth="1.1" />
              <path d="M322 216 L334 212" fill="none" stroke="#94a3b8" strokeWidth="1.1" />

              {/* Panels clipped to car silhouette so seams stay car-shaped */}
              <g clipPath="url(#bc-body-clip)">
                {PANEL_DRAW_ORDER.map((key) => {
                  if (byKey.has(key)) return null;
                  return (
                    <path
                      key={`base-${key}`}
                      d={PANEL_SHAPES[key]}
                      fill={clearMap ? "url(#bc-clear)" : "#f8fafc"}
                      fillOpacity={clearMap ? 1 : 0.72}
                      stroke="#334155"
                      strokeOpacity="0.45"
                      strokeWidth="1.25"
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
                      stroke={c.stroke}
                      strokeWidth="2.45"
                      strokeLinejoin="round"
                    >
                      <title>{`${hit.label} — ${hit.legendLabel}`}</title>
                    </path>
                  );
                })}

                {/* Glass — windshield / cabin / rear window */}
                <path
                  d="M148 238 L252 238 L258 268 L142 268 Z"
                  fill="url(#bc-glass)"
                  stroke="#475569"
                  strokeWidth="1.1"
                />
                <path
                  d="M148 268 L252 268 L252 430 L148 430 Z"
                  fill="url(#bc-glass)"
                  stroke="#475569"
                  strokeWidth="1"
                  opacity="0.5"
                />
                <path
                  d="M148 430 L252 430 L246 460 L154 460 Z"
                  fill="url(#bc-glass)"
                  stroke="#475569"
                  strokeWidth="1.1"
                />
                <path d="M156 242 L244 242 L246 258 L154 258 Z" fill="#ffffff" opacity="0.28" />

                <path d="M110 246 L140 250 L136 330 L112 326 Z" fill="url(#bc-glass-side)" stroke="#64748b" strokeWidth="0.8" />
                <path d="M290 246 L260 250 L264 330 L288 326 Z" fill="url(#bc-glass-side)" stroke="#64748b" strokeWidth="0.8" />
                <path d="M110 400 L138 404 L134 468 L112 462 Z" fill="url(#bc-glass-side)" stroke="#64748b" strokeWidth="0.8" />
                <path d="M290 400 L262 404 L266 468 L288 462 Z" fill="url(#bc-glass-side)" stroke="#64748b" strokeWidth="0.8" />

                <g fill="none" stroke="#1e293b" strokeOpacity="0.35" strokeWidth="1.2" strokeLinecap="round">
                  <path d="M148 238 L142 350" />
                  <path d="M252 238 L258 350" />
                  <path d="M142 386 L136 478" />
                  <path d="M258 386 L264 478" />
                  <path d="M200 100 L200 180" strokeDasharray="4 5" strokeOpacity="0.4" />
                  <path d="M200 510 L200 620" strokeDasharray="4 5" strokeOpacity="0.4" />
                </g>

                <rect x="120" y="300" width="14" height="3.8" rx="1.6" fill="#334155" opacity="0.55" />
                <rect x="266" y="300" width="14" height="3.8" rx="1.6" fill="#334155" opacity="0.55" />
                <rect x="120" y="420" width="14" height="3.8" rx="1.6" fill="#334155" opacity="0.55" />
                <rect x="266" y="420" width="14" height="3.8" rx="1.6" fill="#334155" opacity="0.55" />

                <path d="M144 636 C158 660 174 654 180 640 L160 622 Z" fill="#ef4444" opacity="0.72" />
                <path d="M256 636 C242 660 226 654 220 640 L240 622 Z" fill="#ef4444" opacity="0.72" />
              </g>

              {[...byKey.entries()].map(([key, panel]) => {
                const pt = LABEL_POINTS[key];
                if (!pt || !PANEL_SHAPES[key]) return null;
                const c = LEGEND_COLORS[panel.legend];
                const isSide = pt.x < 100 || pt.x > 300;
                return (
                  <g key={`lbl-${key}`}>
                    {isSide ? (
                      <path
                        d={`M${pt.x < 200 ? pt.x + 28 : pt.x - 28} ${pt.y} L${pt.x + (pt.x < 200 ? 10 : -10)} ${pt.y}`}
                        fill="none"
                        stroke={c.stroke}
                        strokeWidth="1.25"
                        strokeOpacity="0.55"
                      />
                    ) : null}
                    <circle cx={pt.x} cy={pt.y} r="13.5" fill="#fff" stroke={c.stroke} strokeWidth="2.1" />
                    <text
                      x={pt.x}
                      y={pt.y + 0.5}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize="12.5"
                      fontWeight="700"
                      fontFamily="ui-sans-serif, system-ui, sans-serif"
                      fill={c.ink}
                    >
                      {panel.legend}
                    </text>
                  </g>
                );
              })}

              {clearMap ? (
                <g>
                  <circle cx="200" cy="355" r="30" fill="#ecfdf5" stroke="#059669" strokeWidth="2.4" />
                  <path
                    d="M184 355 L196 367 L218 339"
                    fill="none"
                    stroke="#059669"
                    strokeWidth="3.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </g>
              ) : null}
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
