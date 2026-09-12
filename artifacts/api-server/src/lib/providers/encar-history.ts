/**
 * Extract normalized vehicle history events from Encar supplementary API payloads.
 */

import type { NormalizedEvent } from "@workspace/providers";
import {
  normalizeEncarDiagnosisPanel,
  normalizeEncarDiagnosisResult,
  normalizeEncarFuel,
  normalizeEncarInspectionStatus,
  normalizeEncarMaker,
  translateEncarComment,
  translateEncarEventDescription,
  translateEncarInspectionPanel,
  containsHangul,
} from "./encar-locale";

export interface EncarAggregatedPayload {
  listingId?: string;
  vehicleId?: string;
  detail?: Record<string, unknown>;
  view?: Record<string, unknown> | null;
  diagnosis?: Record<string, unknown> | null;
  inspection?: Record<string, unknown> | null;
  record?: Record<string, unknown> | null;
}

interface EncarRecordAccident {
  type?: string;
  date?: string;
  insuranceBenefit?: number;
  partCost?: number;
  laborCost?: number;
  paintingCost?: number;
}

export function extractEncarEvents(payload: EncarAggregatedPayload): NormalizedEvent[] {
  const events: NormalizedEvent[] = [];
  events.push(...extractRecordEvents(payload.record));
  events.push(...extractDiagnosisEvents(payload.diagnosis));
  events.push(...extractInspectionEvents(payload.inspection));

  return events.map((event) => ({
    ...event,
    description: translateEncarEventDescription(event.description) ?? event.description,
  }));
}

export function extractEncarCounts(payload: EncarAggregatedPayload): {
  accidentCount?: number;
  ownerChangeCount?: number;
} {
  const record = payload.record;
  if (!record) return {};

  const myAccidents = num(record.myAccidentCnt);
  const otherAccidents = num(record.otherAccidentCnt);
  const accidentCount =
    myAccidents != null || otherAccidents != null
      ? (myAccidents ?? 0) + (otherAccidents ?? 0)
      : num(record.accidentCnt);

  return {
    accidentCount,
    ownerChangeCount: num(record.ownerChangeCnt),
  };
}

