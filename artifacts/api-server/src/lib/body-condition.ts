/**
 * Structured Encar (and similar KR) body-panel condition for VIN JSON + diagram UI.
 * Legend letters match common CarHistory-style maps:
 *   Z Replacement · W Painting/Welding · R Rust · C Scratch · N Unevenness · P Damage
 */

import {
  normalizeEncarDiagnosisPanel,
  normalizeEncarDiagnosisResult,
  normalizeEncarInspectionStatus,
  translateEncarInspectionPanel,
} from "./providers/encar-locale";

export type BodyConditionLegend = "Z" | "W" | "R" | "C" | "N" | "P";

export interface BodyConditionPanel {
  /** Stable key when known (HOOD, FRONT_FENDER_LEFT, …). */
  key?: string;
  label: string;
  /** Encar resultCode or inspection status. */
  resultCode?: string;
  result?: string;
  legend: BodyConditionLegend;
  legendLabel: string;
  area?: "exterior" | "interior" | string;
}

export interface BodyCondition {
  date?: string;
  source: string;
  diagnosisNo?: number;
  center?: string;
  /** True when Encar diagnosis listed panels and all were NORMAL (clean map). */
  allClear?: boolean;
  /**
   * Carstat (and similar) whole-vehicle stamp when no panel zones were marked
   * (e.g. "Total loss" / 전손). Diagram still renders with a center badge.
   */
  stamp?: string;
  legend: Array<{ code: BodyConditionLegend; label: string }>;
  panels: BodyConditionPanel[];
}

export const BODY_CONDITION_LEGEND: Array<{ code: BodyConditionLegend; label: string }> = [
  { code: "Z", label: "Replacement" },
  { code: "W", label: "Painting/Welding" },
  { code: "R", label: "Rust" },
  { code: "C", label: "Scratch" },
  { code: "N", label: "Unevenness" },
  { code: "P", label: "Damage" },
];

const LEGEND_LABEL: Record<BodyConditionLegend, string> = Object.fromEntries(
  BODY_CONDITION_LEGEND.map((x) => [x.code, x.label]),
) as Record<BodyConditionLegend, string>;

type EventLike = {
  eventType?: string | null;
  description?: string | null;
  occurredAt?: Date | string | unknown;
  metadata?: string | Record<string, unknown> | null;
};

/** Map Encar diagnosis resultCode / inspection status → diagram letter. */
export function bodyConditionLegendFromStatus(
  code?: string | null,
  raw?: string | null,
): BodyConditionLegend | undefined {
  const blob = `${code ?? ""} ${raw ?? ""}`.trim();
  if (!blob) return undefined;
  const u = blob.toUpperCase();
  const en = (normalizeEncarDiagnosisResult(code, raw) ?? normalizeEncarInspectionStatus(raw) ?? raw ?? "")
    .toLowerCase();

  if (/NORMAL|GOOD|NONE|N\/A|NOT APPLICABLE|ABSENT/.test(u) || /^(normal|good|none)$/i.test(en)) {
    return undefined;
  }
  if (/REPLACEMENT|EXCHANGE|\bZ\b|교환/.test(u) || /\breplacement\b/.test(en)) return "Z";
  if (
    /REPAIR|REPAINT|WELD|PANEL\s*REPAIR|PAINT|판금|도장|\bW\b/.test(u) ||
    /panel repair|repaint|weld|painting/.test(en)
  ) {
    return "W";
  }
  if (/RUST|CORROSION|부식|\bR\b/.test(u) || /rust|corrosion/.test(en)) return "R";
  if (/SCRATCH|흠집|\bC\b/.test(u) || /\bscratch\b/.test(en)) return "C";
  if (/UNEVEN|DENT|요철|\bN\b/.test(u) || /uneven|dent/.test(en)) return "N";
  if (/DAMAGE|CRACK|BROKEN|손상|깨짐|찌그러|\bP\b/.test(u) || /damage|crack/.test(en)) return "P";
  // Defective / unknown non-normal → treat as damage so the diagram still flags it.
  if (/DEFECTIVE|불량|SIMPLE/.test(u) || /defective/.test(en)) return "P";
  return undefined;
}

