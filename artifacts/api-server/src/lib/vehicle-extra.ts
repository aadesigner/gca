/**
 * Auction / listing specs (keys, condition, airbags, …) — not timeline events.
 * US Copart/IAA/Import Motor lot attributes live here; Korean registry history stays in events.
 */

import { isAccidentEvent } from "./accidents";
import { isSalvageTitleEvent } from "./salvage-title";
import {
  collapseFirstRegistrationEvents,
  firstRegistrationScore,
  isFirstRegistrationEvent,
} from "./providers/web-html";

export interface VehicleExtraRow {
  key: string;
  label: string;
  value: string;
  source?: string;
  observedAt?: string;
}

type EventLike = {
  eventType?: string | null;
  description?: string | null;
  occurredAt?: Date | string | null;
  metadata?: string | Record<string, unknown> | null;
};

/** Metadata.field values that are lot specs, not history. */
const EXTRA_SPEC_FIELDS = new Set([
  "keys",
  "key_status",
  "keystatus",
  "condition",
  "airbags",
  "airbag",
  "odometer_status",
  "odometerstatus",
  "runs_drives",
  "runs",
  "engine_starts",
  "loss_type",
  "losstype",
  "stock_number",
  "stocknumber",
  "repair_cost",
  "repaircost",
  "actual_cash_value",
  "actualcashvalue",
  "auction_type",
  "auctiontype",
  "auction_house",
  "auctionhouse",
  "engine",
  "cylinders",
  "highlights",
  "steering_type",
  "steeringtype",
  "steering",
  "drive_side",
  "driveside",
  "seizure",
  "mortgage",
  "tax_arrears",
  "taxarrears",
  "sales_method",
  "salesmethod",
  "secondary_damage",
  "secondarydamage",
  "primary_damage",
  "primarydamage",
  "regional_specs",
  "regionalspecs",
  "doors",
  "seats",
  "seat",
  "grade",
  "package",
  "vehicle_category",
  "vehiclecategory",
  // Encar Korean performance inspection — only vehicle condition in extras.
  // Record #, dates, mileage, structure, comments, panels, simpleRepair → events / damages / diagram.
  "inspection_condition",
  // Autowini boolean flag — not a dated inspection report body.
  "inspection_report_uploaded",
  "inspectionreportuploaded",
]);

const EXTRA_LABELS: Record<string, string> = {
  keys: "Keys",
  key_status: "Key status",
  condition: "Condition",
  airbags: "Airbags",
  odometer_status: "Odometer status",
  runs_drives: "Runs & drives",
  loss_type: "Loss type",
  stock_number: "Stock number",
  repair_cost: "Repair cost",
  actual_cash_value: "Actual cash value",
  auction_type: "Auction type",
  auction_house: "Auction house",
  engine: "Engine",
  cylinders: "Cylinders",
  highlights: "Highlights",
  steering_type: "Steering",
  steering: "Steering",
  drive_side: "Steering",
  seizure: "Seizure",
  mortgage: "Mortgage",
  tax_arrears: "Tax arrears",
  sales_method: "Sales method",
  secondary_damage: "Secondary damage",
  primary_damage: "Primary damage",
  regional_specs: "Regional specs",
  doors: "Doors",
  seats: "Seats",
  seat: "Seats",
  grade: "Grade",
  package: "Package",
  vehicle_category: "Category",
  inspection_condition: "Inspection vehicle condition",
  inspection_report_uploaded: "Inspection report",
};