function extractRecordEvents(record: Record<string, unknown> | null | undefined): NormalizedEvent[] {
  if (!record || record.openData === false) return [];

  const events: NormalizedEvent[] = [];

  const firstDate = str(record.firstDate);
  if (firstDate) {
    events.push({
      eventType: "other",
      description: `First registration: ${firstDate}`,
      occurredAt: parseDate(firstDate),
      metadata: { source: "encar_record", field: "firstDate", value: firstDate },
    });
  }

  const ownerRows = arr(record.ownerChanges)
    .map((item, index) => {
      if (typeof item === "string") {
        const date = item.trim();
        return date ? { date, sequence: index + 1, mileage: undefined as number | undefined, plate: undefined as string | undefined } : null;
      }
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const date = str(row.date) ?? str(row.changeDate) ?? str(row.ownerChangeDate);
      if (!date) return null;
      return {
        date,
        sequence: index + 1,
        mileage: num(row.mileage) ?? num(row.mileageKm) ?? num(row.odometer) ?? num(row.km),
        plate: str(row.carNo) ?? str(row.plate),
      };
    })
    .filter((row): row is NonNullable<typeof row> => row != null);
  const totalOwners = num(record.ownerChangeCnt) ?? ownerRows.length;

  ownerRows.forEach((row) => {
    events.push({
      eventType: "owner_change",
      description: [
        `Owner change ${row.sequence} of ${ownerRows.length} recorded on ${row.date}`,
        row.mileage != null ? `${row.mileage.toLocaleString("en-US")} km` : null,
      ]
        .filter(Boolean)
        .join(" — "),
      occurredAt: parseDate(row.date),
      metadata: {
        source: "encar_record",
        date: row.date,
        sequence: row.sequence,
        total: ownerRows.length,
        ownerChangeCount: totalOwners,
        mileage: row.mileage,
        mileageKm: row.mileage,
        plate: row.plate,
      },
    });
  });

  for (const change of arr(record.carInfoChanges)) {
    if (!change || typeof change !== "object") continue;
    const item = change as Record<string, unknown>;
    const date = str(item.date);
    const carNo = str(item.carNo);
    if (!date) continue;
    events.push({
      eventType: "other",
      description: carNo
        ? `License plate update on ${date} (${carNo})`
        : `Vehicle registration update on ${date}`,
      occurredAt: parseDate(date),
      metadata: { source: "encar_record", date, carNo },
    });
  }

  if (num(record.totalLossCnt) > 0) {
    events.push({
      eventType: "total_loss",
      description: `Total loss recorded (${num(record.totalLossCnt)} incident(s))`,
      occurredAt: parseDate(str(record.totalLossDate) ?? str(record.regDate)),
      metadata: {
        source: "encar_record",
        totalLossCnt: num(record.totalLossCnt),
        totalLossDate: str(record.totalLossDate),
      },
    });
  }

  if (num(record.floodTotalLossCnt) > 0 || num(record.floodPartLossCnt) > 0) {
    events.push({
      eventType: "flood_damage",
      description: "Flood damage recorded in registry history",
      occurredAt: parseDate(str(record.floodDate) ?? str(record.regDate)),
      metadata: {
        source: "encar_record",
        floodTotalLossCnt: num(record.floodTotalLossCnt),
        floodPartLossCnt: num(record.floodPartLossCnt),
        floodDate: str(record.floodDate),
      },
    });
  }

  if (num(record.robberCnt) > 0) {
    events.push({
      eventType: "other",
      description: `Theft record reported (${num(record.robberCnt)} incident(s))`,
      occurredAt: parseDate(str(record.robberDate) ?? str(record.regDate)),
      metadata: {
        source: "encar_record",
        robberCnt: num(record.robberCnt),
        robberDate: str(record.robberDate),
      },
    });
  }

  let monetaryAccidentRows = 0;
  for (const accident of arr(record.accidents) as EncarRecordAccident[]) {
    if (!accident?.date) continue;
    const partCost = num(accident.partCost) ?? 0;
    const laborCost = num(accident.laborCost) ?? 0;
    const paintingCost = num(accident.paintingCost) ?? 0;
    const insuranceBenefit = num(accident.insuranceBenefit) ?? 0;
    const repairTotal = partCost + laborCost + paintingCost;
    const hasMoney = repairTotal > 0 || insuranceBenefit > 0;
    if (hasMoney) monetaryAccidentRows += 1;

    const typeLabel =
      translateEncarComment(accident.type) ?? str(accident.type) ?? "Insurance claim";
    const costBits = [
      partCost > 0 ? `parts ₩${partCost.toLocaleString("en-US")}` : null,
      laborCost > 0 ? `labor ₩${laborCost.toLocaleString("en-US")}` : null,
      paintingCost > 0 ? `paint ₩${paintingCost.toLocaleString("en-US")}` : null,
      repairTotal > 0 ? `total ₩${repairTotal.toLocaleString("en-US")}` : null,
      insuranceBenefit > 0 ? `payout ₩${insuranceBenefit.toLocaleString("en-US")}` : null,
    ].filter(Boolean);
    const description = hasMoney
      ? [`Insurance accident (${typeLabel}) on ${accident.date}`, ...costBits].join(" — ")
      : `Insurance claim recorded (${typeLabel}) on ${accident.date}`;

    events.push({
      eventType: "accident",
      description,
      occurredAt: parseDate(accident.date),
      metadata: {
        source: "encar_record",
        type: typeLabel,
        rawType: accident.type,
        date: accident.date,
        currency: "KRW",
        partCost: partCost > 0 ? partCost : undefined,
        laborCost: laborCost > 0 ? laborCost : undefined,
        paintingCost: paintingCost > 0 ? paintingCost : undefined,
        repairTotal: repairTotal > 0 ? repairTotal : undefined,
        insuranceBenefit: insuranceBenefit > 0 ? insuranceBenefit : undefined,
        emptyCosts: hasMoney ? undefined : true,
      },
    });
  }

  const myAccidentCost = num(record.myAccidentCost);
  const otherAccidentCost = num(record.otherAccidentCost);
  // Encar often ships dated stub rows (₩0) while still exposing non-zero totals —
  // only skip the summary when we already have monetary per-claim rows.
  if (
    ((myAccidentCost ?? 0) > 0 || (otherAccidentCost ?? 0) > 0) &&
    monetaryAccidentRows === 0
  ) {
    events.push({
      eventType: "accident",
      description: `Total insurance repair exposure — own: ₩${(myAccidentCost ?? 0).toLocaleString("en-US")}, third party: ₩${(otherAccidentCost ?? 0).toLocaleString("en-US")}`,
      occurredAt: parseDate(str(record.regDate) ?? new Date().toISOString().slice(0, 10)),
      metadata: {
        source: "encar_record_summary",
        type: "Registry totals",
        currency: "KRW",
        repairTotal: (myAccidentCost ?? 0) + (otherAccidentCost ?? 0) || undefined,
        myAccidentCost,
        otherAccidentCost,
        myAccidentCnt: num(record.myAccidentCnt),
        otherAccidentCnt: num(record.otherAccidentCnt),
      },
    });
  }

  if (num(record.loan) > 0) {
    events.push({
      eventType: "other",
      description: "Active lien/loan flagged on registry record",
      occurredAt: parseDate(str(record.regDate) ?? new Date().toISOString().slice(0, 10)),
      metadata: { source: "encar_record", loan: num(record.loan) },
    });
  }

  if (num(record.government) > 0) {
    events.push({
      eventType: "other",
      description: "Government-use history flagged on Korean registry",
      occurredAt: parseDate(str(record.firstDate) ?? str(record.regDate)),
      metadata: { source: "encar_record", government: num(record.government) },
    });
  }

  if (num(record.business) > 0) {
    events.push({
      eventType: "other",
      description: "Commercial/business-use history flagged on Korean registry",
      occurredAt: parseDate(str(record.firstDate) ?? str(record.regDate)),
      metadata: { source: "encar_record", business: num(record.business) },
    });
  }

  for (let i = 1; i <= 5; i++) {
    const gap = str(record[`notJoinDate${i}`]);
    if (!gap) continue;
    events.push({
      eventType: "other",
      description: `Insurance coverage gap: ${gap.replace("~", " to ")}`,
      occurredAt: parseDate(gap.slice(0, 4) + "-" + gap.slice(4, 6) + "-01"),
      metadata: { source: "encar_record", field: `notJoinDate${i}`, value: gap },
    });
  }

  return events;
}