export function extractBodyConditionFromDiagnosis(
  diagnosis: Record<string, unknown> | null | undefined,
): BodyCondition | null {
  if (!diagnosis) return null;
  const panels: BodyConditionPanel[] = [];
  let sawPanelItem = false;

  for (const item of asArr(diagnosis.items)) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const name = str(row.name) ?? str(row.partName);
    if (!name) continue;
    if (name === "CHECKER_COMMENT" || name === "OUTER_PANEL_COMMENT") continue;
    sawPanelItem = true;

    const resultCode = str(row.resultCode);
    const result = str(row.result);
    const legend = bodyConditionLegendFromStatus(resultCode, result);
    if (!legend) continue;

    const label = normalizeEncarDiagnosisPanel(name);
    panels.push({
      key: name,
      label,
      resultCode: resultCode ?? undefined,
      result: normalizeEncarDiagnosisResult(resultCode, result) ?? result ?? undefined,
      legend,
      legendLabel: LEGEND_LABEL[legend],
      area: "exterior",
    });
  }

  // Diagnosis payload present with only NORMAL panels → still emit a clean body map.
  if (!panels.length && !sawPanelItem) return null;

  return {
    date: formatDate(str(diagnosis.realDiagnosisDate) ?? str(diagnosis.diagnosisDate)),
    source: "encar_diagnosis",
    diagnosisNo: num(diagnosis.diagnosisNo),
    center: str(diagnosis.reservationCenterName) ?? str(diagnosis.centerCode),
    allClear: panels.length === 0 && sawPanelItem,
    legend: BODY_CONDITION_LEGEND,
    panels,
  };
}

export function extractBodyConditionFromInspection(
  inspection: Record<string, unknown> | null | undefined,
): BodyConditionPanel[] {
  if (!inspection) return [];
  const panels: BodyConditionPanel[] = [];
  for (const key of ["outers", "inners"] as const) {
    walkInspection(asArr(inspection[key]), panels, key === "inners" ? "interior" : "exterior");
  }
  return panels;
}