const DESC_EXTRA_PATTERNS: Array<{ re: RegExp; key: string }> = [
  { re: /^keys available:\s*(.+)$/i, key: "keys" },
  { re: /^keys:\s*(.+)$/i, key: "keys" },
  { re: /^key status:\s*(.+)$/i, key: "key_status" },
  { re: /^airbags?:\s*(.+)$/i, key: "airbags" },
  { re: /^odometer status:\s*(.+)$/i, key: "odometer_status" },
  { re: /^runs\s*(?:and|&)\s*drives?:\s*(.+)$/i, key: "runs_drives" },
  { re: /^loss type:\s*(.+)$/i, key: "loss_type" },
  { re: /^primary damage:\s*(.+)$/i, key: "condition" },
  { re: /^secondary damage:\s*(.+)$/i, key: "secondary_damage" },
  { re: /^stock(?:\s*#| number)?:\s*(.+)$/i, key: "stock_number" },
  { re: /^repair cost:\s*(.+)$/i, key: "repair_cost" },
  { re: /^actual cash value:\s*(.+)$/i, key: "actual_cash_value" },
  { re: /^auction type:\s*(.+)$/i, key: "auction_type" },
  { re: /^auction house:\s*(.+)$/i, key: "auction_house" },
  { re: /^steering:\s*(.+)$/i, key: "steering_type" },
  { re: /^seats?:\s*(.+)$/i, key: "seats" },
  { re: /^doors?:\s*(.+)$/i, key: "doors" },
  { re: /^(left[-\s]?hand(?:\s+drive)?|lhd|hand\s+left(?:\s+driving)?)\s*$/i, key: "steering_type" },
  { re: /^(right[-\s]?hand(?:\s+drive)?|rhd|hand\s+right(?:\s+driving)?)\s*$/i, key: "steering_type" },
  { re: /^autowini inspection report uploaded$/i, key: "inspection_report_uploaded" },
];

/** True when this event is a static lot spec (belongs in extra, not events). */
export function isExtraSpecEvent(event: EventLike): boolean {
  const meta = parseMeta(event.metadata);
  const field = normalizeFieldKey(str(meta.field));
  if (field && EXTRA_SPEC_FIELDS.has(field)) return true;
  // Legacy inspection_panel_* extras stay out of Extra and surface on Events instead.
  if (field?.startsWith("inspection_panel_")) return false;
  if (str(meta.kind) === "specs" && (meta.seats != null || meta.doors != null)) return true;

  const desc = str(event.description) ?? "";
  if (/^keys available:/i.test(desc)) return true;
  if (/^key status:/i.test(desc)) return true;
  if (/^airbags?:/i.test(desc) && (event.eventType ?? "").toLowerCase() === "other") return true;
  if (/^odometer status:/i.test(desc)) return true;
  if (/^runs\s*(?:and|&)\s*drives?:/i.test(desc)) return true;
  if (/^condition:/i.test(desc) && (event.eventType ?? "").toLowerCase() === "other") return true;
  if (/^primary damage:/i.test(desc)) return true;
  if (/^secondary damage:/i.test(desc)) return true;
  if (/^loss type:/i.test(desc)) return true;
  if (/^steering:/i.test(desc)) return true;
  if (/^autowini inspection report uploaded$/i.test(desc)) return true;
  if (/^seats?:/i.test(desc) && (event.eventType ?? "").toLowerCase() === "other") return true;
  if (/^doors?:/i.test(desc) && (event.eventType ?? "").toLowerCase() === "other") return true;
  if (/\b(left[-\s]?hand|right[-\s]?hand|hand\s+left|hand\s+right)\b/i.test(desc)) return true;
  if (/^(lhd|rhd)\b/i.test(desc) && (event.eventType ?? "").toLowerCase() === "other") return true;

  return false;
}

/** Collapse spec events (+ accident condition metadata) into extra rows. */
export function buildVehicleExtra(events: EventLike[]): VehicleExtraRow[] | null {
  const rows: VehicleExtraRow[] = [];
  const seen = new Set<string>();

  const add = (key: string, value: string, _source?: string, observedAt?: string) => {
    const normKey = normalizeFieldKey(key) ?? key;
    const text = value.trim();
    if (!text) return;
    const dedupe = `${normKey}:${text.toLowerCase()}`;
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    // Extras are field + value + optional date only — never expose provider source.
    rows.push({
      key: normKey,
      label: EXTRA_LABELS[normKey] ?? titleCase(normKey),
      value: text,
      observedAt,
    });
  };

  for (const event of events) {
    if (isExtraSpecEvent(event)) {
      const meta = parseMeta(event.metadata);
      // Combined Autoplac-style specs blob → split doors/seats into separate extras.
      if (str(meta.kind) === "specs" && (meta.seats != null || meta.doors != null)) {
        const observed = formatDate(event.occurredAt) ?? str(meta.date);
        if (meta.doors != null) add("doors", String(meta.doors), str(meta.source), observed);
        if (meta.seats != null) add("seats", String(meta.seats), str(meta.source), observed);
        continue;
      }
      const field = normalizeFieldKey(str(meta.field)) ?? keyFromDescription(event.description);
      let value =
        str(meta.value) ??
        valueFromDescription(event.description, field) ??
        str(event.description);
      if (field === "inspection_report_uploaded") value = "Uploaded";
      if (!field || !value) continue;
      add(
        field,
        formatExtraValue(field, value),
        str(meta.source),
        formatDate(event.occurredAt) ?? str(meta.date),
      );
      continue;
    }

    if (isAccidentEvent(event)) {
      const meta = parseMeta(event.metadata);
      // Encar inspection accident/simpleRepair flags belong in damages, not Extra.
      if (str(meta.source) !== "encar_inspection") {
        const condition = str(meta.condition);
        if (condition) {
          add("condition", condition, str(meta.source), formatDate(event.occurredAt));
        }
      }
    }

    // Encar performance inspection — only vehicle condition belongs in extras.
    const meta = parseMeta(event.metadata);
    if (str(meta.source) === "encar_inspection" && !isExtraSpecEvent(event)) {
      const observed =
        formatDate(event.occurredAt) ??
        str(meta.issueDate) ??
        str(meta.validityStartDate) ??
        str(meta.date);
      const car = str(meta.carState);
      if (car && !/^none$/i.test(car) && !/[가-힣]/.test(car)) {
        add("inspection_condition", car, undefined, observed);
      }
    }
  }

  if (rows.length === 0) return null;

  // At most one first_registration extra — prefer the most precise value.
  const firstRegs = rows.filter((r) => r.key === "first_registration");
  if (firstRegs.length > 1) {
    const best = firstRegs.reduce((a, b) =>
      firstRegistrationScore({
        eventType: "delivery",
        description: `First registration: ${b.value}`,
        metadata: { field: "firstRegistration", value: b.value },
      }) >
      firstRegistrationScore({
        eventType: "delivery",
        description: `First registration: ${a.value}`,
        metadata: { field: "firstRegistration", value: a.value },
      })
        ? b
        : a,
    );
    rows.splice(0, rows.length, ...rows.filter((r) => r.key !== "first_registration"), best);
  }

  return rows.sort((a, b) => a.label.localeCompare(b.label));
}

/** Timeline events only — excludes specs and rows already in structured categories. */
export function filterTimelineEvents(events: EventLike[]): EventLike[] {
  const filtered = events.filter((event) => {
    if (isExtraSpecEvent(event)) return false;
    if (isAccidentEvent(event)) return false;
    if (isSalvageTitleEvent(event)) return false;
    const type = (event.eventType ?? "").toLowerCase();
    if (type === "owner_change" || type === "sale") return false;
    if (isBuyNowNoise(event)) return false;
    return true;
  });
  // One first-registration delivery per VIN in the public/admin JSON timeline.
  // Collapse Encar inspection field dumps (valid from/until, comments, …) into one event per date.
  return sortTimelineEvents(
    collapseStickyDuplicateEvents(
      collapseInspectionDetailEvents(collapseFirstRegistrationEvents(filtered)),
    ),
  );
}

/** Field keys emitted historically as one `other` row per inspection fact. */
const INSPECTION_FRAGMENT_FIELDS = new Set([
  "inspection_mileage",
  "inspection_record_no",
  "inspection_issued",
  "inspection_valid_from",
  "inspection_valid_to",
  "inspection_structure",
  "inspection_condition",
  "inspection_comments",
  "simple_repair",
]);

const INSPECTION_FRAGMENT_DESC =
  /^(inspection\s+(valid from|valid until|odometer|issued|record\s*#|structure\/frame|vehicle condition|comments)\s*:|simple outer-panel repair\s*:\s*yes|performance inspection record\b|inspection panel notes\b)/i;

/**
 * Merge same-date Encar inspection detail rows (valid from/until, comments, odometer, …)
 * into a single inspection event. Panel findings fold into that same row when present.
 */
export function collapseInspectionDetailEvents<T extends EventLike>(events: T[]): T[] {
  const kept: T[] = [];
  const byDate = new Map<string, T[]>();

  for (const event of events) {
    if (!isEncarInspectionRelated(event)) {
      kept.push(event);
      continue;
    }
    const day = inspectionEventDay(event) ?? "_unknown";
    const bucket = byDate.get(day);
    if (bucket) bucket.push(event);
    else byDate.set(day, [event]);
  }

  for (const [, group] of byDate) {
    const primaries = group.filter(isPrimaryInspectionEvent);
    const panels = group.filter(isInspectionPanelEvent);
    const fragments = group.filter(
      (e) => isInspectionFragmentEvent(e) && !isPrimaryInspectionEvent(e) && !isInspectionPanelEvent(e),
    );
    const other = group.filter(
      (e) =>
        !isPrimaryInspectionEvent(e) &&
        !isInspectionPanelEvent(e) &&
        !isInspectionFragmentEvent(e),
    );

    let primary = pickRichestInspection(primaries);

    if (!primary && (fragments.length > 0 || panels.length > 0)) {
      primary = synthesizeInspectionFromFragments(fragments, panels) as T;
    }

    if (primary) {
      const merged = mergeInspectionDetails(primary, fragments, panels);
      kept.push(merged);
      // Drop duplicate primary summaries for the same day.
    } else {
      kept.push(...primaries);
    }

    // Recalls / usage / serious defects stay as their own rows.
    kept.push(...other);
  }

  return kept;
}

function isEncarInspectionRelated(event: EventLike): boolean {
  const meta = parseMeta(event.metadata);
  const source = (str(meta.source) ?? "").toLowerCase();
  if (source === "encar_inspection" || source === "encar_inspection_panels") return true;
  const desc = str(event.description) ?? "";
  if (/^korean performance inspection\b/i.test(desc)) return true;
  if (/^inspection findings\b/i.test(desc)) return true;
  if (INSPECTION_FRAGMENT_DESC.test(desc)) return true;
  return false;
}

function isPrimaryInspectionEvent(event: EventLike): boolean {
  const type = (event.eventType ?? "").toLowerCase();
  const meta = parseMeta(event.metadata);
  const source = (str(meta.source) ?? "").toLowerCase();
  const desc = str(event.description) ?? "";
  if (source === "encar_inspection_panels") return false;
  if (/^inspection findings\b/i.test(desc) || /^inspection panel notes\b/i.test(desc)) return false;
  if (isInspectionFragmentEvent(event) && !/^korean performance inspection\b/i.test(desc)) return false;
  if (type === "inspection" && (source === "encar_inspection" || /^korean performance inspection\b/i.test(desc))) {
    return true;
  }
  if (/^korean performance inspection\b/i.test(desc)) return true;
  if (/^performance inspection record\b/i.test(desc)) return true;
  return false;
}

function isInspectionPanelEvent(event: EventLike): boolean {
  const meta = parseMeta(event.metadata);
  const source = (str(meta.source) ?? "").toLowerCase();
  const desc = str(event.description) ?? "";
  if (source === "encar_inspection_panels") return true;
  return /^inspection findings\b/i.test(desc) || /^inspection panel notes\b/i.test(desc);
}

function isInspectionFragmentEvent(event: EventLike): boolean {
  const meta = parseMeta(event.metadata);
  const field = normalizeFieldKey(str(meta.field));
  if (field && INSPECTION_FRAGMENT_FIELDS.has(field)) return true;
  // first_registration extras from the heal script — only when tagged encar_inspection
  if (field === "first_registration" && (str(meta.source) ?? "").toLowerCase() === "encar_inspection") {
    return true;
  }
  const desc = str(event.description) ?? "";
  return INSPECTION_FRAGMENT_DESC.test(desc);
}

function inspectionEventDay(event: EventLike): string | undefined {
  const meta = parseMeta(event.metadata);
  return (
    str(meta.issueDate) ||
    str(meta.date) ||
    formatDate(event.occurredAt) ||
    str(meta.validityStartDate)
  );
}

function pickRichestInspection<T extends EventLike>(primaries: T[]): T | undefined {
  if (primaries.length === 0) return undefined;
  return [...primaries].sort((a, b) => inspectionRichness(b) - inspectionRichness(a))[0];
}

function inspectionRichness(event: EventLike): number {
  const desc = str(event.description) ?? "";
  const meta = parseMeta(event.metadata);
  let score = desc.length;
  if (/^korean performance inspection\b/i.test(desc)) score += 500;
  if (meta.mileageKm != null || meta.mileage != null) score += 50;
  if (meta.recordNo) score += 40;
  if (meta.comments) score += 30;
  if (meta.validityStartDate || meta.validityEndDate) score += 20;
  if (meta.carState || meta.boardState) score += 20;
  return score;
}

function synthesizeInspectionFromFragments(
  fragments: EventLike[],
  panels: EventLike[],
): EventLike {
  const parts = ["Korean performance inspection"];
  const meta: Record<string, unknown> = { source: "encar_inspection" };
  let occurredAt: EventLike["occurredAt"];

  for (const frag of [...fragments, ...panels]) {
    occurredAt = occurredAt ?? frag.occurredAt;
    const fm = parseMeta(frag.metadata);
    Object.assign(meta, pickInspectionMeta(fm));
    const desc = str(frag.description);
    if (desc && !INSPECTION_FRAGMENT_DESC.test(desc) && !/^inspection findings\b/i.test(desc)) {
      parts.push(desc);
    }
  }

  appendFragmentFacts(parts, meta, fragments);
  appendPanelFindings(parts, meta, panels);

  return {
    eventType: "inspection",
    description: parts.join(" — "),
    occurredAt,
    metadata: meta,
  };
}

function mergeInspectionDetails<T extends EventLike>(
  primary: T,
  fragments: EventLike[],
  panels: EventLike[],
): T {
  if (fragments.length === 0 && panels.length === 0) return primary;

  const meta = { ...parseMeta(primary.metadata) };
  for (const frag of fragments) Object.assign(meta, pickInspectionMeta(parseMeta(frag.metadata)));
  for (const panel of panels) {
    const pm = parseMeta(panel.metadata);
    if (pm.panels && !meta.panels) meta.panels = pm.panels;
    if (pm.bodyCondition) meta.bodyCondition = pm.bodyCondition;
  }

  const parts = [str(primary.description) ?? "Korean performance inspection"];
  appendFragmentFacts(parts, meta, fragments);
  appendPanelFindings(parts, meta, panels);

  return {
    ...primary,
    eventType: primary.eventType || "inspection",
    description: dedupeDescriptionParts(parts).join(" — "),
    metadata: meta,
  };
}

function pickInspectionMeta(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of [
    "recordNo",
    "mileage",
    "mileageKm",
    "vin",
    "date",
    "issueDate",
    "firstRegistrationDate",
    "validityStartDate",
    "validityEndDate",
    "boardState",
    "carState",
    "waterlog",
    "accidentFlagged",
    "simpleRepair",
    "comments",
    "panels",
    "bodyCondition",
  ] as const) {
    if (meta[key] != null && meta[key] !== "") out[key] = meta[key];
  }
  // Heal-script extras store facts under field/value.
  const field = normalizeFieldKey(str(meta.field));
  const value = str(meta.value);
  if (field && value) {
    if (field === "inspection_mileage") {
      const km = Number(value.replace(/[^\d.]/g, ""));
      if (Number.isFinite(km)) {
        out.mileage = km;
        out.mileageKm = km;
      }
    } else if (field === "inspection_record_no") out.recordNo = value;
    else if (field === "inspection_issued") {
      out.issueDate = value;
      out.date = value;
    } else if (field === "inspection_valid_from") out.validityStartDate = value;
    else if (field === "inspection_valid_to") out.validityEndDate = value;
    else if (field === "inspection_structure") out.boardState = value;
    else if (field === "inspection_condition") out.carState = value;
    else if (field === "inspection_comments") out.comments = value;
    else if (field === "first_registration") out.firstRegistrationDate = value;
    else if (field === "simple_repair") out.simpleRepair = /yes|true|1/i.test(value);
  }
  return out;
}

function appendFragmentFacts(
  parts: string[],
  meta: Record<string, unknown>,
  fragments: EventLike[],
): void {
  const blob = parts.join(" — ").toLowerCase();
  const push = (needle: RegExp, text: string) => {
    if (!needle.test(blob)) parts.push(text);
  };

  if (meta.recordNo != null) push(/record\s*#/, `record #${meta.recordNo}`);
  if (meta.issueDate) push(/issued\s+\d{4}-\d{2}-\d{2}/, `issued ${meta.issueDate}`);
  if (meta.mileageKm != null || meta.mileage != null) {
    const km = Number(meta.mileageKm ?? meta.mileage);
    if (Number.isFinite(km)) push(/\d[\d,]*\s*km/, `${km.toLocaleString("en-US")} km`);
  }
  if (meta.boardState && !/^none$/i.test(String(meta.boardState))) {
    push(/structure\/frame:/, `structure/frame: ${meta.boardState}`);
  }
  if (meta.carState && !/^none$/i.test(String(meta.carState))) {
    push(/vehicle condition:/, `vehicle condition: ${meta.carState}`);
  }
  if (meta.validityStartDate && meta.validityEndDate) {
    push(/valid\s+\d{4}-\d{2}-\d{2}/, `valid ${meta.validityStartDate} → ${meta.validityEndDate}`);
  } else if (meta.validityEndDate) {
    push(/valid until/, `valid until ${meta.validityEndDate}`);
  } else if (meta.validityStartDate) {
    push(/valid from|valid\s+\d{4}/, `valid from ${meta.validityStartDate}`);
  }
  if (meta.firstRegistrationDate) {
    push(/first registered/, `first registered ${meta.firstRegistrationDate}`);
  }
  if (meta.comments) push(/comments:/, `comments: ${meta.comments}`);
  if (meta.simpleRepair === true) push(/simple outer-panel repair/, "simple outer-panel repair flagged");

  // Comments only present as a fragment description.
  for (const frag of fragments) {
    const desc = str(frag.description) ?? "";
    const m = desc.match(/^Inspection comments:\s*(.+)$/i);
    if (m?.[1] && !/comments:/i.test(parts.join(" — "))) {
      parts.push(`comments: ${m[1].trim()}`);
    }
  }
}

function appendPanelFindings(
  parts: string[],
  meta: Record<string, unknown>,
  panels: EventLike[],
): void {
  if (panels.length === 0) return;
  const blob = parts.join(" — ").toLowerCase();
  if (/inspection findings|findings —/i.test(blob)) return;

  for (const panel of panels) {
    const desc = str(panel.description) ?? "";
    if (/^inspection panel notes\b/i.test(desc) && /none/i.test(desc) && !/:\s*(?!none)[^;]+/i.test(desc)) {
      continue; // drop junk "None" panel notes
    }
    if (/^inspection findings\b/i.test(desc)) {
      parts.push(desc.replace(/^inspection findings\s*[—:-]\s*/i, "findings: "));
    } else if (desc && !/^inspection panel notes\b/i.test(desc)) {
      parts.push(desc);
    }
    const pm = parseMeta(panel.metadata);
    if (pm.panels && !meta.panels) meta.panels = pm.panels;
    if (pm.bodyCondition) meta.bodyCondition = true;
  }
}

function dedupeDescriptionParts(parts: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const key = part.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(part.trim());
  }
  return out;
}

/**
 * Display order: newest → oldest by occurredAt (strict chronology).
 * First-registration is NOT pinned to the top — that made timelines jump
 * (e.g. 2020 delivery then 2026 listings) and looked unordered.
 */
export function sortTimelineEvents<T extends EventLike>(events: T[]): T[] {
  return [...events].sort((a, b) => {
    const ta = a.occurredAt ? new Date(a.occurredAt).getTime() : 0;
    const tb = b.occurredAt ? new Date(b.occurredAt).getTime() : 0;
    if (tb !== ta) return tb - ta;
    // Stable tie-break: prefer first-reg slightly when same timestamp.
    const fa = isFirstRegistrationEvent(a) ? 1 : 0;
    const fb = isFirstRegistrationEvent(b) ? 1 : 0;
    return fb - fa;
  });
}

/** Drop repeated sticky Autowini-style flag rows (same type+description) that leaked in historically. */
function collapseStickyDuplicateEvents(events: EventLike[]): EventLike[] {
  const seen = new Set<string>();
  const out: EventLike[] = [];
  // Prefer oldest occurrence so the timeline date is stable.
  const sorted = [...events].sort((a, b) => {
    const ta = a.occurredAt ? new Date(a.occurredAt).getTime() : 0;
    const tb = b.occurredAt ? new Date(b.occurredAt).getTime() : 0;
    return ta - tb;
  });
  for (const event of sorted) {
    const meta = parseMeta(event.metadata);
    const sticky =
      meta.sticky === true ||
      str(meta.field) === "inspectionReportUploaded" ||
      str(meta.field) === "odometerCheck" ||
      str(meta.field) === "hasInsuranceHistory" ||
      str(meta.field) === "steeringType";
    if (!sticky) {
      out.push(event);
      continue;
    }
    const key = `${(event.eventType ?? "").toLowerCase()}|${(event.description ?? "").toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(event);
  }
  return out;
}

function isBuyNowNoise(event: EventLike): boolean {
  const meta = parseMeta(event.metadata);
  if (str(meta.field) === "buy_now") return true;
  return /^buy\s*now\s*:/i.test(str(event.description) ?? "");
}

function keyFromDescription(description: string | null | undefined): string | undefined {
  const desc = str(description);
  if (!desc) return undefined;
  for (const { re, key } of DESC_EXTRA_PATTERNS) {
    if (re.test(desc)) return key;
  }
  return undefined;
}

function valueFromDescription(
  description: string | null | undefined,
  field?: string,
): string | undefined {
  const desc = str(description);
  if (!desc) return undefined;
  for (const { re, key } of DESC_EXTRA_PATTERNS) {
    if (field && key !== field) continue;
    const m = desc.match(re);
    if (m?.[1]) return m[1].trim();
  }
  return undefined;
}

function formatExtraValue(field: string, value: string): string {
  const key = normalizeFieldKey(field) ?? field;
  if (key === "steering_type" || key === "steering" || key === "drive_side") {
    return formatSteeringValue(value);
  }
  return translateExtraValue(value);
}

/**
 * Translate Korean auction/dealer phrases in extra values (Seobuk sales_method, etc.).
 * Proper nouns (dealer names) are left as-is; labels and yes/no become English.
 */
export function translateExtraValue(raw: string): string {
  let t = raw.replace(/\s+/g, " ").trim();
  if (!t) return t;
  if (!/[가-힣]/.test(t)) return t;

  t = t.replace(/^\?\s*/, "");

  const phraseMap: Array<[RegExp, string]> = [
    [/판매상사\s*[：:]/g, "Selling dealer: "],
    [/판매방식\s*[：:]/g, "Sales method: "],
    [/광고동의여부\s*[：:]/g, "Ad consent: "],
    [/판매자\s*[：:]/g, "Seller: "],
    [/딜러\s*[：:]/g, "Dealer: "],
    [/매매상사\s*[：:]/g, "Dealer: "],
    [/압류\s*[：:]/g, "Seizure: "],
    [/저당\s*[：:]/g, "Mortgage: "],
    [/세금체납\s*[：:]/g, "Tax arrears: "],
    [/미납세금\s*[：:]/g, "Unpaid tax: "],
    [/미동의|비동의|부동의/g, "Not agreed"],
    [/동의/g, "Agreed"],
    [/없음/g, "None"],
    [/있음/g, "Yes"],
    [/\(주\)/g, "Co. "],
    [/주식회사/g, "Co. "],
  ];
  for (const [re, en] of phraseMap) t = t.replace(re, en);

  // Collapse leftover Hangul label crumbs into readable separators.
  t = t
    .replace(/\s{2,}/g, " ")
    .replace(/\s*·\s*/g, " · ")
    .replace(/\s*([|｜])\s*/g, " · ")
    .trim();

  // If Hangul remains only inside parentheses (city names etc.), leave it;
  // otherwise append a light romanization-free cleanup of common city tags.
  t = t
    .replace(/\(수원\)/g, "(Suwon)")
    .replace(/\(안산\)/g, "(Ansan)")
    .replace(/\(인천\)/g, "(Incheon)")
    .replace(/\(서울\)/g, "(Seoul)")
    .replace(/\(부산\)/g, "(Busan)")
    .replace(/\(대구\)/g, "(Daegu)")
    .replace(/\(대전\)/g, "(Daejeon)")
    .replace(/\(광주\)/g, "(Gwangju)")
    .replace(/\(울산\)/g, "(Ulsan)")
    .replace(/\(경기\)/g, "(Gyeonggi)")
    .replace(/\(성남\)/g, "(Seongnam)")
    .replace(/\(용인\)/g, "(Yongin)")
    .replace(/\(고양\)/g, "(Goyang)")
    .replace(/\(부천\)/g, "(Bucheon)")
    .replace(/\(화성\)/g, "(Hwaseong)")
    .replace(/\(평택\)/g, "(Pyeongtaek)")
    .replace(/\(천안\)/g, "(Cheonan)")
    .replace(/\(청주\)/g, "(Cheongju)");

  return t.trim();
}

function formatSteeringValue(raw: string): string {
  const t = raw.trim();
  if (/lhd|\bleft\b|hand\s+left/i.test(t)) return "Left-hand drive";
  if (/rhd|\bright\b|hand\s+right/i.test(t)) return "Right-hand drive";
  return translateExtraValue(t);
}

function normalizeFieldKey(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const t = raw.trim();
  if (!t) return undefined;
  const snake = t.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
  if (snake === "steeringtype" || snake === "steering_type" || snake === "steering") return "steering_type";
  if (snake === "driveside" || snake === "drive_side") return "steering_type";
  if (snake === "inspectionreportuploaded" || snake === "inspection_report_uploaded") {
    return "inspection_report_uploaded";
  }
  if (snake === "seat" || snake === "seats" || snake === "number_of_seats" || snake === "numberofseats") {
    return "seats";
  }
  if (EXTRA_SPEC_FIELDS.has(snake)) return snake;
  if (EXTRA_SPEC_FIELDS.has(t.toLowerCase())) return t.toLowerCase();
  return snake;
}

function titleCase(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
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

function formatDate(value: Date | string | unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
}