function extractDiagnosisEvents(
  diagnosis: Record<string, unknown> | null | undefined,
): NormalizedEvent[] {
  if (!diagnosis) return [];

  const events: NormalizedEvent[] = [];
  const occurredAt = parseDate(str(diagnosis.diagnosisDate) ?? str(diagnosis.realDiagnosisDate));
  const replacements: string[] = [];
  const comments: string[] = [];

  for (const item of arr(diagnosis.items)) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const name = str(row.name);
    const resultCode = str(row.resultCode);
    const result = str(row.result);

    if (name === "CHECKER_COMMENT" || name === "OUTER_PANEL_COMMENT") {
      const translated = translateEncarComment(result);
      if (translated) comments.push(translated);
      continue;
    }

    if (resultCode === "REPLACEMENT" && name) {
      replacements.push(normalizeEncarDiagnosisPanel(name));
    } else if (resultCode && resultCode !== "NORMAL" && name) {
      replacements.push(
        `${normalizeEncarDiagnosisPanel(name)}: ${normalizeEncarDiagnosisResult(resultCode, result)}`,
      );
    }
  }

  if (replacements.length > 0) {
    events.push({
      eventType: "inspection",
      description: `Encar diagnosis — ${replacements.join(", ")}`,
      occurredAt,
      metadata: {
        source: "encar_diagnosis",
        diagnosisNo: num(diagnosis.diagnosisNo),
        center: str(diagnosis.reservationCenterName),
        panels: replacements,
      },
    });
  }

  if (comments.length > 0) {
    const translated = comments
      .map((c) => translateEncarComment(c))
      .filter(Boolean)
      .join(" / ");

    const description =
      translated && !containsHangul(translated)
        ? translated
        : buildDiagnosisSummaryEnglish(replacements, comments);

    if (description) {
      events.push({
        eventType: "other",
        description,
        occurredAt,
        metadata: { source: "encar_diagnosis", comments },
      });
    }
  }

  return events;
}