function walkInspection(
  nodes: unknown[],
  out: BodyConditionPanel[],
  area: string,
): void {
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    const row = node as Record<string, unknown>;
    const rawTitle = title(row.type);
    const label = (
      translateEncarInspectionPanel(rawTitle) ??
      rawTitle ??
      ""
    )
      .replace(/\(\s*\)/g, "")
      .replace(/[\/|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const statusRaw = title(row.statusType);
    const status = normalizeEncarInspectionStatus(statusRaw) ?? statusRaw;
    const legend = bodyConditionLegendFromStatus(undefined, status);
    if (label && legend) {
      out.push({
        label,
        result: status ?? undefined,
        legend,
        legendLabel: LEGEND_LABEL[legend],
        area,
        key: guessPanelKey(label),
      });
    }
    walkInspection(asArr(row.children), out, area);
  }
}

/** Build bodyCondition from stored vehicle_events (Encar diagnosis + Carstat damage map). */
export function buildBodyCondition(events: EventLike[]): BodyCondition | null {
  const panels: BodyConditionPanel[] = [];
  let date: string | undefined;
  let diagnosisNo: number | undefined;
  let center: string | undefined;
  let source = "encar";
  let allClear = false;
  let stamp: string | undefined;

  for (const event of events) {
    const meta = parseMeta(event.metadata);
    const src = str(meta.source);

    // Carstat auction stamps / zones → same panel diagram as Encar.
    if (src === "carstat" || src === "carstat_body") {
      const field = str(meta.field);
      if (field === "damage" || field === "damage_zones" || field === "badges" || src === "carstat_body") {
        source = "carstat";
        date = date ?? formatDate(event.occurredAt);
        const marks: string[] = [];
        if (Array.isArray(meta.stamps)) marks.push(...meta.stamps.map((x) => String(x)));
        if (Array.isArray(meta.badges)) marks.push(...meta.badges.map((x) => String(x)));
        if (Array.isArray(meta.zones)) marks.push(...meta.zones.map((x) => String(x)));
        if (Array.isArray(meta.panels)) {
          for (const item of meta.panels) {
            if (!item || typeof item !== "object") continue;
            const row = item as Record<string, unknown>;
            const label = str(row.label) ?? str(row.panel) ?? str(row.name);
            if (!label || !isUsablePanelLabel(label)) continue;
            const legend =
              (str(row.legend) as BodyConditionLegend | undefined) &&
              "ZWRCNP".includes(String(row.legend))
                ? (String(row.legend) as BodyConditionLegend)
                : bodyConditionLegendFromStatus(str(row.resultCode), str(row.result) ?? label);
            if (!legend) continue;
            panels.push({
              key: str(row.key) ?? guessPanelKey(label),
              label,
              resultCode: str(row.resultCode),
              result: str(row.result) ?? undefined,
              legend,
              legendLabel: LEGEND_LABEL[legend],
              area: str(row.area) ?? "exterior",
            });
          }
        }
        const value = str(meta.value);
        if (value) marks.push(...value.split(/[·,|]/).map((s) => s.trim()).filter(Boolean));
        panels.push(
          ...panelsFromCarstatMarks(marks, str(meta.damageClass) ?? str(event.description)),
        );
        const classStamp =
          humanCarstatStamp(str(meta.stamp)) ||
          humanCarstatStamp(str(meta.damageClass)) ||
          marks.map(humanCarstatStamp).find(Boolean) ||
          (meta.salvage === true ? "Total loss" : undefined);
        if (classStamp) stamp = stamp ?? classStamp;
      }
      continue;
    }

    if (src !== "encar_diagnosis" && src !== "encar_inspection_panels") continue;

    if (src === "encar_diagnosis") {
      source = "encar_diagnosis";
      date = date ?? str(meta.date) ?? formatDate(event.occurredAt);
      diagnosisNo = diagnosisNo ?? num(meta.diagnosisNo);
      center = center ?? str(meta.center);
      if (meta.allClear === true || meta.bodyCondition === true) {
        // Keep allClear unless we later find marked panels.
        if (meta.allClear === true) allClear = true;
      }
    }

    const structured = meta.panels;
    if (Array.isArray(structured)) {
      for (const item of structured) {
        if (!item) continue;
        if (typeof item === "string") {
          const parsed = parseLegacyPanelString(item);
          if (parsed) panels.push(parsed);
          continue;
        }
        if (typeof item !== "object") continue;
        const row = item as Record<string, unknown>;
        const label = str(row.label) ?? str(row.panel) ?? str(row.name);
        if (!label || !isUsablePanelLabel(label)) continue;
        const resultCode = str(row.resultCode) ?? str(row.status);
        const result = str(row.result) ?? str(row.status);
        const legend =
          (str(row.legend) as BodyConditionLegend | undefined) &&
          "ZWRCNP".includes(String(row.legend))
            ? (String(row.legend) as BodyConditionLegend)
            : bodyConditionLegendFromStatus(resultCode, result ?? label);
        if (!legend) continue;
        panels.push({
          key: str(row.key) ?? guessPanelKey(label),
          label,
          resultCode: resultCode ?? undefined,
          result: result ?? undefined,
          legend,
          legendLabel: LEGEND_LABEL[legend],
          area: str(row.area),
        });
      }
    }
  }

  const deduped = dedupePanels(panels);
  if (deduped.length > 0) {
    return {
      date,
      source,
      diagnosisNo,
      center,
      stamp,
      legend: BODY_CONDITION_LEGEND,
      panels: deduped,
    };
  }
  if (allClear) {
    return {
      date,
      source,
      diagnosisNo,
      center,
      allClear: true,
      legend: BODY_CONDITION_LEGEND,
      panels: [],
    };
  }
  // Carstat total-loss / flood stamp with no panel zones — still show the body map.
  if (stamp && source === "carstat") {
    return {
      date,
      source,
      center,
      stamp,
      legend: BODY_CONDITION_LEGEND,
      panels: [],
    };
  }
  return null;
}

function humanCarstatStamp(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const t = raw.replace(/_/g, " ").trim();
  if (!t) return undefined;
  if (/전손|total\s*loss|총손/i.test(t)) return "Total loss";
  if (/침수|flood/i.test(t)) return "Flood";
  if (/화재|fire/i.test(t)) return "Fire";
  if (/도난|theft/i.test(t)) return "Theft";
  if (/collision/i.test(t)) return "Collision";
  return undefined;
}

/** Map Carstat damage stamps / Korean area labels → diagram panel slots. */
export function panelsFromCarstatMarks(
  marks: string[],
  damageClass?: string | null,
): BodyConditionPanel[] {
  const legend = carstatLegendFromClass(damageClass, marks.join(" "));
  if (!legend) return [];

  const keys = new Set<string>();
  for (const raw of marks) {
    for (const key of mapCarstatAreaToPanelKeys(raw)) keys.add(key);
  }
  if (keys.size === 0) return [];

  const out: BodyConditionPanel[] = [];
  for (const key of keys) {
    out.push({
      key,
      label: humanPanelLabel(key),
      result: damageClass || marks.find((m) => mapCarstatAreaToPanelKeys(m).includes(key)) || "Damage",
      legend,
      legendLabel: LEGEND_LABEL[legend],
      area: "exterior",
    });
  }
  return out;
}

function carstatLegendFromClass(
  damageClass?: string | null,
  blob = "",
): BodyConditionLegend | undefined {
  const t = `${damageClass ?? ""} ${blob}`.toLowerCase();
  if (!t.trim()) return undefined;
  if (/전손|total\s*loss|총손/.test(t)) return "Z";
  if (/교환|replacement|exchange/.test(t)) return "Z";
  if (/판금|도장|weld|repair|repaint|collision/.test(t)) return "W";
  if (/침수|flood/.test(t)) return "P";
  if (/화재|fire|theft|도난|손상|damage/.test(t)) return "P";
  if (/측면|앞면|후면|루프|front|rear|side|roof|엔진/.test(t)) return "P";
  return "P";
}

/** Korean / EN area stamps used on Carstat lot badges → panel keys. */
function mapCarstatAreaToPanelKeys(raw: string): string[] {
  const s = raw.toLowerCase().replace(/\s+/g, " ").trim();
  if (!s) return [];
  // Skip non-area status stamps — they set legend / stamp, not location.
  if (
    /^(전손|총손|total\s*loss|flood|침수|fire|화재|theft|도난|collision|airbag|inspect|interior)$/i.test(
      s,
    )
  ) {
    return [];
  }
  if (/^(frame|골격)$/i.test(s)) {
    return ["RADIATOR_SUPPORT", "A_PILLAR_LEFT", "A_PILLAR_RIGHT", "B_PILLAR_LEFT", "B_PILLAR_RIGHT"];
  }
  if (/루프|^roof$/.test(s)) return ["ROOF"];
  if (/엔진|^engine$|engine\s*bay|hood|bonnet|후드/.test(s)) return ["HOOD", "RADIATOR_SUPPORT"];
  if (/앞\s*범퍼|front\s*bumper/.test(s)) return ["FRONT_BUMPER"];
  if (/뒷\s*범퍼|rear\s*bumper/.test(s)) return ["REAR_BUMPER"];
  if (/^(front)$|앞면|전면/.test(s)) return ["FRONT_BUMPER", "HOOD"];
  if (/^(rear)$|후면|트렁크|trunk|tailgate/.test(s)) return ["REAR_BUMPER", "TRUNK_LID"];
  if (/^(left)$|좌\s*측|left\s*side|운전석/.test(s)) {
    return ["FRONT_FENDER_LEFT", "FRONT_DOOR_LEFT", "BACK_DOOR_LEFT", "REAR_FENDER_LEFT"];
  }
  if (/^(right)$|우\s*측|right\s*side|조수석/.test(s)) {
    return ["FRONT_FENDER_RIGHT", "FRONT_DOOR_RIGHT", "BACK_DOOR_RIGHT", "REAR_FENDER_RIGHT"];
  }
  if (/측면|^side$/.test(s)) {
    return [
      "FRONT_DOOR_LEFT",
      "FRONT_DOOR_RIGHT",
      "BACK_DOOR_LEFT",
      "BACK_DOOR_RIGHT",
      "SIDE_SILL_LEFT",
      "SIDE_SILL_RIGHT",
    ];
  }
  if (/쿼터|quarter|rear\s*fender/.test(s)) return ["REAR_FENDER_LEFT", "REAR_FENDER_RIGHT"];
  if (/펜더|fender|wing/.test(s)) {
    return /rear|후/.test(s)
      ? ["REAR_FENDER_LEFT", "REAR_FENDER_RIGHT"]
      : ["FRONT_FENDER_LEFT", "FRONT_FENDER_RIGHT"];
  }
  if (/도어|door/.test(s)) {
    return /rear|후|back/.test(s)
      ? ["BACK_DOOR_LEFT", "BACK_DOOR_RIGHT"]
      : ["FRONT_DOOR_LEFT", "FRONT_DOOR_RIGHT"];
  }
  if (/하부|underbody|under|sill|rocker/.test(s)) return ["SIDE_SILL_LEFT", "SIDE_SILL_RIGHT"];
  return [];
}

function humanPanelLabel(key: string): string {
  return key
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function parseLegacyPanelString(raw: string): BodyConditionPanel | null {
  const m = raw.match(/^(.+?):\s*(.+)$/);
  const label = (m?.[1] ?? raw).trim();
  const result = (m?.[2] ?? "").trim();
  if (!isUsablePanelLabel(label)) return null;
  // Older crawls stored REPLACEMENT panels as bare names (no ": status").
  const legend = bodyConditionLegendFromStatus(undefined, result || "Replacement");
  if (!legend || !label) return null;
  return {
    key: guessPanelKey(label),
    label,
    result: result || "Replacement",
    legend,
    legendLabel: LEGEND_LABEL[legend],
    area: "exterior",
  };
}

function dedupePanels(panels: BodyConditionPanel[]): BodyConditionPanel[] {
  const byKey = new Map<string, BodyConditionPanel>();
  for (const panel of panels) {
    const k = (panel.key ?? panel.label).toUpperCase();
    const prev = byKey.get(k);
    if (!prev || legendPriority(panel.legend) >= legendPriority(prev.legend)) {
      byKey.set(k, panel);
    }
  }
  return [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function legendPriority(code: BodyConditionLegend): number {
  // Prefer structural work over cosmetic when merging diagnosis + inspection.
  return { Z: 6, W: 5, P: 4, R: 3, N: 2, C: 1 }[code];
}

/** Drop translator junk ("and", "/", "( )") that is not a real body panel. */
function isUsablePanelLabel(label: string): boolean {
  const t = label.replace(/\s+/g, " ").trim();
  if (t.length < 3) return false;
  if (/^(and|or|the|none|n\/a|null|undefined|yes|no)$/i.test(t)) return false;
  if (/^[\/|:().\-\s]+$/.test(t)) return false;
  if (/^\(\s*\)$/.test(t)) return false;
  if (/^(front|rear|left|right|outer|inner)$/i.test(t)) return false;
  return true;
}

/** Map English panel labels → diagram slot keys. */
export function guessPanelKey(label: string): string | undefined {
  const s = label.toLowerCase();
  if (/hood|bonnet|hood\b/.test(s)) return "HOOD";
  if (/trunk|tailgate|boot/.test(s)) return "TRUNK_LID";
  if (/roof/.test(s)) return "ROOF";
  if (/front.*fender|fender.*front|front.*wing/.test(s)) {
    return /right|rh|\(r\)/.test(s) ? "FRONT_FENDER_RIGHT" : "FRONT_FENDER_LEFT";
  }
  if (/rear.*fender|fender.*rear|quarter|rear.*wing/.test(s)) {
    return /right|rh|\(r\)/.test(s) ? "REAR_FENDER_RIGHT" : "REAR_FENDER_LEFT";
  }
  if (/front.*door|door.*front/.test(s)) {
    return /right|rh|\(r\)/.test(s) ? "FRONT_DOOR_RIGHT" : "FRONT_DOOR_LEFT";
  }
  if (/rear.*door|back.*door|door.*rear/.test(s)) {
    return /right|rh|\(r\)/.test(s) ? "BACK_DOOR_RIGHT" : "BACK_DOOR_LEFT";
  }
  if (/radiator|support/.test(s)) return "RADIATOR_SUPPORT";
  if (/side\s*sill|rocker/.test(s)) {
    return /right|rh|\(r\)/.test(s) ? "SIDE_SILL_RIGHT" : "SIDE_SILL_LEFT";
  }
  if (/front.*bumper|bumper.*front/.test(s)) return "FRONT_BUMPER";
  if (/rear.*bumper|bumper.*rear/.test(s)) return "REAR_BUMPER";
  if (/\ba[\s-]?pillar\b/.test(s)) {
    return /right|rh/.test(s) ? "A_PILLAR_RIGHT" : "A_PILLAR_LEFT";
  }
  if (/\bb[\s-]?pillar\b/.test(s)) {
    return /right|rh/.test(s) ? "B_PILLAR_RIGHT" : "B_PILLAR_LEFT";
  }
  if (/\bc[\s-]?pillar\b/.test(s)) {
    return /right|rh/.test(s) ? "C_PILLAR_RIGHT" : "C_PILLAR_LEFT";
  }
  return undefined;
}

function asArr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function parseMeta(raw: EventLike["metadata"]): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function str(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  return t || undefined;
}

function num(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function title(value: unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "object") {
    const row = value as Record<string, unknown>;
    return str(row.title) ?? str(row.name) ?? str(row.code);
  }
  return undefined;
}

function formatDate(value: unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string") {
    const digits = value.replace(/\D/g, "");
    if (digits.length === 8) {
      return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
    }
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  }
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
}
