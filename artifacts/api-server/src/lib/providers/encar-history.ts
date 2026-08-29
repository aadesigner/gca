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

  for (const accident of arr(record.accidents) as EncarRecordAccident[]) {
    if (!accident?.date) continue;
    const partCost = num(accident.partCost) ?? 0;
    const laborCost = num(accident.laborCost) ?? 0;
    const paintingCost = num(accident.paintingCost) ?? 0;
    const insuranceBenefit = num(accident.insuranceBenefit) ?? 0;
    const repairTotal = partCost + laborCost + paintingCost;
    if (repairTotal <= 0 && insuranceBenefit <= 0) continue;

    events.push({
      eventType: "accident",
      description: `Insurance accident on ${accident.date} — repair ₩${repairTotal.toLocaleString("en-US")}, payout ₩${insuranceBenefit.toLocaleString("en-US")}`,
      occurredAt: parseDate(accident.date),
      metadata: {
        source: "encar_record",
        type: accident.type,
        date: accident.date,
        currency: "KRW",
        partCost,
        laborCost,
        paintingCost,
        repairTotal,
        insuranceBenefit,
      },
    });
  }

  const myAccidentCost = num(record.myAccidentCost);
  const otherAccidentCost = num(record.otherAccidentCost);
  if ((myAccidentCost ?? 0) > 0 || (otherAccidentCost ?? 0) > 0) {
    const hasDetailedAccidents = arr(record.accidents).length > 0;
    if (!hasDetailedAccidents) {
      events.push({
        eventType: "accident",
        description: `Total insurance repair exposure — own: ₩${(myAccidentCost ?? 0).toLocaleString("en-US")}, third party: ₩${(otherAccidentCost ?? 0).toLocaleString("en-US")}`,
        occurredAt: parseDate(str(record.regDate) ?? new Date().toISOString().slice(0, 10)),
        metadata: {
          source: "encar_record_summary",
          currency: "KRW",
          myAccidentCost,
          otherAccidentCost,
          myAccidentCnt: num(record.myAccidentCnt),
          otherAccidentCnt: num(record.otherAccidentCnt),
        },
      });
    }
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
  const occurredAt = parseDate(
    str(master.registrationDate) ?? str(detail.issueDate) ?? str(detail.firstRegistrationDate),
  );

  const mileage = num(detail.mileage);
  const inspectionVin = str(detail.vin);
  const boardState = title(detail.boardStateType);
  const carState = title(detail.carStateType);
  const comments = translateEncarComment(str(detail.comments));

  if (mileage != null || inspectionVin || boardState || carState) {
    events.push({
      eventType: "inspection",
      description: [
        "Performance inspection record",
        mileage != null ? `${mileage.toLocaleString("en-US")} km` : null,
        boardState ? `overall ${boardState}` : null,
        carState ? `condition ${carState}` : null,
      ]
        .filter(Boolean)
        .join(" — "),
      occurredAt,
      metadata: {
        source: "encar_inspection",
        recordNo: str(detail.recordNo),
        mileage,
        mileageKm: mileage,
        vin: inspectionVin,
        firstRegistrationDate: str(detail.firstRegistrationDate),
        validityStartDate: str(detail.validityStartDate),
        validityEndDate: str(detail.validityEndDate),
        boardState,
        carState,
        waterlog: detail.waterlog === true,
        accidentFlagged: master.accdient === true,
        simpleRepair: master.simpleRepair === true,
        comments,
      },
    });
  }

  if (detail.waterlog === true) {
    events.push({
      eventType: "flood_damage",
      description: "Flood/water damage flagged on performance inspection",
      occurredAt,
      metadata: { source: "encar_inspection", waterlog: true, mileage, mileageKm: mileage },
    });
  }

  if (master.accdient === true) {
    events.push({
      eventType: "accident",
      description: "Accident history flagged on performance inspection",
      occurredAt,
      metadata: { source: "encar_inspection", accidentFlagged: true, mileage, mileageKm: mileage },
    });
  }

  const outers = collectInspectionOuters(inspection);
  if (outers.length > 0) {
    events.push({
      eventType: "inspection",
      description: `Inspection panel notes — ${outers.join(", ")}`,
      occurredAt,
      metadata: { source: "encar_inspection_panels", panels: outers },
    });
  }

  return events;
}

function collectInspectionOuters(inspection: Record<string, unknown>): string[] {
  const notes: string[] = [];
  for (const key of ["outers", "inners"]) {
    walkInspectionNodes(arr(inspection[key]), notes);
  }
  return notes;
}

function walkInspectionNodes(nodes: unknown[], notes: string[]): void {
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    const row = node as Record<string, unknown>;
    const rawTitle = title(row.type) ?? title(row.statusType);
    const titleText = translateEncarInspectionPanel(rawTitle) ?? rawTitle;
    const status = normalizeEncarInspectionStatus(title(row.statusType));
    if (titleText && status && status !== "Good") {
      notes.push(`${titleText}: ${status}`);
    }
    walkInspectionNodes(arr(row.children), notes);
  }
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
  if (!raw) return new Date();
  const normalized = raw.length === 8 && /^\d+$/.test(raw)
    ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
    : raw;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function title(value: unknown): string | undefined {
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

/** Encar often returns dated accident rows with no repair or payout — those are not real loss records. */
export function isEmptyInsuranceAccidentEvent(event: {
  eventType?: string | null;
  description?: string | null;
  metadata?: string | Record<string, unknown> | null;
}): boolean {
  if (event.eventType !== "accident") return false;
  const description = event.description ?? "";
  if (/repair ₩0/.test(description) && /payout ₩0/.test(description)) return true;
  let meta: Record<string, unknown> = {};
  if (typeof event.metadata === "string") {
    try {
      const parsed = JSON.parse(event.metadata);
      if (parsed && typeof parsed === "object") meta = parsed as Record<string, unknown>;
    } catch {
      meta = {};
    }
  } else if (event.metadata && typeof event.metadata === "object") {
    meta = event.metadata;
  }
  const repair = typeof meta.repairTotal === "number" ? meta.repairTotal : 0;
  const payout = typeof meta.insuranceBenefit === "number" ? meta.insuranceBenefit : 0;
  return meta.source === "encar_record" && repair <= 0 && payout <= 0;
}