function extractInspectionEvents(
  inspection: Record<string, unknown> | null | undefined,
): NormalizedEvent[] {
  if (!inspection) return [];

  const events: NormalizedEvent[] = [];
  const master = (inspection.master ?? {}) as Record<string, unknown>;
  const detail = (master.detail ?? {}) as Record<string, unknown>;

  const issueDate = formatEncarDate(str(master.registrationDate) ?? str(detail.issueDate));
  const firstReg = formatEncarDate(str(detail.firstRegistrationDate));
  const validFrom = formatEncarDate(str(detail.validityStartDate));
  const validTo = formatEncarDate(str(detail.validityEndDate));
  const occurredAt = parseDate(issueDate ?? validFrom ?? firstReg);

  const mileage = num(detail.mileage);
  const inspectionVin = str(detail.vin);
  const recordNo = str(detail.recordNo);
  const boardState = normalizeEncarInspectionStatus(title(detail.boardStateType)) ??
    normalizeEncarInspectionStatus(str(detail.boardStateType));
  const carState = normalizeEncarInspectionStatus(title(detail.carStateType)) ??
    normalizeEncarInspectionStatus(str(detail.carStateType));
  const comments = translateEncarComment(str(detail.comments));
  const waterlog = detail.waterlog === true;
  const accidentFlagged = master.accdient === true || master.accident === true;
  const simpleRepair = master.simpleRepair === true;

  const meaningfulBoard = isMeaningfulInspectionStatus(boardState);
  const meaningfulCar = isMeaningfulInspectionStatus(carState);

  // Human-readable performance inspection summary (dates + statuses in English).
  const summaryParts: string[] = ["Korean performance inspection"];
  if (recordNo) summaryParts.push(`record #${recordNo}`);
  if (issueDate) summaryParts.push(`issued ${issueDate}`);
  if (mileage != null) summaryParts.push(`${mileage.toLocaleString("en-US")} km`);
  if (meaningfulBoard) summaryParts.push(`structure/frame: ${boardState}`);
  if (meaningfulCar) summaryParts.push(`vehicle condition: ${carState}`);
  if (!meaningfulBoard && !meaningfulCar && (boardState || carState)) {
    summaryParts.push("no defects noted on structure or condition check");
  }
  if (validFrom && validTo) summaryParts.push(`valid ${validFrom} → ${validTo}`);
  else if (validTo) summaryParts.push(`valid until ${validTo}`);
  if (firstReg) summaryParts.push(`first registered ${firstReg}`);

  if (
    mileage != null ||
    inspectionVin ||
    meaningfulBoard ||
    meaningfulCar ||
    issueDate ||
    validFrom ||
    validTo ||
    firstReg ||
    recordNo
  ) {
    events.push({
      eventType: "inspection",
      description: summaryParts.join(" — "),
      occurredAt,
      metadata: {
        source: "encar_inspection",
        recordNo,
        mileage,
        mileageKm: mileage,
        vin: inspectionVin,
        issueDate,
        firstRegistrationDate: firstReg,
        validityStartDate: validFrom,
        validityEndDate: validTo,
        boardState: boardState ?? null,
        carState: carState ?? null,
        waterlog,
        accidentFlagged,
        simpleRepair,
        comments: comments ?? null,
      },
    });
  }

  // Structured extras (unified JSON) — one row per known fact.
  const pushExtra = (field: string, label: string, value?: string | number | null) => {
    if (value == null || value === "") return;
    const text = String(value).trim();
    if (!text) return;
    events.push({
      eventType: "other",
      description: `${label}: ${text}`,
      occurredAt,
      metadata: {
        source: "encar_inspection",
        field,
        value: text,
        date: issueDate ?? validFrom ?? firstReg,
      },
    });
  };

  pushExtra("inspection_record_no", "Inspection record #", recordNo);
  pushExtra(
    "inspection_mileage",
    "Inspection odometer",
    mileage != null ? `${mileage.toLocaleString("en-US")} km` : null,
  );
  pushExtra("inspection_issued", "Inspection issued", issueDate);
  pushExtra("inspection_valid_from", "Inspection valid from", validFrom);
  pushExtra("inspection_valid_to", "Inspection valid until", validTo);
  // First registration is persisted as a delivery event elsewhere — do not also
  // push a duplicate "other"/extra event for the same fact.
  if (meaningfulBoard) pushExtra("inspection_structure", "Inspection structure/frame", boardState);
  if (meaningfulCar) pushExtra("inspection_condition", "Inspection vehicle condition", carState);
  if (simpleRepair) pushExtra("simple_repair", "Simple outer-panel repair", "Yes");
  if (comments) pushExtra("inspection_comments", "Inspection comments", comments);

  if (waterlog) {
    events.push({
      eventType: "flood_damage",
      description: `Flood/water damage flagged on Korean performance inspection${issueDate ? ` (${issueDate})` : ""}`,
      occurredAt,
      metadata: {
        source: "encar_inspection",
        waterlog: true,
        mileage,
        mileageKm: mileage,
        date: issueDate,
      },
    });
  }

  if (accidentFlagged) {
    events.push({
      eventType: "accident",
      description: `Accident history flagged on Korean performance inspection${issueDate ? ` (${issueDate})` : ""}`,
      occurredAt,
      metadata: {
        source: "encar_inspection",
        accidentFlagged: true,
        mileage,
        mileageKm: mileage,
        date: issueDate,
        condition: "Accident history flagged on performance inspection",
      },
    });
  }

  const panels = collectInspectionPanels(inspection);
  if (panels.length > 0) {
    events.push({
      eventType: "inspection",
      description: `Inspection findings — ${panels.map((p) => `${p.panel}: ${p.status}`).join("; ")}`,
      occurredAt,
      metadata: {
        source: "encar_inspection_panels",
        panels,
        date: issueDate,
      },
    });
    for (const panel of panels.slice(0, 40)) {
      pushExtra(
        `inspection_panel_${slugField(panel.panel)}`,
        `Inspection: ${panel.panel}`,
        panel.status,
      );
    }
  }

  return events;
}

/** Skip empty / "없음" noise; keep Good/Defective/Replacement/etc. */
function isMeaningfulInspectionStatus(status?: string | null): boolean {
  if (!status) return false;
  const s = status.trim().toLowerCase();
  if (!s) return false;
  if (s === "none" || s === "n/a" || s === "not applicable" || s === "absent") return false;
  return true;
}

function collectInspectionPanels(
  inspection: Record<string, unknown>,
): Array<{ panel: string; status: string; area?: string }> {
  const notes: Array<{ panel: string; status: string; area?: string }> = [];
  for (const key of ["outers", "inners"] as const) {
    walkInspectionNodes(arr(inspection[key]), notes, key === "inners" ? "interior" : "exterior");
  }
  return notes;
}

function walkInspectionNodes(
  nodes: unknown[],
  notes: Array<{ panel: string; status: string; area?: string }>,
  area?: string,
): void {
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    const row = node as Record<string, unknown>;
    const rawTitle = title(row.type);
    const titleText = (translateEncarInspectionPanel(rawTitle) ?? rawTitle ?? "")
      .replace(/\(\s*\)/g, "")
      .replace(/[\/|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const status = normalizeEncarInspectionStatus(title(row.statusType));

    const junkTitle =
      !titleText ||
      titleText.length < 2 ||
      /^[\s():.\-/\\]+$/.test(titleText) ||
      /^(none|n\/a|null|undefined)$/i.test(titleText);

    if (!junkTitle && status && isMeaningfulInspectionStatus(status) && status !== "Good" && status !== "Normal") {
      notes.push({ panel: titleText, status, area });
    }
    walkInspectionNodes(arr(row.children), notes, area);
  }
}

function formatEncarDate(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 8) {
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  return undefined;
}

function slugField(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 48) || "panel";
}

function buildDiagnosisSummaryEnglish(
  replacements: string[],
  comments: string[],
): string {
  const parts: string[] = [];

  if (replacements.length > 0) {
    parts.push(
      `Encar diagnosis: ${replacements.join(", ")} replaced. Frame structure: all normal. Classified as outer-panel replacement only.`,
    );
  }

  const translatedComments = comments
    .map((c) => translateEncarComment(c))
    .filter((c): c is string => !!c && !containsHangul(c));

  if (translatedComments.length > 0) {
    parts.push(translatedComments.join(" / "));
  } else if (parts.length === 0) {
    parts.push("Encar diagnosis notes available (see panel list).");
  }

  return parts.join(" / ");
}

function parseDate(raw?: string | null): Date {
  if (!raw) return new Date(0); // epoch = unknown; never pretend "today"
  const normalized =
    raw.length === 8 && /^\d+$/.test(raw)
      ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
      : formatEncarDate(raw) ?? raw;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
}

function title(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (!value || typeof value !== "object") return undefined;
  const titleValue = (value as Record<string, unknown>).title;
  return typeof titleValue === "string" ? titleValue.trim() : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function summarizeEncarRecord(record: Record<string, unknown> | null | undefined): string | undefined {
  if (!record) return undefined;
  const maker = normalizeEncarMaker(str(record.maker));
  const fuel = normalizeEncarFuel({ fuelName: str(record.fuel) });
  const model = str(record.model);
  const year = str(record.year);
  return [year, maker, model, fuel].filter(Boolean).join(" ");
}

/**
 * Formerly dropped dated Encar claims with ₩0 costs. Those dates are real
 * registry rows — keep them. Always returns false (kept for call-site compat).
 */
export function isEmptyInsuranceAccidentEvent(_event: {
  eventType?: string | null;
  description?: string | null;
  metadata?: string | Record<string, unknown> | null;
}): boolean {
  return false;
}
